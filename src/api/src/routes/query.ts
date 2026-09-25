import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { MongoClient } from 'mongodb'
import { authMiddleware } from '../middleware/auth.js'
import { getPoolOptions } from '../services/connection.service.js'
import { liveDatabaseOf } from '../services/schema.service.js'
import { connectionManager, type PoolOptions } from '../lib/connection-manager.js'
import { buildCountSql, runBatch, runStatement, type Statement } from '../lib/query-executor.js'
import { detectGuardrail, type GuardrailResult } from '../lib/guardrail.js'
import { parseMongoCommand, MongoShellSyntaxError } from '../lib/mongo-shell.js'
import { countMongo, detectMongoGuardrail, mongoDatabaseName } from '../lib/mongo.js'
import { parseRedisCommand, RedisCommandSyntaxError } from '../lib/redis-command.js'
import { assertRunnable, detectRedisGuardrail } from '../lib/redis.js'
import { isSqlDriver } from '../lib/drivers.js'
import type { DbDriver } from '@dblumi/shared'
import { logger } from '../logger.js'
import type { AuthVariables } from '../middleware/auth.js'

const queryRouter = new Hono<AuthVariables>()
queryRouter.use('*', authMiddleware)

const SortSchema = z
  .array(z.object({ column: z.string().min(1).max(256), direction: z.enum(['asc', 'desc']) }))
  .max(16)

const QuerySchema = z.object({
  connectionId: z.string().uuid(),
  sql: z.string().min(1).max(100_000),
  limit: z.number().int().min(1).max(10_000).default(1_000),
  offset: z.number().int().min(0).default(0),
  force: z.boolean().default(false), // bypass guardrail after user confirmation
  /** Grid sort, applied server-side so that each dialect gets valid SQL. */
  sort: SortSchema.optional(),
})

const CountSchema = z.object({
  connectionId: z.string().uuid(),
  sql: z.string().min(1).max(100_000),
})

function errorMessage(err: unknown, fallback: string): { message: string; detail?: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const code = err instanceof Error && 'code' in err ? (err as Record<string, unknown>).code : undefined
  const detail = err instanceof Error && 'detail' in err ? (err as Record<string, unknown>).detail as string : undefined
  return {
    message: raw || (code ? `Database error (${String(code)})` : fallback),
    ...(detail ? { detail } : {}),
  }
}

class StatementError extends Error {}

/**
 * Parses what is not SQL (a mongosh command, redis-cli arguments) and judges it.
 * Syntax errors — and Redis commands the editor cannot run — become a
 * StatementError, answered with a 400 before anything is executed.
 */
function prepareStatement(driver: DbDriver, sql: string): { statement: Statement; guardrail: GuardrailResult } {
  try {
    if (driver === 'mongodb') {
      const command = parseMongoCommand(sql)
      return { statement: command, guardrail: detectMongoGuardrail(command) }
    }
    if (driver === 'redis') {
      const args = parseRedisCommand(sql)
      assertRunnable(args)
      return { statement: args, guardrail: detectRedisGuardrail(args) }
    }
  } catch (err) {
    if (err instanceof MongoShellSyntaxError || err instanceof RedisCommandSyntaxError || driver === 'redis') {
      throw new StatementError(err instanceof Error ? err.message : String(err))
    }
    throw err
  }
  return { statement: sql, guardrail: detectGuardrail(sql, driver) }
}

/** MongoDB database the command targets: the live one (database switcher) first. */
function mongoDatabaseOf(connectionId: string, poolOpts: PoolOptions): string {
  return mongoDatabaseName(liveDatabaseOf(connectionId, poolOpts.database))
}

queryRouter.post(
  '/',
  zValidator('json', QuerySchema),
  async (c) => {
    const { connectionId, sql, limit, offset, force, sort } = c.req.valid('json')
    const userId = c.get('userId')

    // ── Resolve connection ───────────────────────
    let poolOpts: PoolOptions
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json(
        { type: 'error', message: 'Connexion introuvable ou non autorisée.' },
        404
      )
    }

    // ── Parse (MongoDB, Redis) + guardrail ───────
    let statement: Statement
    let guardrail: GuardrailResult
    try {
      ({ statement, guardrail } = prepareStatement(poolOpts.driver, sql))
    } catch (err) {
      if (err instanceof StatementError) return c.json({ type: 'error', message: err.message }, 400)
      throw err
    }

    if (guardrail.level > 0 && !force) {
      const g = guardrail as Extract<typeof guardrail, { level: 1 | 2 | 3 | 4 }>
      return c.json(
        {
          type: 'guardrail',
          level: g.level,
          message: g.message,
          details: g.details,
          hint: 'Renvoyer la requête avec { force: true } pour confirmer.',
        },
        422
      )
    }

    // ── Stream SSE ───────────────────────────────
    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      try {
        // Inside the stream: a pool that cannot be created (bad host, driver
        // error) reaches the editor as a readable error, not as an opaque 500.
        const pool = await connectionManager.getPool(connectionId, poolOpts)
        const result = await runStatement(poolOpts.driver, pool, statement, {
          limit,
          offset,
          sort,
          ...(poolOpts.driver === 'mongodb' ? { database: mongoDatabaseOf(connectionId, poolOpts) } : {}),
        })

        // Columns first
        await send('columns', result.columns)

        // Rows in batches of 100 to avoid blocking the event loop
        const BATCH = 100
        for (let i = 0; i < result.rows.length; i += BATCH) {
          await send('rows', result.rows.slice(i, i + BATCH))
          // Yield to event loop between batches
          await new Promise((r) => setTimeout(r, 0))
        }

        // Done
        await send('done', {
          rowCount: result.rowCount,
          // Total of the whole result when the driver knows it (Snowflake, Redis):
          // the grid then needs no separate count.
          ...(result.total !== undefined ? { total: result.total } : {}),
          durationMs: result.durationMs,
        })
      } catch (err) {
        const { message, detail } = errorMessage(err, 'Connection or query failed')
        logger.warn({ connectionId, err }, 'Query execution error')
        await send('error', { message, detail })
      }
    })
  }
)

const BatchSchema = z.object({
  connectionId: z.string().uuid(),
  statements: z.array(z.string().min(1).max(100_000)).min(1).max(200),
  limit: z.number().int().min(1).max(10_000).default(1_000),
  force: z.boolean().default(false),
})

/**
 * Several statements run in order on ONE connection (see `runBatch`), streamed
 * as `statement {index}` followed by that statement's columns/rows/done events.
 * The guardrail judges the whole batch BEFORE anything runs, so confirming it
 * replays nothing: the first failing statement stops the batch.
 */
queryRouter.post(
  '/batch',
  zValidator('json', BatchSchema),
  async (c) => {
    const { connectionId, statements, limit, force } = c.req.valid('json')
    const userId = c.get('userId')

    let poolOpts: PoolOptions
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json({ type: 'error', message: 'Connexion introuvable ou non autorisée.' }, 404)
    }

    // ── Parse (MongoDB, Redis) + guardrail of every statement ──
    const parsed: Statement[] = []
    let worst: { index: number; result: GuardrailResult } = { index: 0, result: { level: 0 } }
    for (const [index, sql] of statements.entries()) {
      try {
        const { statement, guardrail } = prepareStatement(poolOpts.driver, sql)
        parsed.push(statement)
        if (guardrail.level > worst.result.level) worst = { index, result: guardrail }
      } catch (err) {
        if (err instanceof StatementError) {
          return c.json({ type: 'error', message: `Instruction ${index + 1} : ${err.message}`, index }, 400)
        }
        throw err
      }
    }
    if (worst.result.level > 0 && !force) {
      const g = worst.result as Extract<GuardrailResult, { level: 1 | 2 | 3 | 4 }>
      return c.json(
        {
          type: 'guardrail',
          level: g.level,
          message: statements.length > 1 ? `Instruction ${worst.index + 1} — ${g.message}` : g.message,
          details: g.details,
          index: worst.index,
          hint: 'Renvoyer le lot avec { force: true } pour confirmer.',
        },
        422,
      )
    }

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })
      try {
        const pool = await connectionManager.getPool(connectionId, poolOpts)
        await runBatch(poolOpts.driver, pool, parsed, {
          limit,
          ...(poolOpts.driver === 'mongodb' ? { database: mongoDatabaseOf(connectionId, poolOpts) } : {}),
        }, {
          onStart: (index) => send('statement', { index }),
          onResult: async (_index, result) => {
            await send('columns', result.columns)
            for (let i = 0; i < result.rows.length; i += 100) {
              await send('rows', result.rows.slice(i, i + 100))
              await new Promise((r) => setTimeout(r, 0))
            }
            await send('done', {
              rowCount: result.rowCount,
              durationMs: result.durationMs,
              ...(result.total !== undefined ? { total: result.total } : {}),
            })
          },
        })
      } catch (err) {
        const { message, detail } = errorMessage(err, 'Connection or query failed')
        logger.warn({ connectionId, err }, 'Batch execution error')
        await send('error', { message, detail })
      }
    })
  },
)

/**
 * Total row count of a query, for the grid's pagination. Returns `{ total: null }`
 * whenever the statement is not a countable read — never an error: the count
 * is a nicety, the grid still works without it.
 */
queryRouter.post(
  '/count',
  zValidator('json', CountSchema),
  async (c) => {
    const { connectionId, sql } = c.req.valid('json')
    const userId = c.get('userId')

    let poolOpts: PoolOptions
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json({ type: 'error', message: 'Connexion introuvable ou non autorisée.' }, 404)
    }

    // Snowflake and Redis report the total with the result itself: re-running a
    // Snowflake query only to count it would spend warehouse credits.
    if (poolOpts.driver === 'snowflake' || poolOpts.driver === 'redis') return c.json({ total: null })

    try {
      const pool = await connectionManager.getPool(connectionId, poolOpts)
      if (poolOpts.driver === 'mongodb') {
        const command = parseMongoCommand(sql)
        // Only reads are counted: the count must never run a write a second time.
        if (detectMongoGuardrail(command).level > 0) return c.json({ total: null })
        const total = await countMongo(pool as MongoClient, mongoDatabaseOf(connectionId, poolOpts), command)
        return c.json({ total })
      }

      if (!isSqlDriver(poolOpts.driver)) return c.json({ total: null })
      const countSql = buildCountSql(poolOpts.driver, sql)
      if (!countSql || detectGuardrail(sql, poolOpts.driver).level > 0) return c.json({ total: null })
      const result = await runStatement(poolOpts.driver, pool, countSql, { limit: 1, offset: 0 })
      const value = result.rows[0]?.['total']
      const total = value === null || value === undefined ? null : Number(value)
      return c.json({ total: Number.isFinite(total) ? total : null })
    } catch (err) {
      logger.debug({ connectionId, err }, 'Row count unavailable')
      return c.json({ total: null })
    }
  }
)

export { queryRouter }

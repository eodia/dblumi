import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { getPoolOptions } from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import { executePg, executeMySQL, executeOracle, executeSQLite } from '../lib/query-executor.js'
import { detectGuardrail } from '../lib/guardrail.js'
import { logger } from '../logger.js'
import type { AuthVariables } from '../middleware/auth.js'
import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import type { Client as LibSQLClient } from '@libsql/client'

const queryRouter = new Hono<AuthVariables>()
queryRouter.use('*', authMiddleware)

const QuerySchema = z.object({
  connectionId: z.string().uuid(),
  sql: z.string().min(1).max(100_000),
  limit: z.number().int().min(1).max(10_000).default(1_000),
  offset: z.number().int().min(0).default(0),
  force: z.boolean().default(false), // bypass guardrail after user confirmation
})

queryRouter.post(
  '/',
  zValidator('json', QuerySchema),
  async (c) => {
    const { connectionId, sql, limit, offset, force } = c.req.valid('json')
    const userId = c.get('userId')

    // ── Guardrail check ──────────────────────────
    const guardrail = detectGuardrail(sql)
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

    // ── Resolve pool ─────────────────────────────
    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json(
        { type: 'error', message: 'Connexion introuvable ou non autorisée.' },
        404
      )
    }

    const pool = await connectionManager.getPool(connectionId, poolOpts)

    // ── Stream SSE ───────────────────────────────
    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      try {
        const result =
          poolOpts.driver === 'postgresql'
            ? await executePg(pool as PgPool, sql, limit, offset)
            : poolOpts.driver === 'mysql'
            ? await executeMySQL(pool as MySQLPool, sql, limit, offset)
            : poolOpts.driver === 'sqlite'
            ? await executeSQLite(pool as LibSQLClient, sql, limit, offset)
            : await executeOracle(pool as OraclePool, sql, limit, offset)

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
          durationMs: result.durationMs,
        })
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        const code = err instanceof Error && 'code' in err ? (err as Record<string, unknown>).code : undefined
        const detail = err instanceof Error && 'detail' in err ? (err as Record<string, unknown>).detail as string : undefined
        const message = raw || (code ? `Database error (${code})` : 'Connection or query failed')
        logger.warn({ connectionId, err, code }, 'Query execution error')
        await send('error', { message, detail })
      }
    })
  }
)

export { queryRouter }

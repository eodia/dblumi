import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { logger } from '../logger.js'
import { groups, users, connectionGroups, connectionUsers } from '../db/schema.js'
import {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  getPoolOptions,
  pingPool,
  normalizeConnectionInput,
  canManageConnection,
  ConnectionError,
} from '../services/connection.service.js'
import { fetchSchema, liveDatabaseOf } from '../services/schema.service.js'
import { connectionManager, type DbPool, type PoolOptions } from '../lib/connection-manager.js'
import { DB_DRIVERS, DRIVER_LABELS, DRIVER_SUPPORT, isSqlDriver, quoteIdent, quoteTable, type SqlDriver } from '../lib/drivers.js'
import { formatBytes } from '../lib/format.js'
import { runStatement } from '../lib/query-executor.js'
import type { AuthVariables } from '../middleware/auth.js'
import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import type { Client as LibSQLClient } from '@libsql/client'
import type { Trino } from 'trino-client'
import type { MongoClient } from 'mongodb'
import type { ConnectionPool as MssqlPool } from 'mssql'
import type { SnowflakeClient } from '../lib/snowflake.js'
import type { RedisConn } from '../lib/redis.js'
import {
  runTrino,
  parseTrinoTarget,
  quoteTrinoIdent,
  quoteTrinoTable,
} from '../lib/trino.js'
import {
  countMongoCollection,
  dumpMongoCollection,
  getMongoStats,
  isMongoUri,
  listMongoDatabases,
  mongoDatabaseName,
} from '../lib/mongo.js'

const connectionsRouter = new Hono<AuthVariables>()

// All routes require auth
connectionsRouter.use('*', authMiddleware)

// ──────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────

/** Fields required per driver. */
function refineConnectionFields(
  val: { driver: (typeof DB_DRIVERS)[number]; host?: string | undefined; port?: number | undefined; username?: string | undefined; filePath?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (val.driver === 'sqlite') {
    if (!val.filePath) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'filePath requis pour SQLite', path: ['filePath'] })
    return
  }
  if (!val.host) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'host requis', path: ['host'] })
  // Snowflake is reached by account identifier; a MongoDB or Redis URI carries its own port.
  const portless = val.driver === 'snowflake'
    || (val.driver === 'mongodb' && isMongoUri(val.host))
    || (val.driver === 'redis' && /^rediss?:\/\//i.test(val.host?.trim() ?? ''))
  if (!val.port && !portless) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'port requis', path: ['port'] })
  // MongoDB and Redis servers may run without authentication.
  if (!val.username && val.driver !== 'mongodb' && val.driver !== 'redis') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'username requis', path: ['username'] })
  }
}

/** Driver-specific, non-secret settings (Snowflake warehouse and role). */
const ConnectionOptionsInput = z.record(z.string().max(64), z.string().max(256))

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  driver: z.enum(DB_DRIVERS),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  database: z.string().optional(),
  username: z.string().min(1).optional(),
  password: z.string().optional(),
  filePath: z.string().min(1).optional(),
  ssl: z.boolean().default(false),
  options: ConnectionOptionsInput.optional(),
  color: z.string().optional(),
  environment: z.string().max(50).optional(),
}).superRefine(refineConnectionFields)

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  driver: z.enum(DB_DRIVERS).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  database: z.string().optional(),
  username: z.string().min(1).optional(),
  password: z.string().optional(),
  filePath: z.string().min(1).optional(),
  ssl: z.boolean().optional(),
  options: ConnectionOptionsInput.nullable().optional(),
  color: z.string().optional(),
  environment: z.string().max(50).optional(),
})

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function problem(status: number, title: string, detail?: string) {
  return { type: `https://dblumi.dev/errors/${status}`, title, status, detail }
}

function errorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err)
  const code = err instanceof Error && 'code' in err ? (err as Record<string, unknown>).code : undefined
  return raw || (code ? `Database error (${String(code)})` : fallback)
}

/** Maps service errors: unknown connection → 404, refused SQLite path → 400. */
function connectionErrorResponse(e: ConnectionError) {
  return e.code === 'FORBIDDEN_PATH' || e.code === 'INVALID_HOST'
    ? { body: problem(400, e.message), status: 400 as const }
    : { body: problem(404, e.message), status: 404 as const }
}

function mongoDatabaseOf(connectionId: string, poolOpts: PoolOptions): string {
  return mongoDatabaseName(liveDatabaseOf(connectionId, poolOpts.database))
}

// ──────────────────────────────────────────────
// GET /connections
// ──────────────────────────────────────────────

connectionsRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const list = await listConnections(userId)
  return c.json({ connections: list })
})

// ──────────────────────────────────────────────
// GET /connections/:id
// ──────────────────────────────────────────────

connectionsRouter.get('/:id', async (c) => {
  const userId = c.get('userId')
  try {
    const conn = await getConnection(c.req.param('id'), userId)
    return c.json({ connection: conn })
  } catch (e) {
    if (e instanceof ConnectionError)
      return c.json(problem(404, e.message), 404)
    throw e
  }
})

// ──────────────────────────────────────────────
// POST /connections
// ──────────────────────────────────────────────

connectionsRouter.post(
  '/',
  zValidator('json', CreateSchema),
  async (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')
    try {
      const conn = await createConnection({ ...body, color: body.color ?? null, environment: body.environment ?? null } as Parameters<typeof createConnection>[0], userId)
      return c.json({ connection: conn }, 201)
    } catch (e) {
      if (e instanceof ConnectionError) {
        const { body: err, status } = connectionErrorResponse(e)
        return c.json(err, status)
      }
      throw e
    }
  }
)

// ──────────────────────────────────────────────
// PUT /connections/:id
// ──────────────────────────────────────────────

connectionsRouter.put(
  '/:id',
  zValidator('json', UpdateSchema),
  async (c) => {
    const userId = c.get('userId')
    const raw = c.req.valid('json')
    const body = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== undefined)
    ) as Parameters<typeof updateConnection>[1]
    try {
      const conn = await updateConnection(c.req.param('id'), body, userId)
      return c.json({ connection: conn })
    } catch (e) {
      if (e instanceof ConnectionError) {
        const { body: err, status } = connectionErrorResponse(e)
        return c.json(err, status)
      }
      throw e
    }
  }
)

// ──────────────────────────────────────────────
// DELETE /connections/:id
// ──────────────────────────────────────────────

connectionsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  try {
    await deleteConnection(c.req.param('id'), userId)
    return c.body(null, 204)
  } catch (e) {
    if (e instanceof ConnectionError)
      return c.json(problem(404, e.message), 404)
    throw e
  }
})

// ──────────────────────────────────────────────
// POST /connections/:id/test
// ──────────────────────────────────────────────

connectionsRouter.post('/:id/test', async (c) => {
  const userId = c.get('userId')
  try {
    const result = await testConnection(c.req.param('id'), userId)
    return c.json(result)
  } catch (e) {
    if (e instanceof ConnectionError)
      return c.json(problem(404, e.message), 404)
    throw e
  }
})

// ──────────────────────────────────────────────
// POST /connections/test-raw  (test before saving)
// ──────────────────────────────────────────────

const TestRawSchema = z.object({
  driver: z.enum(DB_DRIVERS),
  host: z.string().min(1).optional(),
  port: z.number().int().optional(),
  database: z.string().optional(),
  username: z.string().min(1).optional(),
  password: z.string().optional(),
  filePath: z.string().min(1).optional(),
  ssl: z.boolean().default(false),
  options: ConnectionOptionsInput.optional(),
})

connectionsRouter.post(
  '/test-raw',
  zValidator('json', TestRawSchema),
  async (c) => {
    const tempId = `_test_${crypto.randomUUID()}`
    const start = Date.now()

    try {
      // Same clean-up as on save: credentials inside a MongoDB URI, SQLite path check.
      const opts = normalizeConnectionInput(c.req.valid('json'), c.req.valid('json').driver) as PoolOptions
      const pool = await connectionManager.getPool(tempId, opts)
      await pingPool(opts.driver, pool, opts.database, opts.options)
      return c.json({ ok: true, latencyMs: Date.now() - start })
    } catch (err) {
      return c.json({ ok: false, latencyMs: Date.now() - start, error: errorMessage(err, 'Connection failed') })
    } finally {
      await connectionManager.release(tempId)
    }
  }
)

// ──────────────────────────────────────────────
// GET /connections/:id/schema
// ──────────────────────────────────────────────

connectionsRouter.get('/:id/schema', async (c) => {
  const userId = c.get('userId')
  const connectionId = c.req.param('id')

  let poolOpts
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json(
      { type: 'error', message: 'Connexion introuvable ou non autorisée.' },
      404
    )
  }

  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    return c.json(await fetchSchema(connectionId, poolOpts.driver, pool, poolOpts.database))
  } catch (err) {
    const message = errorMessage(err, 'Connection failed')
    logger.warn({ connectionId, err: message }, 'Schema fetch failed')
    return c.json({ type: 'error', message }, 502)
  }
})

// ──────────────────────────────────────────────
// POST /connections/:id/table-count
// ──────────────────────────────────────────────

connectionsRouter.post(
  '/:id/table-count',
  zValidator('json', z.object({ table: z.string().min(1) })),
  async (c) => {
    const userId = c.get('userId')
    const connectionId = c.req.param('id')
    const { table } = c.req.valid('json')

    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json(problem(404, 'Connexion introuvable.'), 404)
    }

    try {
      const pool = await connectionManager.getPool(connectionId, poolOpts)
      let count: number
      if (poolOpts.driver === 'mongodb') {
        count = await countMongoCollection(pool as MongoClient, mongoDatabaseOf(connectionId, poolOpts), table)
      } else if (poolOpts.driver === 'redis') {
        const { countRedisPattern } = await import('../lib/redis.js')
        count = await countRedisPattern(pool as RedisConn, table)
      } else if (poolOpts.driver === 'snowflake') {
        const { countSnowflakeTable } = await import('../lib/snowflake.js')
        count = await countSnowflakeTable(pool as SnowflakeClient, table, liveDatabaseOf(connectionId, poolOpts.database))
      } else if (poolOpts.driver === 'trino') {
        // `table` may be `schema.table` (see getTrinoSchema): quote each segment.
        const r = await runTrino(
          pool as Trino,
          `SELECT COUNT(*) AS c FROM ${quoteTrinoTable(table)}`,
          parseTrinoTarget(liveDatabaseOf(connectionId, poolOpts.database)),
        )
        count = Number(r.data[0]?.[0] ?? 0)
      } else {
        // The table name is quoted: it used to be interpolated raw, which both
        // broke mixed-case names and let a crafted name bypass the guardrail.
        const alias = poolOpts.driver === 'oracle' ? '"total"' : 'total'
        const countFn = poolOpts.driver === 'mssql' ? 'COUNT_BIG(*)' : 'COUNT(*)'
        const sql = `SELECT ${countFn} AS ${alias} FROM ${quoteTable(poolOpts.driver, table)}`
        const result = await runStatement(poolOpts.driver, pool, sql, { limit: 1, offset: 0 })
        count = Number(result.rows[0]?.['total'] ?? 0)
      }
      return c.json({ count })
    } catch (err) {
      return c.json(problem(502, errorMessage(err, 'Query failed')), 502)
    }
  }
)

// ──────────────────────────────────────────────
// GET /connections/:id/function/:name
// ──────────────────────────────────────────────

connectionsRouter.get('/:id/function/:name', async (c) => {
  const userId = c.get('userId')
  const connectionId = c.req.param('id')
  const funcName = c.req.param('name')

  let poolOpts
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json(problem(404, 'Connexion introuvable.'), 404)
  }

  // No user-defined routines to introspect: never fall through to the Oracle branch.
  if (!DRIVER_SUPPORT[poolOpts.driver].functions) {
    return c.json(problem(501, `Introspection de fonctions non supportée par ${DRIVER_LABELS[poolOpts.driver]}.`), 501)
  }

  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    if (poolOpts.driver === 'mssql') {
      const { getMssqlRoutine } = await import('../lib/mssql.js')
      const routine = await getMssqlRoutine(pool as MssqlPool, funcName)
      return routine ? c.json({ function: routine }) : c.json(problem(404, 'Fonction introuvable.'), 404)
    }
    if (poolOpts.driver === 'postgresql') {
      const pgPool = pool as PgPool
      const client = await pgPool.connect()
      try {
        const { rows } = await client.query(`
          SELECT
            p.proname AS name,
            CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind,
            pg_get_function_result(p.oid) AS return_type,
            pg_get_function_identity_arguments(p.oid) AS arguments,
            l.lanname AS language,
            pg_get_functiondef(p.oid) AS source
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN pg_language l ON l.oid = p.prolang
          WHERE n.nspname = 'public' AND p.proname = $1
          LIMIT 1
        `, [funcName])
        if (!rows[0]) return c.json(problem(404, 'Fonction introuvable.'), 404)

        // Parse arguments — only keep IN params (exclude OUT, INOUT output-only)
        const argStr = (rows[0] as Record<string, unknown>).arguments as string
        const params = argStr ? argStr.split(',').map((a) => {
          const parts = a.trim().split(/\s+/)
          // pg_get_function_identity_arguments may prefix with IN/OUT/INOUT
          const mode = parts[0]?.toUpperCase()
          if (mode === 'OUT') return null
          if (mode === 'IN' || mode === 'INOUT') {
            return { name: parts[1] ?? '', type: parts.slice(2).join(' ') || 'text' }
          }
          // No mode prefix — it's an IN param by default
          return { name: parts[0] ?? '', type: parts.slice(1).join(' ') || 'text' }
        }).filter(Boolean) : []

        return c.json({ function: { ...rows[0], params } })
      } finally {
        client.release()
      }
    } else if (poolOpts.driver === 'mysql') {
      const mysqlPool = pool as MySQLPool
      const conn = await mysqlPool.getConnection()
      try {
        const [rows] = await conn.query(`
          SELECT
            ROUTINE_NAME AS name,
            LOWER(ROUTINE_TYPE) AS kind,
            DTD_IDENTIFIER AS return_type,
            ROUTINE_DEFINITION AS source,
            EXTERNAL_LANGUAGE AS language
          FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = ?
          LIMIT 1
        `, [funcName])
        const arr = rows as Record<string, unknown>[]
        if (!arr[0]) return c.json(problem(404, 'Fonction introuvable.'), 404)

        const [paramRows] = await conn.query(`
          SELECT PARAMETER_NAME AS name, DATA_TYPE AS type
          FROM information_schema.PARAMETERS
          WHERE SPECIFIC_SCHEMA = DATABASE() AND SPECIFIC_NAME = ?
            AND PARAMETER_MODE IN ('IN', 'INOUT')
          ORDER BY ORDINAL_POSITION
        `, [funcName])

        return c.json({ function: { ...arr[0], params: paramRows } })
      } finally {
        conn.release()
      }
    } else {
      const oraclePool = pool as OraclePool
      const conn = await oraclePool.getConnection()
      try {
        const { rows } = await conn.execute<[string, string, string, string]>(`
          SELECT
            OBJECT_NAME AS name,
            OBJECT_TYPE AS kind,
            NULL AS return_type,
            NULL AS source
          FROM USER_OBJECTS
          WHERE OBJECT_NAME = :name AND OBJECT_TYPE IN ('FUNCTION', 'PROCEDURE')
          FETCH FIRST 1 ROWS ONLY
        `, { name: funcName }, { outFormat: 4001 })
        const arr = rows as [string, string, string, string][]
        if (!arr[0]) return c.json(problem(404, 'Fonction introuvable.'), 404)
        const [name, kind, return_type] = arr[0]
        return c.json({ function: { name, kind: kind?.toLowerCase(), return_type, source: '', language: 'plsql', params: [], arguments: '' } })
      } finally {
        await conn.close()
      }
    }
  } catch (err) {
    return c.json(problem(502, errorMessage(err, 'Failed to get function')), 502)
  }
})

// ──────────────────────────────────────────────
// GET /connections/:id/databases
// ──────────────────────────────────────────────

connectionsRouter.get('/:id/databases', async (c) => {
  const userId = c.get('userId')
  const connectionId = c.req.param('id')

  let poolOpts
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json(problem(404, 'Connexion introuvable.'), 404)
  }

  // A SQLite file is a single database (it used to fall through to the Oracle branch).
  if (poolOpts.driver === 'sqlite') return c.json({ databases: [] })

  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    if (poolOpts.driver === 'postgresql') {
      const pgPool = pool as PgPool
      const client = await pgPool.connect()
      try {
        const { rows } = await client.query(`
          SELECT datname AS name FROM pg_database
          WHERE datistemplate = false
          ORDER BY datname
        `)
        return c.json({ databases: rows.map((r: Record<string, unknown>) => r.name as string) })
      } finally {
        client.release()
      }
    } else if (poolOpts.driver === 'mysql') {
      const mysqlPool = pool as MySQLPool
      const conn = await mysqlPool.getConnection()
      try {
        const [rows] = await conn.query('SHOW DATABASES')
        const dbs = (rows as Array<Record<string, unknown>>).map((r) => Object.values(r)[0] as string)
        return c.json({ databases: dbs })
      } finally {
        conn.release()
      }
    } else if (poolOpts.driver === 'mongodb') {
      return c.json({ databases: await listMongoDatabases(pool as MongoClient) })
    } else if (poolOpts.driver === 'mssql') {
      const { listMssqlDatabases } = await import('../lib/mssql.js')
      return c.json({ databases: await listMssqlDatabases(pool as MssqlPool) })
    } else if (poolOpts.driver === 'snowflake') {
      const { listSnowflakeDatabases } = await import('../lib/snowflake.js')
      return c.json({ databases: await listSnowflakeDatabases(pool as SnowflakeClient, liveDatabaseOf(connectionId, poolOpts.database)) })
    } else if (poolOpts.driver === 'redis') {
      const { listRedisDatabases, redisDatabaseIndex } = await import('../lib/redis.js')
      return c.json({ databases: await listRedisDatabases(pool as RedisConn, redisDatabaseIndex(poolOpts.database)) })
    } else if (poolOpts.driver === 'trino') {
      // Returned values must be re-injectable into POST /:id/switch-database,
      // hence the `catalog/schema` shape once a catalog is known.
      const { catalog } = parseTrinoTarget(liveDatabaseOf(connectionId, poolOpts.database))
      if (!catalog) {
        const r = await runTrino(pool as Trino, 'SHOW CATALOGS')
        return c.json({ databases: r.data.map((row) => String(row[0] ?? '')) })
      }
      const r = await runTrino(
        pool as Trino,
        `SELECT schema_name FROM ${quoteTrinoIdent(catalog)}.information_schema.schemata ORDER BY 1`,
      )
      const dbs = r.data
        .map((row) => String(row[0] ?? ''))
        .filter((s) => s && s !== 'information_schema')
        .map((s) => `${catalog}/${s}`)
      return c.json({ databases: dbs })
    } else {
      const oraclePool = pool as OraclePool
      const conn = await oraclePool.getConnection()
      try {
        const { rows } = await conn.execute<[string]>(
          `SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME`,
          [],
          { outFormat: 4001 }
        )
        const dbs = (rows as [string][]).map((r) => r[0] ?? '')
        return c.json({ databases: dbs })
      } finally {
        await conn.close()
      }
    }
  } catch (err) {
    return c.json(problem(502, errorMessage(err, 'Failed to list databases')), 502)
  }
})

// ──────────────────────────────────────────────
// POST /connections/:id/switch-database
// ──────────────────────────────────────────────

connectionsRouter.post(
  '/:id/switch-database',
  zValidator('json', z.object({ database: z.string().min(1) })),
  async (c) => {
    const userId = c.get('userId')
    const connectionId = c.req.param('id')
    const { database } = c.req.valid('json')

    // Access is checked BEFORE the pool is touched: releasing first let any
    // authenticated user recycle the pool of a connection they cannot see.
    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json(problem(404, 'Connexion introuvable.'), 404)
    }

    // Re-create the pool with the new database (runtime only, not persisted to connection config)
    await connectionManager.release(connectionId)
    await connectionManager.getPool(connectionId, { ...poolOpts, database })

    return c.json({ database })
  }
)

// ──────────────────────────────────────────────
// POST /connections/:id/create-database
// ──────────────────────────────────────────────

connectionsRouter.post(
  '/:id/create-database',
  zValidator('json', z.object({ name: z.string().min(1).max(63) })),
  async (c) => {
    const userId = c.get('userId')
    const connectionId = c.req.param('id')
    const { name } = c.req.valid('json')

    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json(problem(404, 'Connexion introuvable.'), 404)
    }

    if (!DRIVER_SUPPORT[poolOpts.driver].createDatabase) {
      return c.json(problem(400, `Création de base non supportée par ${DRIVER_LABELS[poolOpts.driver]}.`), 400)
    }
    // Sanitize: only allow alphanumeric, underscore and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return c.json(problem(400, 'Nom invalide. Utilisez uniquement des lettres, chiffres, _ ou -.'), 400)
    }

    try {
      const pool = await connectionManager.getPool(connectionId, poolOpts)
      if (poolOpts.driver === 'postgresql') {
        // CREATE DATABASE cannot run inside a transaction — use a direct client
        const client = await (pool as PgPool).connect()
        try {
          await client.query(`CREATE DATABASE ${quoteIdent('postgresql', name)}`)
        } finally {
          client.release()
        }
      } else if (poolOpts.driver === 'mssql') {
        await (pool as MssqlPool).request().query(`CREATE DATABASE ${quoteIdent('mssql', name)}`)
      } else {
        const conn = await (pool as MySQLPool).getConnection()
        try {
          await conn.query(`CREATE DATABASE ${quoteIdent('mysql', name)}`)
        } finally {
          conn.release()
        }
      }
      return c.json({ name }, 201)
    } catch (err) {
      return c.json(problem(502, errorMessage(err, 'Failed to create database')), 502)
    }
  }
)

// ──────────────────────────────────────────────
// GET /connections/:id/shares
// ──────────────────────────────────────────────

connectionsRouter.get('/:id/shares', async (c) => {
  const connectionId = c.req.param('id')
  if (!(await canManageConnection(connectionId, c.get('userId'), c.get('userRole')))) {
    return c.json(problem(404, 'Connexion introuvable.'), 404)
  }

  const groupRows = await db
    .select({ id: groups.id, name: groups.name, color: groups.color })
    .from(connectionGroups)
    .innerJoin(groups, eq(connectionGroups.groupId, groups.id))
    .where(eq(connectionGroups.connectionId, connectionId))

  const userRows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(connectionUsers)
    .innerJoin(users, eq(connectionUsers.userId, users.id))
    .where(eq(connectionUsers.connectionId, connectionId))

  return c.json({ groups: groupRows, users: userRows })
})

// ──────────────────────────────────────────────
// PUT /connections/:id/shares
// ──────────────────────────────────────────────

connectionsRouter.put(
  '/:id/shares',
  zValidator('json', z.object({ groupIds: z.array(z.string()), userIds: z.array(z.string()) })),
  async (c) => {
    const connectionId = c.req.param('id')
    const { groupIds, userIds } = c.req.valid('json')
    // Only the owner (or an admin) may change who can use the stored credentials.
    if (!(await canManageConnection(connectionId, c.get('userId'), c.get('userRole')))) {
      return c.json(problem(404, 'Connexion introuvable.'), 404)
    }

    await db.transaction(async (tx) => {
      // Replace all groups
      await tx.delete(connectionGroups).where(eq(connectionGroups.connectionId, connectionId))
      for (const groupId of groupIds) {
        await tx.insert(connectionGroups).values({ connectionId, groupId }).onConflictDoNothing()
      }

      // Replace all shared users
      await tx.delete(connectionUsers).where(eq(connectionUsers.connectionId, connectionId))
      for (const userId of userIds) {
        await tx.insert(connectionUsers).values({ connectionId, userId }).onConflictDoNothing()
      }
    })

    return c.json({ groupIds, userIds })
  },
)

async function getDbStats(connectionId: string, poolOpts: PoolOptions, pool: DbPool) {
  const driver = poolOpts.driver
  if (driver === 'sqlite') {
    const client = pool as LibSQLClient
    const r = await client.execute('SELECT sqlite_version() AS v')
    return { version: `SQLite ${String(r.rows[0]?.[0] ?? '')}`, encoding: 'UTF-8', timezone: null, sizePretty: null, sizeBytes: null }
  }
  if (driver === 'trino') {
    // Trino has no catalog-level size metric.
    const r = await runTrino(pool as Trino, 'SELECT version()')
    return { version: `Trino ${String(r.data[0]?.[0] ?? '')}`, encoding: 'UTF-8', timezone: null, sizePretty: null, sizeBytes: null }
  }
  if (driver === 'mongodb') {
    return getMongoStats(pool as MongoClient, mongoDatabaseOf(connectionId, poolOpts))
  }
  if (driver === 'mssql') {
    const { getMssqlStats } = await import('../lib/mssql.js')
    return getMssqlStats(pool as MssqlPool)
  }
  if (driver === 'snowflake') {
    const { getSnowflakeStats } = await import('../lib/snowflake.js')
    return getSnowflakeStats(pool as SnowflakeClient)
  }
  if (driver === 'redis') {
    const { getRedisStats } = await import('../lib/redis.js')
    return getRedisStats(pool as RedisConn)
  }
  let version: string | null = null
  let encoding: string | null = null
  let timezone: string | null = null
  let sizePretty: string | null = null
  let sizeBytes: number | null = null

  if (driver === 'postgresql') {
    const pg = pool as PgPool
    const client = await pg.connect()
    try {
      const { rows } = await client.query(`
        SELECT
          version() AS version,
          current_setting('server_encoding') AS encoding,
          current_setting('TimeZone') AS timezone,
          pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
          pg_database_size(current_database()) AS size_bytes
      `)
      version = (rows[0] as Record<string,unknown>)?.version as string ?? null
      encoding = (rows[0] as Record<string,unknown>)?.encoding as string ?? null
      timezone = (rows[0] as Record<string,unknown>)?.timezone as string ?? null
      sizePretty = (rows[0] as Record<string,unknown>)?.size_pretty as string ?? null
      sizeBytes = Number((rows[0] as Record<string,unknown>)?.size_bytes ?? null) || null
    } finally { client.release() }
  } else if (driver === 'mysql') {
    const mysql = pool as MySQLPool
    const conn = await mysql.getConnection()
    try {
      const [[vrow]] = await conn.query('SELECT VERSION() AS v') as [Record<string,unknown>[], unknown]
      version = (vrow as Record<string,unknown>)?.v as string ?? null
      const [[encrow]] = await conn.query("SELECT @@character_set_server AS e") as [Record<string,unknown>[], unknown]
      encoding = (encrow as Record<string,unknown>)?.e as string ?? null
      const [[tzrow]] = await conn.query("SELECT @@global.time_zone AS z") as [Record<string,unknown>[], unknown]
      timezone = (tzrow as Record<string,unknown>)?.z as string ?? null
      const [[srow]] = await conn.query(`
        SELECT ROUND(SUM(data_length + index_length), 0) AS sb
        FROM information_schema.TABLES
        WHERE table_schema = DATABASE()
      `) as [Record<string,unknown>[], unknown]
      sizeBytes = Number((srow as Record<string,unknown>)?.sb) || null
      if (sizeBytes) sizePretty = formatBytes(sizeBytes)
    } finally { conn.release() }
  } else {
    // Oracle: best-effort, many views need DBA grants
    const oracle = pool as OraclePool
    const conn = await oracle.getConnection()
    try {
      try {
        const r1 = await conn.execute<[string]>('SELECT banner FROM v$version WHERE ROWNUM = 1', [], { outFormat: 4001 })
        version = (r1.rows?.[0] as [string])?.[0] ?? null
      } catch { /* v$version may need DBA */ }
      try {
        const r2 = await conn.execute<[number]>('SELECT SUM(bytes) FROM user_segments', [], { outFormat: 4001 })
        sizeBytes = Number((r2.rows?.[0] as [number])?.[0]) || null
        if (sizeBytes) sizePretty = formatBytes(sizeBytes)
      } catch { /* segments may not be accessible */ }
    } finally { try { await conn.close() } catch { /* ignore */ } }
  }

  return { version, encoding, timezone, sizePretty, sizeBytes }
}

connectionsRouter.get('/:id/stats', async (c) => {
  const userId = c.get('userId')
  const connectionId = c.req.param('id')

  let poolOpts
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json(problem(404, 'Connexion introuvable.'), 404)
  }

  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    return c.json(await getDbStats(connectionId, poolOpts, pool))
  } catch (err) {
    return c.json(problem(502, errorMessage(err, 'Stats unavailable')), 502)
  }
})

// ──────────────────────────────────────────────
// Dump tables (structure and/or data)
// ──────────────────────────────────────────────

const DumpSchema = z.object({
  tables: z.array(z.string().min(1)).min(1),
  includeData: z.boolean().default(false),
})

connectionsRouter.post(
  '/:id/dump',
  zValidator('json', DumpSchema),
  async (c) => {
    const userId = c.get('userId')
    const connectionId = c.req.param('id')
    const { tables, includeData } = c.req.valid('json')

    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json(problem(404, 'Connection not found.'), 404)
    }

    try {
      const pool = await connectionManager.getPool(connectionId, poolOpts)
      const parts: string[] = []
      const driver = poolOpts.driver
      for (const table of tables) {
        if (driver === 'mongodb') {
          parts.push(await dumpMongoCollection(pool as MongoClient, mongoDatabaseOf(connectionId, poolOpts), table, includeData))
        } else if (driver === 'redis') {
          const { dumpRedisPattern } = await import('../lib/redis.js')
          parts.push(await dumpRedisPattern(pool as RedisConn, table, includeData))
        } else {
          parts.push(await dumpTable(pool, driver, table, includeData, liveDatabaseOf(connectionId, poolOpts.database)))
        }
      }
      // mongosh script, redis-cli commands, or SQL.
      const [type, file] = driver === 'mongodb'
        ? ['text/javascript', 'dump.js']
        : driver === 'redis' ? ['text/plain', 'dump.redis'] : ['text/sql', 'dump.sql']
      c.header('Content-Type', `${type}; charset=utf-8`)
      c.header('Content-Disposition', `attachment; filename="${file}"`)
      return c.text(parts.join('\n\n'))
    } catch (err) {
      return c.json(problem(502, errorMessage(err, 'Dump failed')), 502)
    }
  },
)

/** A table name inside a `--` comment: a newline would let it escape the comment. */
function commentSafe(name: string): string {
  return name.replace(/[\r\n]+/g, ' ')
}

async function dumpTable(
  pool: DbPool,
  driver: SqlDriver,
  table: string,
  includeData: boolean,
  target: string | null,
): Promise<string> {
  if (driver === 'mssql') {
    const { dumpMssqlTable } = await import('../lib/mssql.js')
    return dumpMssqlTable(pool as MssqlPool, table, includeData)
  } else if (driver === 'snowflake') {
    const { dumpSnowflakeTable } = await import('../lib/snowflake.js')
    return dumpSnowflakeTable(pool as SnowflakeClient, table, includeData, target)
  } else if (driver === 'sqlite') {
    return dumpSQLite(pool as LibSQLClient, table, includeData)
  } else if (driver === 'mysql') {
    return dumpMySQL(pool as MySQLPool, table, includeData)
  } else if (driver === 'postgresql') {
    return dumpPg(pool as PgPool, table, includeData)
  } else if (driver === 'trino') {
    return dumpTrino(pool as Trino, table, includeData)
  } else {
    return dumpOracle(pool as OraclePool, table, includeData)
  }
}

async function dumpSQLite(client: LibSQLClient, table: string, includeData: boolean): Promise<string> {
  const parts: string[] = []
  const q = (name: string) => quoteIdent('sqlite', name)
  // Get CREATE TABLE statement from sqlite_master
  const ddlResult = await client.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [table],
  })
  const ddl = String(ddlResult.rows[0]?.[0] ?? '')
  if (ddl) parts.push(`${ddl};`)
  if (includeData) {
    const rows = await client.execute(`SELECT * FROM ${q(table)}`)
    if (rows.rows.length > 0) {
      const colNames = rows.columns.map(q).join(', ')
      const inserts = rows.rows.map((row) => {
        const vals = rows.columns.map((_name, i) => escapeValue(row[i], 'sqlite')).join(', ')
        return `INSERT INTO ${q(table)} (${colNames}) VALUES (${vals});`
      })
      parts.push(inserts.join('\n'))
    }
  }
  return parts.join('\n')
}

async function dumpMySQL(pool: MySQLPool, table: string, includeData: boolean): Promise<string> {
  const q = (name: string) => quoteIdent('mysql', name)
  const conn = await pool.getConnection()
  try {
    const [ddlRows] = await conn.query(`SHOW CREATE TABLE ${q(table)}`)
    const ddl = (ddlRows as Record<string, string>[])[0]?.['Create Table'] ?? ''
    let result = `-- Table: ${commentSafe(table)}\n${ddl};\n`

    if (includeData) {
      const [rows] = await conn.query(`SELECT * FROM ${q(table)}`)
      const data = rows as Record<string, unknown>[]
      if (data.length > 0) {
        const cols = Object.keys(data[0]!)
        const colList = cols.map(q).join(', ')
        for (const row of data) {
          const vals = cols.map((c) => escapeValue(row[c], 'mysql')).join(', ')
          result += `INSERT INTO ${q(table)} (${colList}) VALUES (${vals});\n`
        }
      }
    }
    return result
  } finally {
    conn.release()
  }
}

async function dumpPg(pool: PgPool, table: string, includeData: boolean): Promise<string> {
  const q = (name: string) => quoteIdent('postgresql', name)
  const client = await pool.connect()
  try {
    // Build CREATE TABLE from information_schema — `public` only, like the schema
    // browser: a same-named table in another schema must not add its columns.
    const colRes = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    )
    const pkRes = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      [table],
    )
    const pkCols = new Set(pkRes.rows.map((r: Record<string, unknown>) => String(r.column_name)))

    const colDefs = colRes.rows.map((r: Record<string, unknown>) => {
      let def = `  ${q(String(r.column_name))} ${r.data_type}`
      if (r.character_maximum_length) def += `(${r.character_maximum_length})`
      if (r.column_default) def += ` DEFAULT ${r.column_default}`
      if (r.is_nullable === 'NO') def += ' NOT NULL'
      return def
    })
    if (pkCols.size > 0) {
      colDefs.push(`  PRIMARY KEY (${[...pkCols].map(q).join(', ')})`)
    }

    let result = `-- Table: ${commentSafe(table)}\nCREATE TABLE ${q(table)} (\n${colDefs.join(',\n')}\n);\n`

    if (includeData) {
      const dataRes = await client.query(`SELECT * FROM ${q(table)}`)
      if (dataRes.rows.length > 0) {
        const cols = dataRes.fields.map((f) => f.name)
        const colList = cols.map(q).join(', ')
        for (const row of dataRes.rows as Record<string, unknown>[]) {
          const vals = cols.map((c) => escapeValue(row[c], 'postgresql')).join(', ')
          result += `INSERT INTO ${q(table)} (${colList}) VALUES (${vals});\n`
        }
      }
    }
    return result
  } finally {
    client.release()
  }
}

async function dumpOracle(pool: OraclePool, table: string, includeData: boolean): Promise<string> {
  const q = (name: string) => quoteIdent('oracle', name)
  const conn = await pool.getConnection()
  try {
    const ddlRes = await conn.execute<[string]>(
      `SELECT DBMS_METADATA.GET_DDL('TABLE', :t) FROM DUAL`,
      [table],
    )
    const ddl = ddlRes.rows?.[0]?.[0] ?? ''
    let result = `-- Table: ${commentSafe(table)}\n${ddl};\n`

    if (includeData) {
      const dataRes = await conn.execute(`SELECT * FROM ${q(table)}`, [], { outFormat: 4002 })
      const rows = (dataRes.rows ?? []) as Record<string, unknown>[]
      if (rows.length > 0) {
        const cols = (dataRes.metaData ?? []).map((m) => m.name)
        const colList = cols.map(q).join(', ')
        for (const row of rows) {
          const vals = cols.map((c) => escapeValue(row[c], 'oracle')).join(', ')
          result += `INSERT INTO ${q(table)} (${colList}) VALUES (${vals});\n`
        }
      }
    }
    return result
  } finally {
    await conn.close()
  }
}

/**
 * Trino dump. Rows come back POSITIONALLY (like dumpSQLite), not as objects.
 * `SHOW CREATE TABLE` fails on a view — the error surfaces as an explicit 502.
 *
 * Catalog/schema are not passed explicitly: `runTrino` applies the target the
 * client was created with as a per-query override.
 */
const TRINO_DUMP_MAX_ROWS = 100_000

async function dumpTrino(client: Trino, table: string, includeData: boolean): Promise<string> {
  const ident = quoteTrinoTable(table)
  const parts: string[] = [`-- Table: ${commentSafe(table)}`]
  const ddl = await runTrino(client, `SHOW CREATE TABLE ${ident}`)
  parts.push(`${String(ddl.data[0]?.[0] ?? '')};`)
  if (includeData) {
    // Hard row cap: a Trino table is typically a data-lake table, and the whole
    // result set is materialised in memory before being serialised.
    const rows = await runTrino(client, `SELECT * FROM ${ident}`, undefined, {
      maxRows: TRINO_DUMP_MAX_ROWS,
    })
    const cols = rows.columns.map((col) => quoteTrinoIdent(col.name)).join(', ')
    for (const row of rows.data) {
      parts.push(`INSERT INTO ${ident} (${cols}) VALUES (${row.map((v) => escapeValue(v, 'trino')).join(', ')});`)
    }
    if (rows.truncated) {
      parts.push(`-- data truncated at ${TRINO_DUMP_MAX_ROWS} rows`)
    }
  }
  return parts.join('\n')
}

function escapeValue(v: unknown, driver: SqlDriver): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  // MySQL treats a backslash inside a literal as an escape character: a value
  // ending in `\` would otherwise swallow the closing quote on restore.
  const literal = (s: string) =>
    `'${(driver === 'mysql' ? s.replace(/\\/g, '\\\\') : s).replace(/'/g, "''")}'`
  if (v instanceof Date) return literal(v.toISOString())
  // Binary columns (pg `bytea`, mysql BLOB/BINARY, oracle RAW, sqlite BLOB) reach
  // this function as Buffers. They must keep their historical text rendering —
  // the object branch below would emit `{"type":"Buffer","data":[...]}`.
  if (v instanceof Uint8Array) return literal(Buffer.from(v).toString())
  // Trino ARRAY/MAP/ROW/JSON values arrive as objects — String(v) would yield "[object Object]".
  if (typeof v === 'object') return literal(JSON.stringify(v))
  return literal(String(v))
}

export { connectionsRouter }

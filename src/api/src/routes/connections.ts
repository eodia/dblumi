import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  getPoolOptions,
  ConnectionError,
} from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import type { AuthVariables } from '../middleware/auth.js'
import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'

const connectionsRouter = new Hono<AuthVariables>()

// All routes require auth
connectionsRouter.use('*', authMiddleware)

// ──────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  driver: z.enum(['postgresql', 'mysql']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string(),
  ssl: z.boolean().default(false),
  color: z.string().optional(),
  environment: z.string().max(50).optional(),
})

const UpdateSchema = CreateSchema.partial()

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function problem(status: number, title: string, detail?: string) {
  return { type: `https://dblumi.dev/errors/${status}`, title, status, detail }
}

function handleError(e: unknown, c: Parameters<typeof problem>[0]) {
  if (e instanceof ConnectionError) {
    const status = e.code === 'NOT_FOUND' ? 404 : 400
    return { status, body: problem(status, e.message) }
  }
  throw e
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
    const conn = await createConnection({ ...body, color: body.color ?? null }, userId)
    return c.json({ connection: conn }, 201)
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
    // Strip undefined keys so exactOptionalPropertyTypes is satisfied
    const body = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== undefined)
    ) as Parameters<typeof updateConnection>[1]
    try {
      const conn = await updateConnection(c.req.param('id'), body, userId)
      return c.json({ connection: conn })
    } catch (e) {
      if (e instanceof ConnectionError)
        return c.json(problem(404, e.message), 404)
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
  driver: z.enum(['postgresql', 'mysql']),
  host: z.string().min(1),
  port: z.number().int(),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string(),
  ssl: z.boolean().default(false),
})

connectionsRouter.post(
  '/test-raw',
  zValidator('json', TestRawSchema),
  async (c) => {
    const opts = c.req.valid('json')
    const tempId = `_test_${crypto.randomUUID()}`
    const start = Date.now()

    try {
      const pool = await connectionManager.getPool(tempId, opts)

      if (opts.driver === 'postgresql') {
        const pgPool = pool as import('pg').Pool
        const client = await pgPool.connect()
        await client.query('SELECT 1')
        client.release()
      } else {
        const mysqlPool = pool as import('mysql2/promise').Pool
        const conn = await mysqlPool.getConnection()
        await conn.query('SELECT 1')
        conn.release()
      }

      return c.json({ ok: true, latencyMs: Date.now() - start })
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const code = err instanceof Error && 'code' in err ? (err as Record<string, unknown>).code : undefined
      const message = raw || (code ? `Database error (${code})` : 'Connection failed')
      return c.json({ ok: false, latencyMs: Date.now() - start, error: message })
    } finally {
      await connectionManager.release(tempId)
    }
  }
)

// ──────────────────────────────────────────────
// GET /connections/:id/schema
// ──────────────────────────────────────────────

type SchemaRow = {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
  is_primary_key: boolean
}

function groupByTable(rows: SchemaRow[]) {
  const map = new Map<
    string,
    {
      name: string
      columns: Array<{
        name: string
        dataType: string
        nullable: boolean
        primaryKey: boolean
      }>
    }
  >()
  for (const row of rows) {
    if (!map.has(row.table_name)) {
      map.set(row.table_name, { name: row.table_name, columns: [] })
    }
    map.get(row.table_name)!.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      primaryKey:
        row.is_primary_key === true || (row.is_primary_key as unknown) === 1,
    })
  }
  return { tables: Array.from(map.values()) }
}

async function getPgSchema(pool: PgPool) {
  const client = await pool.connect()
  try {
    const { rows } = await client.query<SchemaRow>(`
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      LEFT JOIN (
        SELECT ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position
    `)
    return groupByTable(rows)
  } finally {
    client.release()
  }
}

async function getMySQLSchema(pool: MySQLPool) {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query(`
      SELECT
        c.TABLE_NAME   AS table_name,
        c.COLUMN_NAME  AS column_name,
        c.DATA_TYPE    AS data_type,
        c.IS_NULLABLE  AS is_nullable,
        CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END AS is_primary_key
      FROM information_schema.COLUMNS c
      JOIN information_schema.TABLES t
        ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
      WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
    `)
    return groupByTable(rows as SchemaRow[])
  } finally {
    conn.release()
  }
}

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

  const pool = await connectionManager.getPool(connectionId, poolOpts)

  try {
    const schema =
      poolOpts.driver === 'postgresql'
        ? await getPgSchema(pool as PgPool)
        : await getMySQLSchema(pool as MySQLPool)
    return c.json(schema)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const code = err instanceof Error && 'code' in err ? (err as Record<string, unknown>).code : undefined
    const message = raw || (code ? `Database error (${code})` : 'Connection failed')
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

    const pool = await connectionManager.getPool(connectionId, poolOpts)

    try {
      let count: number
      if (poolOpts.driver === 'postgresql') {
        const client = await (pool as PgPool).connect()
        try {
          const result = await client.query(`SELECT COUNT(*) AS count FROM ${table}`)
          count = parseInt(result.rows[0].count, 10)
        } finally {
          client.release()
        }
      } else {
        const conn = await (pool as MySQLPool).getConnection()
        try {
          const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM ${table}`)
          count = Number((rows as Array<Record<string, unknown>>)[0]!['count'])
        } finally {
          conn.release()
        }
      }
      return c.json({ count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query failed'
      return c.json(problem(502, message), 502)
    }
  }
)

export { connectionsRouter }

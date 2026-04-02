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
  ConnectionError,
} from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import type { AuthVariables } from '../middleware/auth.js'
import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'

const connectionsRouter = new Hono<AuthVariables>()

// All routes require auth
connectionsRouter.use('*', authMiddleware)

// ──────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  driver: z.enum(['postgresql', 'mysql', 'oracle']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().default(''),
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
    const conn = await createConnection({ ...body, color: body.color ?? null, environment: body.environment ?? null }, userId)
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
  driver: z.enum(['postgresql', 'mysql', 'oracle']),
  host: z.string().min(1),
  port: z.number().int(),
  database: z.string().default(''),
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
      } else if (opts.driver === 'mysql') {
        const mysqlPool = pool as import('mysql2/promise').Pool
        const conn = await mysqlPool.getConnection()
        await conn.query('SELECT 1')
        conn.release()
      } else {
        const oraclePool = pool as OraclePool
        const conn = await oraclePool.getConnection()
        await conn.execute('SELECT 1 FROM dual')
        await conn.close()
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
  table_type: string
  table_comment: string | null
}

type SchemaIndex = { name: string; columns: string[]; unique: boolean }
type SchemaFK = { name: string; fields: string[]; referencedDatabase: string; referencedTable: string; referencedFields: string[]; onDelete: string; onUpdate: string }

type SchemaItem = {
  name: string
  type: 'table' | 'view'
  comment: string
  columns: Array<{ name: string; dataType: string; nullable: boolean; primaryKey: boolean }>
  indexes: SchemaIndex[]
  foreignKeys: SchemaFK[]
}

type IndexRow = { table_name: string; index_name: string; is_unique: boolean; column_name: string }
type FKRow = { table_name: string; constraint_name: string; column_name: string; referenced_schema: string; referenced_table: string; referenced_column: string; on_delete: string; on_update: string }

function groupByTable(rows: SchemaRow[]) {
  const map = new Map<string, SchemaItem>()
  for (const row of rows) {
    if (!map.has(row.table_name)) {
      const isView = row.table_type === 'VIEW'
      map.set(row.table_name, { name: row.table_name, type: isView ? 'view' : 'table', comment: row.table_comment ?? '', columns: [], indexes: [], foreignKeys: [] })
    }
    map.get(row.table_name)!.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      primaryKey:
        row.is_primary_key === true || (row.is_primary_key as unknown) === 1,
    })
  }
  return map
}

function mergeIndexes(map: Map<string, SchemaItem>, indexRows: IndexRow[]) {
  for (const row of indexRows) {
    const table = map.get(row.table_name)
    if (!table) continue
    let idx = table.indexes.find((i) => i.name === row.index_name)
    if (!idx) {
      idx = { name: row.index_name, columns: [], unique: row.is_unique }
      table.indexes.push(idx)
    }
    idx.columns.push(row.column_name)
  }
}

function mergeForeignKeys(map: Map<string, SchemaItem>, fkRows: FKRow[]) {
  for (const row of fkRows) {
    const table = map.get(row.table_name)
    if (!table) continue
    let fk = table.foreignKeys.find((f) => f.name === row.constraint_name)
    if (!fk) {
      fk = { name: row.constraint_name, fields: [], referencedDatabase: row.referenced_schema, referencedTable: row.referenced_table, referencedFields: [], onDelete: row.on_delete, onUpdate: row.on_update }
      table.foreignKeys.push(fk)
    }
    fk.fields.push(row.column_name)
    fk.referencedFields.push(row.referenced_column)
  }
  return { tables: Array.from(map.values()) }
}

type FunctionRow = {
  name: string
  kind: string       // 'function' or 'procedure'
  return_type: string
  arguments: string
  language: string
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
        t.table_type,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
        obj_description(('public.' || c.table_name)::regclass, 'pg_class') AS table_comment
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
      WHERE c.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY t.table_type, c.table_name, c.ordinal_position
    `)

    const { rows: funcRows } = await client.query<FunctionRow>(`
      SELECT
        p.proname AS name,
        CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind,
        pg_get_function_result(p.oid) AS return_type,
        pg_get_function_identity_arguments(p.oid) AS arguments,
        l.lanname AS language
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
      ORDER BY p.prokind, p.proname
    `)

    const { rows: idxRows } = await client.query<IndexRow>(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        a.attname AS column_name
      FROM pg_class t
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = 'public' AND t.relkind = 'r' AND NOT ix.indisprimary
      ORDER BY t.relname, i.relname, array_position(ix.indkey, a.attnum)
    `)

    const { rows: fkRows } = await client.query<FKRow>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema  AS referenced_schema,
        ccu.table_name    AS referenced_table,
        ccu.column_name   AS referenced_column,
        rc.delete_rule    AS on_delete,
        rc.update_rule    AS on_update
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    `)

    const tableMap = groupByTable(rows)
    mergeIndexes(tableMap, idxRows)
    const result = mergeForeignKeys(tableMap, fkRows)
    return { ...result, functions: funcRows }
  } finally {
    client.release()
  }
}

async function getMySQLSchema(pool: MySQLPool) {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query(`
      SELECT
        c.TABLE_NAME    AS table_name,
        c.COLUMN_NAME   AS column_name,
        c.DATA_TYPE     AS data_type,
        c.IS_NULLABLE   AS is_nullable,
        t.TABLE_TYPE    AS table_type,
        CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END AS is_primary_key,
        t.TABLE_COMMENT AS table_comment
      FROM information_schema.COLUMNS c
      JOIN information_schema.TABLES t
        ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
      WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY t.TABLE_TYPE, c.TABLE_NAME, c.ORDINAL_POSITION
    `)

    const [funcRows] = await conn.query(`
      SELECT
        ROUTINE_NAME AS name,
        LOWER(ROUTINE_TYPE) AS kind,
        DTD_IDENTIFIER AS return_type,
        ROUTINE_COMMENT AS arguments,
        EXTERNAL_LANGUAGE AS language
      FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = DATABASE()
      ORDER BY ROUTINE_TYPE, ROUTINE_NAME
    `)

    const [idxRows] = await conn.query(`
      SELECT
        TABLE_NAME  AS table_name,
        INDEX_NAME  AS index_name,
        NOT NON_UNIQUE AS is_unique,
        COLUMN_NAME AS column_name
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME != 'PRIMARY'
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    `)

    const [fkRows] = await conn.query(`
      SELECT
        kcu.TABLE_NAME        AS table_name,
        kcu.CONSTRAINT_NAME   AS constraint_name,
        kcu.COLUMN_NAME       AS column_name,
        kcu.REFERENCED_TABLE_SCHEMA  AS referenced_schema,
        kcu.REFERENCED_TABLE_NAME    AS referenced_table,
        kcu.REFERENCED_COLUMN_NAME   AS referenced_column,
        rc.DELETE_RULE        AS on_delete,
        rc.UPDATE_RULE        AS on_update
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
      WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `)

    const tableMap = groupByTable(rows as SchemaRow[])
    mergeIndexes(tableMap, idxRows as IndexRow[])
    const result = mergeForeignKeys(tableMap, fkRows as FKRow[])
    return { ...result, functions: funcRows as FunctionRow[] }
  } finally {
    conn.release()
  }
}

async function getOracleSchema(pool: OraclePool) {
  const conn = await pool.getConnection()
  try {
    const { rows: colRows } = await conn.execute<[string, string, string, string, number]>(`
      SELECT
        c.TABLE_NAME,
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.NULLABLE,
        CASE WHEN p.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
      FROM USER_TAB_COLUMNS c
      LEFT JOIN (
        SELECT cc.TABLE_NAME, cc.COLUMN_NAME
        FROM USER_CONSTRAINTS uc
        JOIN USER_CONS_COLUMNS cc ON cc.CONSTRAINT_NAME = uc.CONSTRAINT_NAME
        WHERE uc.CONSTRAINT_TYPE = 'P'
      ) p ON p.TABLE_NAME = c.TABLE_NAME AND p.COLUMN_NAME = c.COLUMN_NAME
      ORDER BY c.TABLE_NAME, c.COLUMN_ID
    `, [], { outFormat: 4001 /* ARRAY */ })

    const map = new Map<string, SchemaItem>()
    for (const row of (colRows ?? []) as [string, string, string, string, number][]) {
      const [tableName, columnName, dataType, nullable, isPk] = row
      if (!tableName) continue
      if (!map.has(tableName)) {
        map.set(tableName, { name: tableName, type: 'table', comment: '', columns: [], indexes: [], foreignKeys: [] })
      }
      map.get(tableName)!.columns.push({
        name: columnName ?? '',
        dataType: dataType ?? 'unknown',
        nullable: nullable === 'Y',
        primaryKey: isPk === 1,
      })
    }

    const { rows: fkRows } = await conn.execute<[string, string, string, string, string, string]>(`
      SELECT
        uc.TABLE_NAME,
        uc.CONSTRAINT_NAME,
        cc.COLUMN_NAME,
        rc.TABLE_NAME AS REF_TABLE,
        rcc.COLUMN_NAME AS REF_COLUMN,
        uc.DELETE_RULE
      FROM USER_CONSTRAINTS uc
      JOIN USER_CONS_COLUMNS cc ON cc.CONSTRAINT_NAME = uc.CONSTRAINT_NAME
      JOIN USER_CONSTRAINTS rc ON rc.CONSTRAINT_NAME = uc.R_CONSTRAINT_NAME
      JOIN USER_CONS_COLUMNS rcc ON rcc.CONSTRAINT_NAME = uc.R_CONSTRAINT_NAME AND rcc.POSITION = cc.POSITION
      WHERE uc.CONSTRAINT_TYPE = 'R'
      ORDER BY uc.TABLE_NAME, uc.CONSTRAINT_NAME, cc.POSITION
    `, [], { outFormat: 4001 })

    for (const row of (fkRows ?? []) as [string, string, string, string, string, string][]) {
      const [tableName, constraintName, columnName, refTable, refColumn, deleteRule] = row
      if (!tableName) continue
      const table = map.get(tableName)
      if (!table) continue
      let fk = table.foreignKeys.find((f) => f.name === constraintName)
      if (!fk) {
        fk = { name: constraintName ?? '', fields: [], referencedDatabase: '', referencedTable: refTable ?? '', referencedFields: [], onDelete: deleteRule ?? 'NO ACTION', onUpdate: 'NO ACTION' }
        table.foreignKeys.push(fk)
      }
      fk.fields.push(columnName ?? '')
      fk.referencedFields.push(refColumn ?? '')
    }

    return { tables: Array.from(map.values()), functions: [] }
  } finally {
    await conn.close()
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
        : poolOpts.driver === 'mysql'
        ? await getMySQLSchema(pool as MySQLPool)
        : await getOracleSchema(pool as OraclePool)
    return c.json(schema)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const code = err instanceof Error && 'code' in err ? (err as Record<string, unknown>).code : undefined
    const message = raw || (code ? `Database error (${code})` : 'Connection failed')
    logger.warn({ connectionId, err: raw, code }, 'Schema fetch failed')
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
      } else if (poolOpts.driver === 'mysql') {
        const conn = await (pool as MySQLPool).getConnection()
        try {
          const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM ${table}`)
          count = Number((rows as Array<Record<string, unknown>>)[0]!['count'])
        } finally {
          conn.release()
        }
      } else {
        const conn = await (pool as OraclePool).getConnection()
        try {
          const result = await conn.execute(`SELECT COUNT(*) AS "count" FROM ${table}`, [], { outFormat: 4002 })
          count = Number((result.rows as Record<string, unknown>[])[0]!['count'])
        } finally {
          await conn.close()
        }
      }
      return c.json({ count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query failed'
      return c.json(problem(502, message), 502)
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

  const pool = await connectionManager.getPool(connectionId, poolOpts)

  try {
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
    const message = err instanceof Error ? err.message : 'Failed to get function'
    return c.json(problem(502, message), 502)
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

  const pool = await connectionManager.getPool(connectionId, poolOpts)

  try {
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
    const message = err instanceof Error ? err.message : 'Failed to list databases'
    return c.json(problem(502, message), 502)
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

    // Release existing pool so it reconnects with the new DB
    await connectionManager.release(connectionId)

    // Re-create pool with the new database (runtime only, not persisted to connection config)
    const poolOpts = await getPoolOptions(connectionId, userId)
    await connectionManager.getPool(connectionId, { ...poolOpts, database })

    return c.json({ database })
  }
)

// ──────────────────────────────────────────────
// GET /connections/:id/shares
// ──────────────────────────────────────────────

connectionsRouter.get('/:id/shares', async (c) => {
  const connectionId = c.req.param('id')

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

    // Replace all groups
    await db.delete(connectionGroups).where(eq(connectionGroups.connectionId, connectionId))
    for (const groupId of groupIds) {
      await db.insert(connectionGroups).values({ connectionId, groupId }).onConflictDoNothing()
    }

    // Replace all shared users
    await db.delete(connectionUsers).where(eq(connectionUsers.connectionId, connectionId))
    for (const userId of userIds) {
      await db.insert(connectionUsers).values({ connectionId, userId }).onConflictDoNothing()
    }

    return c.json({ groupIds, userIds })
  },
)

async function getDbStats(pool: PgPool | MySQLPool | OraclePool, driver: string) {
  let version: string | null = null
  let encoding: string | null = null
  let timezone: string | null = null
  let sizePretty: string | null = null
  let sizeBytes: number | null = null

  try {
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
        if (sizeBytes) sizePretty = sizeBytes > 1_073_741_824
          ? `${(sizeBytes / 1_073_741_824).toFixed(1)} GB`
          : sizeBytes > 1_048_576
          ? `${(sizeBytes / 1_048_576).toFixed(1)} MB`
          : `${Math.round(sizeBytes / 1024)} KB`
      } finally { conn.release() }
    } else {
      // Oracle: best-effort, many views need DBA grants
      const oracle = pool as OraclePool
      const conn = await oracle.getConnection()
      try {
        const r1 = await conn.execute<[string]>('SELECT banner FROM v$version WHERE ROWNUM = 1', [], { outFormat: 4001 })
        version = (r1.rows?.[0] as [string])?.[0] ?? null
      } catch { /* v$version may need DBA */ }
      try {
        const conn2 = await oracle.getConnection()
        try {
          const r2 = await conn2.execute<[number]>('SELECT SUM(bytes) FROM user_segments', [], { outFormat: 4001 })
          sizeBytes = Number((r2.rows?.[0] as [number])?.[0]) || null
          if (sizeBytes) sizePretty = sizeBytes > 1_073_741_824
            ? `${(sizeBytes / 1_073_741_824).toFixed(1)} GB`
            : `${(sizeBytes / 1_048_576).toFixed(1)} MB`
        } finally { await conn2.close() }
      } catch { /* segments may not be accessible */ }
      try { await conn.close() } catch { /* ignore */ }
    }
  } catch (err) {
    logger.warn({ err }, 'getDbStats partial failure')
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

  const pool = await connectionManager.getPool(connectionId, poolOpts)

  try {
    const stats = await getDbStats(pool, poolOpts.driver)
    return c.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stats unavailable'
    return c.json(problem(502, message), 502)
  }
})

export { connectionsRouter }

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { streamCopilotResponse, CopilotError } from '../services/copilot.service.js'
import { getPoolOptions } from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import { logger } from '../logger.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import type { AuthVariables } from '../middleware/auth.js'
import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'

const copilotRouter = new Hono<AuthVariables>()
copilotRouter.use('*', authMiddleware)

const CopilotSchema = z.object({
  connectionId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1),
  })).min(1),
  context: z.object({
    tabKind: z.enum(['query', 'table', 'function']),
    tabName: z.string(),
    sql: z.string(),
  }).optional(),
})

// ── Schema fetching (reuse logic from connections route) ──

type SchemaRow = {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
  is_primary_key: boolean
}

function groupByTable(rows: SchemaRow[]) {
  const map = new Map<string, { name: string; columns: Array<{ name: string; dataType: string; nullable: boolean; primaryKey: boolean }> }>()
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, { name: row.table_name, columns: [] })
    map.get(row.table_name)!.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      primaryKey: row.is_primary_key === true || (row.is_primary_key as unknown) === 1,
    })
  }
  return Array.from(map.values())
}

async function fetchSchema(pool: unknown, driver: string) {
  if (driver === 'postgresql') {
    const pgPool = pool as PgPool
    const client = await pgPool.connect()
    try {
      const { rows } = await client.query<SchemaRow>(`
        SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
        LEFT JOIN (
          SELECT ku.table_name, ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
        ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position
      `)
      return groupByTable(rows)
    } finally {
      client.release()
    }
  } else {
    const mysqlPool = pool as MySQLPool
    const conn = await mysqlPool.getConnection()
    try {
      const [rows] = await conn.query(`
        SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type,
          c.IS_NULLABLE AS is_nullable,
          CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END AS is_primary_key
        FROM information_schema.COLUMNS c
        JOIN information_schema.TABLES t ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
        WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
      `)
      return groupByTable(rows as SchemaRow[])
    } finally {
      conn.release()
    }
  }
}

// ── Route ──

copilotRouter.post(
  '/',
  zValidator('json', CopilotSchema),
  async (c) => {
    const { connectionId, messages, context } = c.req.valid('json')
    const userId = c.get('userId')

    // Resolve connection
    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json({ type: 'error', message: 'Connexion introuvable.' }, 404)
    }

    // Fetch user language preference
    const userRow = await db
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    const lang = userRow?.language ?? 'en'

    // Fetch schema + functions for context
    let schema: Awaited<ReturnType<typeof fetchSchema>> = []
    let functions: Array<{ name: string; kind: string; return_type: string; arguments: string }> = []
    try {
      const pool = await connectionManager.getPool(connectionId, poolOpts)
      schema = await fetchSchema(pool, poolOpts.driver)

      // Fetch functions/procedures
      if (poolOpts.driver === 'postgresql') {
        const pgPool = pool as PgPool
        const client = await pgPool.connect()
        try {
          const { rows } = await client.query(`
            SELECT p.proname AS name,
              CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind,
              pg_get_function_result(p.oid) AS return_type,
              pg_get_function_identity_arguments(p.oid) AS arguments
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
            ORDER BY p.proname
          `)
          functions = rows as typeof functions
        } finally { client.release() }
      } else {
        const mysqlPool = pool as MySQLPool
        const conn = await mysqlPool.getConnection()
        try {
          const [rows] = await conn.query(`
            SELECT ROUTINE_NAME AS name, LOWER(ROUTINE_TYPE) AS kind,
              DTD_IDENTIFIER AS return_type, '' AS arguments
            FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()
            ORDER BY ROUTINE_NAME
          `)
          functions = rows as typeof functions
        } finally { conn.release() }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch schema for copilot')
    }

    // Stream response
    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      try {
        for await (const chunk of streamCopilotResponse(
          userId,
          messages,
          schema,
          functions,
          poolOpts.driver,
          poolOpts.database ?? '',
          lang,
          context,
        )) {
          if (chunk.type === 'text') {
            await send('text', { text: chunk.text })
          } else if (chunk.type === 'done') {
            await send('done', {})
          } else if (chunk.type === 'error') {
            await send('error', { message: chunk.message })
          }
        }
      } catch (err) {
        if (err instanceof CopilotError) {
          await send('error', { message: err.message })
        } else {
          const msg = err instanceof Error ? err.message : 'Erreur interne du copilot'
          logger.error({ err }, 'Copilot stream error')
          await send('error', { message: msg })
        }
      }
    })
  },
)

export { copilotRouter }

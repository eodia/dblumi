import { eq, and, or, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { connections, userGroups, connectionGroups, connectionUsers } from '../db/schema.js'
import { encrypt, decrypt } from '../lib/crypto.js'
import { connectionManager, type DbPool, type PoolOptions } from '../lib/connection-manager.js'
import { assertSqlitePathAllowed, SqlitePathError } from '../lib/sqlite-path.js'
import { isMongoUri, splitMongoHostCredentials } from '../lib/mongo.js'
import type { DbDriver } from '@dblumi/shared'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type ConnectionView = {
  id: string
  name: string
  driver: DbDriver
  host: string | null
  port: number | null
  database: string | null
  username: string | null
  filePath: string | null
  ssl: boolean
  options: Record<string, string> | null
  color: string | null
  environment: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type CreateConnectionInput = {
  name: string
  driver: DbDriver
  // Server-based drivers
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  ssl?: boolean
  /** Driver-specific, non-secret settings (Snowflake warehouse and role). */
  options?: Record<string, string> | null
  // SQLite
  filePath?: string
  color?: string | null
  environment?: string | null
}

export type UpdateConnectionInput = Partial<CreateConnectionInput>

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function toView(row: typeof connections.$inferSelect): ConnectionView {
  return {
    id: row.id,
    name: row.name,
    driver: row.driver as DbDriver,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    filePath: row.filePath,
    ssl: row.ssl,
    options: row.options ?? null,
    color: row.color,
    environment: row.environment,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Driver-specific checks and clean-ups before a connection is stored:
 *  - SQLite: the file must be allowed (never dblumi's own database);
 *  - MongoDB: credentials pasted inside a URI host are moved to the dedicated
 *    fields, so the password ends up encrypted instead of in clear in `host`.
 */
export function normalizeConnectionInput<
  T extends {
    host?: string | undefined
    port?: number | undefined
    database?: string | undefined
    username?: string | undefined
    password?: string | undefined
    filePath?: string | undefined
    ssl?: boolean | undefined
  },
>(input: T, driver: DbDriver): T {
  // Redis: a pasted redis:// / rediss:// URL is split into the dedicated fields
  // (the password then ends up encrypted, never in clear in `host`).
  if (driver === 'redis' && input.host && /^rediss?:\/\//i.test(input.host.trim())) {
    try {
      const url = new URL(input.host.trim())
      const db = url.pathname.replace(/^\//, '')
      return {
        ...input,
        host: url.hostname.replace(/^\[|\]$/g, ''),
        ...(url.port ? { port: Number(url.port) } : {}),
        ...(db && !input.database ? { database: db } : {}),
        ...(url.username && !input.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password && !input.password ? { password: decodeURIComponent(url.password) } : {}),
        ...(url.protocol === 'rediss:' ? { ssl: true } : {}),
      }
    } catch {
      throw new ConnectionError('INVALID_HOST', 'URL Redis invalide.')
    }
  }
  if (driver === 'sqlite' && input.filePath !== undefined) {
    try {
      assertSqlitePathAllowed(input.filePath)
    } catch (err) {
      if (err instanceof SqlitePathError) throw new ConnectionError('FORBIDDEN_PATH', err.message)
      throw err
    }
  }
  if (driver === 'mongodb' && input.host && isMongoUri(input.host)) {
    const { host, username, password } = splitMongoHostCredentials(input.host)
    return {
      ...input,
      host,
      ...(username && !input.username ? { username } : {}),
      ...(password !== undefined && !input.password ? { password } : {}),
    }
  }
  return input
}

/** Keeps only non-empty string settings; null when nothing is left. */
function cleanOptions(options: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!options) return null
  const entries = Object.entries(options).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
  return entries.length ? Object.fromEntries(entries.map(([k, v]) => [k, v.trim()])) : null
}

// ──────────────────────────────────────────────
// List
// ──────────────────────────────────────────────

export async function listConnections(userId: string): Promise<ConnectionView[]> {
  // Get user's group IDs
  const userGroupRows = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId))
  const groupIds = userGroupRows.map((r) => r.groupId)

  // Get connection IDs accessible via groups
  let groupConnIds: string[] = []
  if (groupIds.length > 0) {
    const groupConnRows = await db
      .select({ connectionId: connectionGroups.connectionId })
      .from(connectionGroups)
      .where(inArray(connectionGroups.groupId, groupIds))
    groupConnIds = groupConnRows.map((r) => r.connectionId)
  }

  // Get connection IDs shared directly with the user
  const userShareRows = await db
    .select({ connectionId: connectionUsers.connectionId })
    .from(connectionUsers)
    .where(eq(connectionUsers.userId, userId))
  const userShareConnIds = userShareRows.map((r) => r.connectionId)

  // Get all accessible connections: own + group-assigned + user-shared
  const conditions = [eq(connections.createdBy, userId)]
  if (groupConnIds.length > 0) {
    conditions.push(inArray(connections.id, groupConnIds))
  }
  if (userShareConnIds.length > 0) {
    conditions.push(inArray(connections.id, userShareConnIds))
  }

  const rows = await db
    .select()
    .from(connections)
    .where(or(...conditions))
  return rows.map(toView)
}

// ──────────────────────────────────────────────
// Get one
// ──────────────────────────────────────────────

export async function getConnection(
  id: string,
  userId: string
): Promise<ConnectionView> {
  // Check direct access (own connection)
  let row = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.createdBy, userId)))
    .get()

  // Check user-sharing access
  if (!row) {
    const userShare = await db
      .select({ connectionId: connectionUsers.connectionId })
      .from(connectionUsers)
      .where(and(eq(connectionUsers.connectionId, id), eq(connectionUsers.userId, userId)))
      .get()
    if (userShare) {
      row = await db.select().from(connections).where(eq(connections.id, id)).get()
    }
  }

  // Check group-based access
  if (!row) {
    const groupAccess = await db
      .select({ connectionId: connectionGroups.connectionId })
      .from(connectionGroups)
      .innerJoin(userGroups, eq(connectionGroups.groupId, userGroups.groupId))
      .where(and(eq(connectionGroups.connectionId, id), eq(userGroups.userId, userId)))
      .get()
    if (groupAccess) {
      row = await db.select().from(connections).where(eq(connections.id, id)).get()
    }
  }

  if (!row) throw new ConnectionError('NOT_FOUND', 'Connexion introuvable.')
  return toView(row)
}

/**
 * Who may read or change a connection's sharing: its owner, or an admin.
 * Having the connection shared with you is not enough — a user it was shared
 * with could otherwise add anyone (or remove everyone else).
 */
export async function canManageConnection(id: string, userId: string, role: string): Promise<boolean> {
  const row = await db
    .select({ createdBy: connections.createdBy })
    .from(connections)
    .where(eq(connections.id, id))
    .get()
  return !!row && (row.createdBy === userId || role === 'admin')
}

// ──────────────────────────────────────────────
// Create
// ──────────────────────────────────────────────

export async function createConnection(
  rawInput: CreateConnectionInput,
  userId: string
): Promise<ConnectionView> {
  const input = normalizeConnectionInput(rawInput, rawInput.driver)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const passwordEncrypted =
    input.driver === 'sqlite' ? null : encrypt(input.password ?? '')

  await db.insert(connections).values({
    id,
    name: input.name,
    driver: input.driver,
    host: input.host ?? null,
    port: input.port ?? null,
    database: input.database ?? null,
    username: input.username ?? null,
    passwordEncrypted,
    filePath: input.filePath ?? null,
    ssl: input.ssl ?? false,
    options: cleanOptions(input.options),
    color: input.color ?? null,
    environment: input.environment ?? null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  return getConnection(id, userId)
}

// ──────────────────────────────────────────────
// Update
// ──────────────────────────────────────────────

export async function updateConnection(
  id: string,
  rawInput: UpdateConnectionInput,
  userId: string
): Promise<ConnectionView> {
  const existing = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.createdBy, userId)))
    .get()

  if (!existing) throw new ConnectionError('NOT_FOUND', 'Connexion introuvable.')
  const driver = rawInput.driver ?? (existing.driver as DbDriver)
  const input = normalizeConnectionInput(rawInput, driver)

  const now = new Date().toISOString()
  const updates: Partial<typeof connections.$inferInsert> = { updatedAt: now }

  if (input.name !== undefined) updates.name = input.name
  if (input.driver !== undefined) updates.driver = input.driver
  if (input.host !== undefined) updates.host = input.host
  if (input.port !== undefined) updates.port = input.port
  if (input.database !== undefined) updates.database = input.database
  if (input.username !== undefined) updates.username = input.username
  if (input.filePath !== undefined) updates.filePath = input.filePath
  if (input.ssl !== undefined) updates.ssl = input.ssl
  if (input.options !== undefined) updates.options = cleanOptions(input.options)
  if (input.color !== undefined) updates.color = input.color
  if (input.environment !== undefined) updates.environment = input.environment
  // Known limitation: an empty string means "unchanged", never "clear it". A Trino
  // connection created with a password therefore cannot be switched back to
  // anonymous from the UI — it has to be deleted and recreated.
  if (input.password !== undefined && input.password !== '' && driver !== 'sqlite') {
    updates.passwordEncrypted = encrypt(input.password)
  }

  await db
    .update(connections)
    .set(updates)
    .where(eq(connections.id, id))

  // Release the stale pool so the next query gets fresh settings — but not for a
  // rename or a colour change, which used to cut every running query.
  const poolFields = ['driver', 'host', 'port', 'database', 'username', 'filePath', 'ssl'] as const
  const affectsPool =
    updates.passwordEncrypted !== undefined ||
    poolFields.some((k) => updates[k] !== undefined && updates[k] !== existing[k]) ||
    (updates.options !== undefined && JSON.stringify(updates.options) !== JSON.stringify(existing.options ?? null))
  if (affectsPool) await connectionManager.release(id)

  return getConnection(id, userId)
}

// ──────────────────────────────────────────────
// Delete
// ──────────────────────────────────────────────

export async function deleteConnection(
  id: string,
  userId: string
): Promise<void> {
  const existing = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.createdBy, userId)))
    .get()

  if (!existing) throw new ConnectionError('NOT_FOUND', 'Connexion introuvable.')

  await connectionManager.release(id)
  await db.delete(connections).where(eq(connections.id, id))
}

// ──────────────────────────────────────────────
// Test connection (ping)
// ──────────────────────────────────────────────

export async function testConnection(
  id: string,
  userId: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const row = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.createdBy, userId)))
    .get()

  if (!row) throw new ConnectionError('NOT_FOUND', 'Connexion introuvable.')

  const password = row.passwordEncrypted ? decrypt(row.passwordEncrypted as Buffer) : ''
  const start = Date.now()

  try {
    const opts = buildPoolOptions(row, password)
    const pool = await connectionManager.getPool(id, opts)
    await pingPool(opts.driver, pool, connectionManager.liveDatabase(id) ?? opts.database, opts.options)

    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, latencyMs: Date.now() - start, error: message }
  }
}

/**
 * Round-trip on a pool. Every borrowed connection is given back in a `finally`:
 * a ping failing after connect() used to leak it — and made test-raw hang, since
 * pg's `end()` waits for borrowed clients.
 */
export async function pingPool(
  driver: DbDriver,
  pool: DbPool,
  database?: string | null,
  options?: Record<string, string> | null,
): Promise<void> {
  switch (driver) {
    case 'postgresql': {
      const client = await (pool as import('pg').Pool).connect()
      try {
        await client.query('SELECT 1')
      } finally {
        client.release()
      }
      return
    }
    case 'mysql': {
      const conn = await (pool as import('mysql2/promise').Pool).getConnection()
      try {
        await conn.query('SELECT 1')
      } finally {
        conn.release()
      }
      return
    }
    case 'oracle': {
      const conn = await (pool as import('oracledb').Pool).getConnection()
      try {
        await conn.execute('SELECT 1 FROM dual')
      } finally {
        await conn.close()
      }
      return
    }
    case 'trino': {
      // `pingTrino` runs SELECT 1 then resolves the catalog AND the schema, so a
      // typo in either half fails here rather than later as an empty schema browser.
      const { pingTrino, parseTrinoTarget, TRINO_PING_TIMEOUT_MS } = await import('../lib/trino.js')
      await pingTrino(pool as import('trino-client').Trino, parseTrinoTarget(database), TRINO_PING_TIMEOUT_MS)
      return
    }
    case 'mongodb': {
      const { pingMongo, mongoDatabaseName } = await import('../lib/mongo.js')
      await pingMongo(pool as import('mongodb').MongoClient, mongoDatabaseName(database))
      return
    }
    case 'sqlite':
      await (pool as import('@libsql/client').Client).execute('SELECT 1')
      return
    case 'mssql':
      await (pool as import('mssql').ConnectionPool).request().query('SELECT 1')
      return
    case 'snowflake': {
      const { pingSnowflake } = await import('../lib/snowflake.js')
      await pingSnowflake(pool as import('../lib/snowflake.js').SnowflakeClient, database, options?.['warehouse'])
      return
    }
    case 'redis':
      await (pool as import('../lib/redis.js').RedisConn).sendCommand(['PING'])
      return
  }
}

// ──────────────────────────────────────────────
// Get decrypted pool options (used by query executor)
// ──────────────────────────────────────────────

export async function getPoolOptions(
  id: string,
  userId: string
): Promise<PoolOptions> {
  // Verify access using the same logic as getConnection (own + user-shared + group)
  await getConnection(id, userId)

  // Now get the full row with encrypted password
  const row = await db.select().from(connections).where(eq(connections.id, id)).get()
  if (!row) throw new ConnectionError('NOT_FOUND', 'Connexion introuvable.')

  const password = row.passwordEncrypted ? decrypt(row.passwordEncrypted as Buffer) : ''
  return buildPoolOptions(row, password)
}

function buildPoolOptions(
  row: typeof connections.$inferSelect,
  password: string
): PoolOptions {
  const opts: PoolOptions = { driver: row.driver as PoolOptions['driver'], ssl: row.ssl }
  if (row.host !== null) opts.host = row.host
  if (row.port !== null) opts.port = row.port
  if (row.database !== null) opts.database = row.database
  if (row.username !== null) opts.username = row.username
  if (row.filePath !== null) opts.filePath = row.filePath
  if (row.options) opts.options = row.options
  if (row.driver !== 'sqlite') opts.password = password
  return opts
}

// ──────────────────────────────────────────────
// Error class
// ──────────────────────────────────────────────

export class ConnectionError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ConnectionError'
  }
}

import { eq, and, or, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { connections, userGroups, connectionGroups, connectionUsers } from '../db/schema.js'
import { encrypt, decrypt } from '../lib/crypto.js'
import { connectionManager } from '../lib/connection-manager.js'
import type { DbDriver } from '@dblumi/shared'
import type { PoolOptions } from '../lib/connection-manager.js'

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
    color: row.color,
    environment: row.environment,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
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

// ──────────────────────────────────────────────
// Create
// ──────────────────────────────────────────────

export async function createConnection(
  input: CreateConnectionInput,
  userId: string
): Promise<ConnectionView> {
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
  input: UpdateConnectionInput,
  userId: string
): Promise<ConnectionView> {
  const existing = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.createdBy, userId)))
    .get()

  if (!existing) throw new ConnectionError('NOT_FOUND', 'Connexion introuvable.')

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
  if (input.color !== undefined) updates.color = input.color
  if (input.environment !== undefined) updates.environment = input.environment
  if (input.password !== undefined && input.password !== '' && input.driver !== 'sqlite') {
    updates.passwordEncrypted = encrypt(input.password)
  }

  await db
    .update(connections)
    .set(updates)
    .where(eq(connections.id, id))

  // Release stale pool so next query gets fresh credentials
  await connectionManager.release(id)

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

    if (row.driver === 'postgresql') {
      const pgPool = pool as import('pg').Pool
      const client = await pgPool.connect()
      await client.query('SELECT 1')
      client.release()
    } else if (row.driver === 'mysql') {
      const mysqlPool = pool as import('mysql2/promise').Pool
      const conn = await mysqlPool.getConnection()
      await conn.query('SELECT 1')
      conn.release()
    } else if (row.driver === 'oracle') {
      const oraclePool = pool as import('oracledb').Pool
      const conn = await oraclePool.getConnection()
      await conn.execute('SELECT 1 FROM dual')
      await conn.close()
    } else {
      // SQLite
      const client = pool as import('@libsql/client').Client
      await client.execute('SELECT 1')
    }

    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, latencyMs: Date.now() - start, error: message }
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

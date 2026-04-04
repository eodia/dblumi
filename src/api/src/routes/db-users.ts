import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { getPoolOptions } from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import { logger } from '../logger.js'
import type { AuthVariables } from '../middleware/auth.js'
import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'

const dbUsersRouter = new Hono<AuthVariables>()
dbUsersRouter.use('*', authMiddleware)

// ── Zod schemas ──────────────────────────────────
const TablePrivSchema = z.object({
  database: z.string().min(1),
  table: z.string().min(1),
  privileges: z.array(z.string()),
})

const AdvancedSchema = z.object({
  maxQueriesPerHour: z.number().int().min(0).optional(),
  maxUpdatesPerHour: z.number().int().min(0).optional(),
  maxConnectionsPerHour: z.number().int().min(0).optional(),
  maxUserConnections: z.number().int().min(0).optional(),
  connectionLimit: z.number().int().min(-1).optional(),
  profile: z.string().optional(),
})

const CreateSchema = z.object({
  username: z.string().min(1).max(80),
  host: z.string().default('%'),
  password: z.string().min(1),
  serverPrivileges: z.record(z.string(), z.boolean()),
  tablePrivileges: z.array(TablePrivSchema).default([]),
  advanced: AdvancedSchema.default({}),
})

const UpdateSchema = z.object({
  host: z.string().default('%'),
  password: z.string().optional(),
  serverPrivileges: z.record(z.string(), z.boolean()),
  tablePrivileges: z.array(TablePrivSchema).default([]),
  advanced: AdvancedSchema.default({}),
})

// ── Types ────────────────────────────────────────
type DbUser = { username: string; host?: string; plugin?: string; status?: string }

type TablePrivilege = z.infer<typeof TablePrivSchema>

type CreateUserInput = z.infer<typeof CreateSchema>

type UpdateUserInput = z.infer<typeof UpdateSchema>

type DbUserPrivileges = {
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: {
    maxQueriesPerHour?: number
    maxUpdatesPerHour?: number
    maxConnectionsPerHour?: number
    maxUserConnections?: number
    connectionLimit?: number
    profile?: string
  }
}

// ── MySQL: column name → SQL privilege name ──────
const MYSQL_PRIV_COLS: Record<string, string> = {
  Select_priv: 'SELECT', Insert_priv: 'INSERT', Update_priv: 'UPDATE',
  Delete_priv: 'DELETE', Create_priv: 'CREATE', Drop_priv: 'DROP',
  Reload_priv: 'RELOAD', Shutdown_priv: 'SHUTDOWN', Process_priv: 'PROCESS',
  File_priv: 'FILE', Grant_priv: 'GRANT OPTION', References_priv: 'REFERENCES',
  Index_priv: 'INDEX', Alter_priv: 'ALTER', Show_db_priv: 'SHOW DATABASES',
  Super_priv: 'SUPER', Create_tmp_table_priv: 'CREATE TEMPORARY TABLES',
  Lock_tables_priv: 'LOCK TABLES', Execute_priv: 'EXECUTE',
  Repl_slave_priv: 'REPLICATION SLAVE', Repl_client_priv: 'REPLICATION CLIENT',
  Create_view_priv: 'CREATE VIEW', Show_view_priv: 'SHOW VIEW',
  Create_routine_priv: 'CREATE ROUTINE', Alter_routine_priv: 'ALTER ROUTINE',
  Create_user_priv: 'CREATE USER', Event_priv: 'EVENT', Trigger_priv: 'TRIGGER',
}

// ── MySQL helpers ────────────────────────────────
async function listUsersMysql(pool: MySQLPool): Promise<{ users: DbUser[]; count: number }> {
  const [rows] = await pool.execute<any[]>(
    'SELECT User AS username, Host AS host, plugin FROM mysql.user ORDER BY User, Host'
  )
  const [countRows] = await pool.execute<any[]>('SELECT COUNT(*) AS count FROM mysql.user')
  return { users: rows as DbUser[], count: Number((countRows as any[])[0].count) }
}

async function getPrivilegesMysql(pool: MySQLPool, username: string, host: string): Promise<DbUserPrivileges> {
  const cols = Object.keys(MYSQL_PRIV_COLS).join(', ')
  const [rows] = await pool.execute<any[]>(
    `SELECT ${cols}, max_questions, max_updates, max_connections, max_user_connections FROM mysql.user WHERE User = ? AND Host = ?`,
    [username, host]
  )
  const row = (rows as any[])[0] ?? {}
  const serverPrivileges: Record<string, boolean> = {}
  for (const [col, priv] of Object.entries(MYSQL_PRIV_COLS)) {
    serverPrivileges[priv] = row[col] === 'Y'
  }
  const [tableRows] = await pool.execute<any[]>(
    'SELECT Db AS `database`, Table_name AS `table`, Table_priv AS privileges FROM mysql.tables_priv WHERE User = ? AND Host = ?',
    [username, host]
  )
  const tablePrivileges: TablePrivilege[] = (tableRows as any[]).map((r) => ({
    database: r.database,
    table: r.table,
    privileges: r.privileges ? String(r.privileges).split(',').map((p: string) => p.trim().toUpperCase()).filter(Boolean) : [],
  }))
  return {
    serverPrivileges,
    tablePrivileges,
    advanced: {
      maxQueriesPerHour: Number(row.max_questions ?? 0),
      maxUpdatesPerHour: Number(row.max_updates ?? 0),
      maxConnectionsPerHour: Number(row.max_connections ?? 0),
      maxUserConnections: Number(row.max_user_connections ?? 0),
    },
  }
}

function escapeMysqlId(name: string): string {
  if (/`/.test(name)) throw new Error(`Invalid identifier: ${name}`)
  return `\`${name}\``
}

async function applyMysqlServerPrivs(
  pool: MySQLPool, username: string, host: string, privs: Record<string, boolean>
): Promise<void> {
  await pool.execute('REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?', [username, host])
  const granted = Object.entries(privs).filter(([, v]) => v).map(([p]) => p).filter((p) => p !== 'GRANT OPTION')
  const withGrant = privs['GRANT OPTION'] ?? false
  if (granted.length > 0) {
    await pool.execute(
      `GRANT ${granted.join(', ')} ON *.* TO ?@?${withGrant ? ' WITH GRANT OPTION' : ''}`,
      [username, host]
    )
  } else if (withGrant) {
    await pool.execute('GRANT USAGE ON *.* TO ?@? WITH GRANT OPTION', [username, host])
  }
}

async function applyMysqlTablePrivs(
  pool: MySQLPool, username: string, host: string, tablePrivs: TablePrivilege[]
): Promise<void> {
  const [existing] = await pool.execute<any[]>(
    'SELECT Db, Table_name FROM mysql.tables_priv WHERE User = ? AND Host = ?',
    [username, host]
  )
  for (const r of existing as any[]) {
    await pool.execute(
      `REVOKE ALL PRIVILEGES ON ${escapeMysqlId(r.Db)}.${escapeMysqlId(r.Table_name)} FROM ?@?`,
      [username, host]
    )
  }
  for (const tp of tablePrivs) {
    if (!tp.privileges.length) continue
    const privNames = tp.privileges.filter((p) => p !== 'GRANT').join(', ')
    const withGrant = tp.privileges.includes('GRANT')
    if (privNames) {
      await pool.execute(
        `GRANT ${privNames} ON ${escapeMysqlId(tp.database)}.${escapeMysqlId(tp.table)} TO ?@?${withGrant ? ' WITH GRANT OPTION' : ''}`,
        [username, host]
      )
    }
  }
}

async function createUserMysql(pool: MySQLPool, input: CreateUserInput): Promise<void> {
  await pool.execute('CREATE USER ?@? IDENTIFIED BY ?', [input.username, input.host, input.password])
  await applyMysqlServerPrivs(pool, input.username, input.host, input.serverPrivileges)
  await applyMysqlTablePrivs(pool, input.username, input.host, input.tablePrivileges)
  const a = input.advanced
  await pool.execute(
    'ALTER USER ?@? WITH MAX_QUERIES_PER_HOUR ? MAX_UPDATES_PER_HOUR ? MAX_CONNECTIONS_PER_HOUR ? MAX_USER_CONNECTIONS ?',
    [input.username, input.host, a.maxQueriesPerHour ?? 0, a.maxUpdatesPerHour ?? 0, a.maxConnectionsPerHour ?? 0, a.maxUserConnections ?? 0]
  )
  await pool.execute('FLUSH PRIVILEGES')
}

async function updateUserMysql(pool: MySQLPool, username: string, input: UpdateUserInput): Promise<void> {
  if (input.password) {
    await pool.execute('ALTER USER ?@? IDENTIFIED BY ?', [username, input.host, input.password])
  }
  await applyMysqlServerPrivs(pool, username, input.host, input.serverPrivileges)
  await applyMysqlTablePrivs(pool, username, input.host, input.tablePrivileges)
  const a = input.advanced
  await pool.execute(
    'ALTER USER ?@? WITH MAX_QUERIES_PER_HOUR ? MAX_UPDATES_PER_HOUR ? MAX_CONNECTIONS_PER_HOUR ? MAX_USER_CONNECTIONS ?',
    [username, input.host, a.maxQueriesPerHour ?? 0, a.maxUpdatesPerHour ?? 0, a.maxConnectionsPerHour ?? 0, a.maxUserConnections ?? 0]
  )
  await pool.execute('FLUSH PRIVILEGES')
}

async function dropUserMysql(pool: MySQLPool, username: string, host: string): Promise<void> {
  await pool.execute('DROP USER ?@?', [username, host])
  await pool.execute('FLUSH PRIVILEGES')
}

// ── PostgreSQL helpers ───────────────────────────
async function listUsersPg(pool: PgPool): Promise<{ users: DbUser[]; count: number }> {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT rolname AS username, rolcanlogin FROM pg_roles ORDER BY rolname'
    )
    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM pg_roles')
    return { users: rows as DbUser[], count: countResult.rows[0].count }
  } finally {
    client.release()
  }
}

async function getPrivilegesPg(pool: PgPool, username: string): Promise<DbUserPrivileges> {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit FROM pg_roles WHERE rolname = $1',
      [username]
    )
    const role = rows[0] ?? {}
    const serverPrivileges: Record<string, boolean> = {
      SUPERUSER: !!role.rolsuper,
      CREATEDB: !!role.rolcreatedb,
      CREATEROLE: !!role.rolcreaterole,
      LOGIN: !!role.rolcanlogin,
      REPLICATION: !!role.rolreplication,
      BYPASSRLS: !!role.rolbypassrls,
    }
    const tableResult = await client.query(
      'SELECT table_schema AS "schema", table_name AS "table", privilege_type AS privilege FROM information_schema.role_table_grants WHERE grantee = $1',
      [username]
    )
    const tableMap = new Map<string, TablePrivilege>()
    for (const r of tableResult.rows) {
      const key = `${r.schema}.${r.table}`
      if (!tableMap.has(key)) tableMap.set(key, { database: r.schema, table: r.table, privileges: [] })
      tableMap.get(key)!.privileges.push(r.privilege)
    }
    return {
      serverPrivileges,
      tablePrivileges: Array.from(tableMap.values()),
      advanced: { connectionLimit: Number(role.rolconnlimit ?? -1) },
    }
  } finally {
    client.release()
  }
}

function pgRoleOpts(privs: Record<string, boolean>, connLimit: number): string {
  return [
    privs['SUPERUSER'] ? 'SUPERUSER' : 'NOSUPERUSER',
    privs['CREATEDB'] ? 'CREATEDB' : 'NOCREATEDB',
    privs['CREATEROLE'] ? 'CREATEROLE' : 'NOCREATEROLE',
    privs['LOGIN'] ? 'LOGIN' : 'NOLOGIN',
    privs['REPLICATION'] ? 'REPLICATION' : 'NOREPLICATION',
    privs['BYPASSRLS'] ? 'BYPASSRLS' : 'NOBYPASSRLS',
    `CONNECTION LIMIT ${connLimit}`,
  ].join(' ')
}

async function createUserPg(pool: PgPool, input: CreateUserInput): Promise<void> {
  const client = await pool.connect()
  try {
    const opts = pgRoleOpts(input.serverPrivileges, input.advanced.connectionLimit ?? -1)
    const pwd = input.password.replace(/'/g, "''")
    await client.query(`CREATE ROLE "${input.username}" WITH ${opts} PASSWORD '${pwd}'`)
    for (const tp of input.tablePrivileges) {
      if (!tp.privileges.length) continue
      await client.query(`GRANT ${tp.privileges.join(', ')} ON "${tp.database}"."${tp.table}" TO "${input.username}"`)
    }
  } finally {
    client.release()
  }
}

async function updateUserPg(pool: PgPool, username: string, input: UpdateUserInput): Promise<void> {
  const client = await pool.connect()
  try {
    const opts = pgRoleOpts(input.serverPrivileges, input.advanced.connectionLimit ?? -1)
    await client.query(`ALTER ROLE "${username}" WITH ${opts}`)
    if (input.password) {
      const pwd = input.password.replace(/'/g, "''")
      await client.query(`ALTER ROLE "${username}" WITH PASSWORD '${pwd}'`)
    }
    const existing = await client.query(
      'SELECT table_schema AS "schema", table_name AS "table", privilege_type AS privilege FROM information_schema.role_table_grants WHERE grantee = $1',
      [username]
    )
    const existingMap = new Map<string, string[]>()
    for (const r of existing.rows) {
      const key = `${r.schema}.${r.table}`
      if (!existingMap.has(key)) existingMap.set(key, [])
      existingMap.get(key)!.push(r.privilege)
    }
    for (const [key, privs] of existingMap.entries()) {
      const [schema, table] = key.split('.')
      await client.query(`REVOKE ${privs.join(', ')} ON "${schema}"."${table}" FROM "${username}"`)
    }
    for (const tp of input.tablePrivileges) {
      if (!tp.privileges.length) continue
      await client.query(`GRANT ${tp.privileges.join(', ')} ON "${tp.database}"."${tp.table}" TO "${username}"`)
    }
  } finally {
    client.release()
  }
}

async function dropUserPg(pool: PgPool, username: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(`DROP ROLE "${username}"`)
  } finally {
    client.release()
  }
}

// ── Oracle helpers ───────────────────────────────
async function listUsersOracle(pool: OraclePool): Promise<{ users: DbUser[]; count: number }> {
  const conn = await pool.getConnection()
  try {
    const result = await conn.execute('SELECT username, account_status FROM dba_users ORDER BY username')
    const countResult = await conn.execute('SELECT COUNT(*) AS "count" FROM dba_users')
    const users = ((result.rows ?? []) as unknown[][]).map((r) => ({
      username: r[0] as string,
      status: r[1] as string,
    }))
    const count = Number(((countResult.rows ?? []) as unknown[][])[0]?.[0] ?? 0)
    return { users, count }
  } finally {
    await conn.close()
  }
}

async function getPrivilegesOracle(pool: OraclePool, username: string): Promise<DbUserPrivileges> {
  const conn = await pool.getConnection()
  try {
    const u = username.toUpperCase()
    const sysResult = await conn.execute('SELECT privilege FROM dba_sys_privs WHERE grantee = :1', [u])
    const tabResult = await conn.execute('SELECT owner, table_name, privilege FROM dba_tab_privs WHERE grantee = :1', [u])
    const profResult = await conn.execute('SELECT profile FROM dba_users WHERE username = :1', [u])
    const serverPrivileges: Record<string, boolean> = {}
    for (const r of (sysResult.rows ?? []) as unknown[][]) {
      serverPrivileges[r[0] as string] = true
    }
    const tableMap = new Map<string, TablePrivilege>()
    for (const r of (tabResult.rows ?? []) as unknown[][]) {
      const key = `${r[0]}.${r[1]}`
      if (!tableMap.has(key)) tableMap.set(key, { database: r[0] as string, table: r[1] as string, privileges: [] })
      tableMap.get(key)!.privileges.push(r[2] as string)
    }
    const profile = (((profResult.rows ?? []) as unknown[][])[0]?.[0] as string) ?? ''
    return {
      serverPrivileges,
      tablePrivileges: Array.from(tableMap.values()),
      advanced: { profile },
    }
  } finally {
    await conn.close()
  }
}

async function createUserOracle(pool: OraclePool, input: CreateUserInput): Promise<void> {
  const conn = await pool.getConnection()
  try {
    const pwd = input.password.replace(/"/g, '')
    await conn.execute(`CREATE USER "${input.username}" IDENTIFIED BY "${pwd}"`)
    for (const [priv, granted] of Object.entries(input.serverPrivileges)) {
      if (granted) await conn.execute(`GRANT ${priv} TO "${input.username}"`)
    }
    for (const tp of input.tablePrivileges) {
      for (const priv of tp.privileges) {
        await conn.execute(`GRANT ${priv} ON "${tp.database}"."${tp.table}" TO "${input.username}"`)
      }
    }
  } finally {
    await conn.close()
  }
}

async function updateUserOracle(pool: OraclePool, username: string, input: UpdateUserInput): Promise<void> {
  const conn = await pool.getConnection()
  try {
    if (input.password) {
      const pwd = input.password.replace(/"/g, '')
      await conn.execute(`ALTER USER "${username}" IDENTIFIED BY "${pwd}"`)
    }
    const u = username.toUpperCase()
    const sysResult = await conn.execute('SELECT privilege FROM dba_sys_privs WHERE grantee = :1', [u])
    for (const r of (sysResult.rows ?? []) as unknown[][]) {
      await conn.execute(`REVOKE ${r[0]} FROM "${username}"`)
    }
    for (const [priv, granted] of Object.entries(input.serverPrivileges)) {
      if (granted) await conn.execute(`GRANT ${priv} TO "${username}"`)
    }
    const tabResult = await conn.execute('SELECT owner, table_name, privilege FROM dba_tab_privs WHERE grantee = :1', [u])
    for (const r of (tabResult.rows ?? []) as unknown[][]) {
      await conn.execute(`REVOKE ${r[2]} ON "${r[0]}"."${r[1]}" FROM "${username}"`)
    }
    for (const tp of input.tablePrivileges) {
      for (const priv of tp.privileges) {
        await conn.execute(`GRANT ${priv} ON "${tp.database}"."${tp.table}" TO "${username}"`)
      }
    }
  } finally {
    await conn.close()
  }
}

async function dropUserOracle(pool: OraclePool, username: string): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.execute(`DROP USER "${username}" CASCADE`)
  } finally {
    await conn.close()
  }
}

// ── Route helpers ────────────────────────────────
function sqlError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── GET / ─ list users + count ───────────────────
dbUsersRouter.get('/', async (c) => {
  const connectionId = c.req.param('connectionId')!
  const userId = c.get('userId')!
  let poolOpts: Awaited<ReturnType<typeof getPoolOptions>>
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json({ message: 'Connection not found or unauthorized' }, 404)
  }
  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    const result =
      poolOpts.driver === 'postgresql' ? await listUsersPg(pool as PgPool)
      : poolOpts.driver === 'mysql' ? await listUsersMysql(pool as MySQLPool)
      : await listUsersOracle(pool as OraclePool)
    return c.json(result)
  } catch (err) {
    logger.warn({ connectionId, err }, 'db-users list error')
    return c.json({ message: sqlError(err) }, 422)
  }
})

// ── GET /:username/privileges ────────────────────
dbUsersRouter.get('/:username/privileges', async (c) => {
  const connectionId = c.req.param('connectionId')!
  const username = c.req.param('username')!
  const host = c.req.query('host') ?? '%'
  const userId = c.get('userId')!
  let poolOpts: Awaited<ReturnType<typeof getPoolOptions>>
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json({ message: 'Connection not found or unauthorized' }, 404)
  }
  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    const result =
      poolOpts.driver === 'postgresql' ? await getPrivilegesPg(pool as PgPool, username)
      : poolOpts.driver === 'mysql' ? await getPrivilegesMysql(pool as MySQLPool, username, host)
      : await getPrivilegesOracle(pool as OraclePool, username)
    return c.json(result)
  } catch (err) {
    logger.warn({ connectionId, username, err }, 'db-users privileges error')
    return c.json({ message: sqlError(err) }, 422)
  }
})

// ── POST / ─ create user ─────────────────────────
dbUsersRouter.post('/', zValidator('json', CreateSchema), async (c) => {
  const connectionId = c.req.param('connectionId')!
  const userId = c.get('userId')!
  const input = c.req.valid('json')
  let poolOpts: Awaited<ReturnType<typeof getPoolOptions>>
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json({ message: 'Connection not found or unauthorized' }, 404)
  }
  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    if (poolOpts.driver === 'postgresql') await createUserPg(pool as PgPool, input)
    else if (poolOpts.driver === 'mysql') await createUserMysql(pool as MySQLPool, input)
    else await createUserOracle(pool as OraclePool, input)
    return c.json({ ok: true }, 201)
  } catch (err) {
    logger.warn({ connectionId, err }, 'db-users create error')
    return c.json({ message: sqlError(err) }, 422)
  }
})

// ── PUT /:username ─ update user ─────────────────
dbUsersRouter.put('/:username', zValidator('json', UpdateSchema), async (c) => {
  const connectionId = c.req.param('connectionId')!
  const username = c.req.param('username')!
  const userId = c.get('userId')!
  const input = c.req.valid('json')
  let poolOpts: Awaited<ReturnType<typeof getPoolOptions>>
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json({ message: 'Connection not found or unauthorized' }, 404)
  }
  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    if (poolOpts.driver === 'postgresql') await updateUserPg(pool as PgPool, username, input)
    else if (poolOpts.driver === 'mysql') await updateUserMysql(pool as MySQLPool, username, input)
    else await updateUserOracle(pool as OraclePool, username, input)
    return c.json({ ok: true })
  } catch (err) {
    logger.warn({ connectionId, username, err }, 'db-users update error')
    return c.json({ message: sqlError(err) }, 422)
  }
})

// ── DELETE /:username ─ drop user ────────────────
dbUsersRouter.delete('/:username', async (c) => {
  const connectionId = c.req.param('connectionId')!
  const username = c.req.param('username')!
  const host = c.req.query('host') ?? '%'
  const userId = c.get('userId')!
  let poolOpts: Awaited<ReturnType<typeof getPoolOptions>>
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json({ message: 'Connection not found or unauthorized' }, 404)
  }
  try {
    const pool = await connectionManager.getPool(connectionId, poolOpts)
    if (poolOpts.driver === 'postgresql') await dropUserPg(pool as PgPool, username)
    else if (poolOpts.driver === 'mysql') await dropUserMysql(pool as MySQLPool, username, host)
    else await dropUserOracle(pool as OraclePool, username)
    return c.body(null, 204)
  } catch (err) {
    logger.warn({ connectionId, username, err }, 'db-users drop error')
    return c.json({ message: sqlError(err) }, 422)
  }
})

export { dbUsersRouter }

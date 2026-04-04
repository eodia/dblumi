# DB User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Users button in the Project Overview status bar (left of the Latency button) that opens a modal to create, edit, and delete database users with full privilege management for MySQL, PostgreSQL, and Oracle.

**Architecture:** Single Hono router `dbUsersRouter` mounted at `/api/v1/connections/:connectionId/db-users`, dispatching to per-driver helper functions. Single React modal with a two-column layout (user list left, form tabs right). Driver-specific privilege schemas defined as frontend constants.

**Tech Stack:** Hono, Zod, mysql2/promise, pg, oracledb (existing deps), React, React Query, shadcn/ui (Dialog, Tabs, Checkbox), lucide-react (Users icon), SlideToConfirm (existing component).

---

### Task 1: Backend API route

**Files:**
- Create: `src/api/src/routes/db-users.ts`

- [ ] **Step 1: Create `src/api/src/routes/db-users.ts`**

```typescript
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

// ── Types ────────────────────────────────────────
type DbUser = { username: string; host?: string; plugin?: string; status?: string }

type TablePrivilege = { database: string; table: string; privileges: string[] }

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

type CreateUserInput = {
  username: string
  host: string
  password: string
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: DbUserPrivileges['advanced']
}

type UpdateUserInput = {
  host: string
  password?: string
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: DbUserPrivileges['advanced']
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

// ── Route helpers ────────────────────────────────
async function resolvePool(connectionId: string, userId: string) {
  const poolOpts = await getPoolOptions(connectionId, userId)
  const pool = await connectionManager.getPool(connectionId, poolOpts)
  return { pool, driver: poolOpts.driver }
}

function sqlError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── GET / ─ list users + count ───────────────────
dbUsersRouter.get('/', async (c) => {
  const connectionId = c.req.param('connectionId')
  const userId = c.get('userId')
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
  const connectionId = c.req.param('connectionId')
  const username = c.req.param('username')
  const host = c.req.query('host') ?? '%'
  const userId = c.get('userId')
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
  const connectionId = c.req.param('connectionId')
  const userId = c.get('userId')
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
  const connectionId = c.req.param('connectionId')
  const username = c.req.param('username')
  const userId = c.get('userId')
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
  const connectionId = c.req.param('connectionId')
  const username = c.req.param('username')
  const host = c.req.query('host') ?? '%'
  const userId = c.get('userId')
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter api exec tsc --noEmit 2>&1 | grep -v "saved-query.service" | head -30
```

Expected: no errors from `db-users.ts`.

- [ ] **Step 3: Commit**

```bash
cd /c/data/dev/dblumi
git add src/api/src/routes/db-users.ts
git commit -m "feat: add db-users API route (MySQL/PG/Oracle)"
```

---

### Task 2: Mount route in app.ts

**Files:**
- Modify: `src/api/src/app.ts`

- [ ] **Step 1: Add import and route**

In `src/api/src/app.ts`, add after the existing imports:

```typescript
import { dbUsersRouter } from './routes/db-users.js'
```

Add the route after `app.route('/api/v1/settings', settingsRouter)` and before the API Docs comment:

```typescript
app.route('/api/v1/connections/:connectionId/db-users', dbUsersRouter)
```

The full block after edit:
```typescript
app.route('/api/v1/connections', connectionsRouter)
app.route('/api/v1/query', queryRouter)
app.route('/api/v1/saved-queries', savedQueriesRouter)
app.route('/api/v1/copilot', copilotRouter)
app.route('/api/v1/admin', adminRouter)
app.route('/api/v1/sharing', sharingRouter)
app.route('/api/v1/settings', settingsRouter)
app.route('/api/v1/connections/:connectionId/db-users', dbUsersRouter)

// ── API Docs (Swagger UI) ─────────────────────
app.route('/api/docs', docsRouter)
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter api exec tsc --noEmit 2>&1 | grep "app.ts" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/data/dev/dblumi
git add src/api/src/app.ts
git commit -m "feat: mount db-users router in app"
```

---

### Task 3: Frontend API client

**Files:**
- Create: `src/web/src/api/db-users.ts`

- [ ] **Step 1: Create `src/web/src/api/db-users.ts`**

```typescript
import { api } from './client'

export type DbUser = {
  username: string
  host?: string
  plugin?: string
  status?: string
}

export type TablePrivilege = {
  database: string
  table: string
  privileges: string[]
}

export type DbUserPrivileges = {
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

export type CreateDbUserInput = {
  username: string
  host?: string
  password: string
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: DbUserPrivileges['advanced']
}

export type UpdateDbUserInput = {
  host?: string
  password?: string
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: DbUserPrivileges['advanced']
}

export const dbUsersApi = {
  list: (connectionId: string) =>
    api.get<{ users: DbUser[]; count: number }>(`/connections/${connectionId}/db-users`),

  getPrivileges: (connectionId: string, username: string, host?: string) => {
    const q = host ? `?host=${encodeURIComponent(host)}` : ''
    return api.get<DbUserPrivileges>(`/connections/${connectionId}/db-users/${encodeURIComponent(username)}/privileges${q}`)
  },

  create: (connectionId: string, input: CreateDbUserInput) =>
    api.post<{ ok: boolean }>(`/connections/${connectionId}/db-users`, input),

  update: (connectionId: string, username: string, input: UpdateDbUserInput) =>
    api.put<{ ok: boolean }>(`/connections/${connectionId}/db-users/${encodeURIComponent(username)}`, input),

  drop: (connectionId: string, username: string, host?: string) => {
    const q = host ? `?host=${encodeURIComponent(host)}` : ''
    return api.del<void>(`/connections/${connectionId}/db-users/${encodeURIComponent(username)}${q}`)
  },
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter web exec tsc --noEmit 2>&1 | grep "db-users" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/data/dev/dblumi
git add src/web/src/api/db-users.ts
git commit -m "feat: add db-users frontend API client"
```

---

### Task 4: i18n keys

**Files:**
- Modify: `src/web/src/i18n/en.ts`
- Modify: `src/web/src/i18n/fr.ts`

- [ ] **Step 1: Add keys to `en.ts`**

After the `'overview.queryHistory'` line, add:

```typescript
  'overview.dbUsers': 'Users',
  'overview.dbUsersTooltip': 'Manage database users and privileges',
```

After the last existing key (before the closing `}`), add a new section:

```typescript
  // ── DB Users ──
  'dbusers.title': 'Database Users',
  'dbusers.createUser': 'Create user',
  'dbusers.identity': 'Identity',
  'dbusers.serverPrivileges': 'Server Privileges',
  'dbusers.tablePrivileges': 'Table Privileges',
  'dbusers.advanced': 'Advanced',
  'dbusers.username': 'Username',
  'dbusers.host': 'Host',
  'dbusers.password': 'Password',
  'dbusers.confirmPassword': 'Confirm password',
  'dbusers.passwordOptional': 'Leave blank to keep current password',
  'dbusers.passwordMismatch': 'Passwords do not match',
  'dbusers.save': 'Save',
  'dbusers.dropUser': 'Drop user',
  'dbusers.slideToDropUser': 'Slide to drop user',
  'dbusers.maxQueriesPerHour': 'Max queries per hour',
  'dbusers.maxUpdatesPerHour': 'Max updates per hour',
  'dbusers.maxConnectionsPerHour': 'Max connections per hour',
  'dbusers.maxUserConnections': 'Max user connections',
  'dbusers.connectionLimit': 'Connection limit (-1 = unlimited)',
  'dbusers.profile': 'Oracle profile',
  'dbusers.database': 'Database / Schema',
  'dbusers.table': 'Table',
  'dbusers.addTablePrivilege': 'Add table privilege rule',
  'dbusers.removeTablePrivilege': 'Remove',
  'dbusers.selectAll': 'Select all',
  'dbusers.deselectAll': 'Deselect all',
  'dbusers.noUserSelected': 'Select a user or create a new one',
  'dbusers.created': 'User created',
  'dbusers.updated': 'User updated',
  'dbusers.dropped': 'User dropped',
  'dbusers.plugin': 'Plugin',
  'dbusers.status': 'Status',
  'dbusers.noUsers': 'No users found',
```

- [ ] **Step 2: Add same keys to `fr.ts`**

After `'overview.queryHistory'` line, add:

```typescript
  'overview.dbUsers': 'Utilisateurs',
  'overview.dbUsersTooltip': 'Gérer les utilisateurs et les privilèges de la base',
```

At the end of the file (before closing `}`), add:

```typescript
  // ── DB Users ──
  'dbusers.title': 'Utilisateurs de la base',
  'dbusers.createUser': 'Créer un utilisateur',
  'dbusers.identity': 'Identité',
  'dbusers.serverPrivileges': 'Privilèges serveur',
  'dbusers.tablePrivileges': 'Privilèges par table',
  'dbusers.advanced': 'Avancé',
  'dbusers.username': 'Nom d\'utilisateur',
  'dbusers.host': 'Hôte',
  'dbusers.password': 'Mot de passe',
  'dbusers.confirmPassword': 'Confirmer le mot de passe',
  'dbusers.passwordOptional': 'Laisser vide pour conserver le mot de passe actuel',
  'dbusers.passwordMismatch': 'Les mots de passe ne correspondent pas',
  'dbusers.save': 'Enregistrer',
  'dbusers.dropUser': 'Supprimer l\'utilisateur',
  'dbusers.slideToDropUser': 'Glisser pour supprimer',
  'dbusers.maxQueriesPerHour': 'Max requêtes / heure',
  'dbusers.maxUpdatesPerHour': 'Max mises à jour / heure',
  'dbusers.maxConnectionsPerHour': 'Max connexions / heure',
  'dbusers.maxUserConnections': 'Max connexions simultanées',
  'dbusers.connectionLimit': 'Limite de connexions (-1 = illimité)',
  'dbusers.profile': 'Profil Oracle',
  'dbusers.database': 'Base de données / Schéma',
  'dbusers.table': 'Table',
  'dbusers.addTablePrivilege': 'Ajouter une règle par table',
  'dbusers.removeTablePrivilege': 'Retirer',
  'dbusers.selectAll': 'Tout sélectionner',
  'dbusers.deselectAll': 'Tout désélectionner',
  'dbusers.noUserSelected': 'Sélectionner un utilisateur ou en créer un',
  'dbusers.created': 'Utilisateur créé',
  'dbusers.updated': 'Utilisateur mis à jour',
  'dbusers.dropped': 'Utilisateur supprimé',
  'dbusers.plugin': 'Plugin',
  'dbusers.status': 'Statut',
  'dbusers.noUsers': 'Aucun utilisateur',
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter web exec tsc --noEmit 2>&1 | grep "i18n" | head -10
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /c/data/dev/dblumi
git add src/web/src/i18n/en.ts src/web/src/i18n/fr.ts
git commit -m "feat: add db-users i18n keys (en + fr)"
```

---

### Task 5: PrivilegeCheckboxList component

**Files:**
- Create: `src/web/src/components/overview/PrivilegeCheckboxList.tsx`

- [ ] **Step 1: Create `src/web/src/components/overview/PrivilegeCheckboxList.tsx`**

```typescript
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type Props = {
  privileges: string[]
  checked: Record<string, boolean>
  onChange: (priv: string, value: boolean) => void
}

export function PrivilegeCheckboxList({ privileges, checked, onChange }: Props) {
  const { t } = useI18n()
  const allChecked = privileges.every((p) => checked[p])

  const toggleAll = () => {
    const next = !allChecked
    for (const p of privileges) onChange(p, next)
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggleAll}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {allChecked ? t('dbusers.deselectAll') : t('dbusers.selectAll')}
      </button>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {privileges.map((priv) => (
          <label
            key={priv}
            className={cn(
              'flex items-center gap-2 text-xs cursor-pointer select-none',
              checked[priv] ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Checkbox
              checked={!!checked[priv]}
              onCheckedChange={(v) => onChange(priv, !!v)}
              className="h-3.5 w-3.5"
            />
            <span className="truncate font-mono">{priv}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter web exec tsc --noEmit 2>&1 | grep "PrivilegeCheckboxList" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/data/dev/dblumi
git add src/web/src/components/overview/PrivilegeCheckboxList.tsx
git commit -m "feat: add PrivilegeCheckboxList component"
```

---

### Task 6: DbUserList component (left panel)

**Files:**
- Create: `src/web/src/components/overview/DbUserList.tsx`

- [ ] **Step 1: Create `src/web/src/components/overview/DbUserList.tsx`**

```typescript
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DbUser } from '@/api/db-users'
import type { DbDriver } from '@/api/connections'

type Props = {
  users: DbUser[]
  driver: DbDriver
  selectedUser: DbUser | null
  onSelect: (user: DbUser) => void
  onCreateNew: () => void
}

export function DbUserList({ users, driver, selectedUser, onSelect, onCreateNew }: Props) {
  const { t } = useI18n()

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="flex-1 overflow-auto">
        {users.length === 0 && (
          <p className="text-xs text-muted-foreground p-4 text-center">{t('dbusers.noUsers')}</p>
        )}
        {users.map((user) => {
          const isSelected =
            user.username === selectedUser?.username &&
            (driver !== 'mysql' || user.host === selectedUser?.host)
          return (
            <button
              key={`${user.username}@${user.host ?? ''}`}
              type="button"
              onClick={() => onSelect(user)}
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-surface-raised border-b border-border/50',
                isSelected && 'bg-surface-raised',
              )}
            >
              <p className="font-medium truncate">{user.username}</p>
              {driver === 'mysql' && user.host && (
                <p className="text-[11px] text-muted-foreground truncate">@{user.host}</p>
              )}
              {driver === 'mysql' && user.plugin && (
                <p className="text-[10px] text-muted-foreground/70 truncate">{user.plugin}</p>
              )}
              {driver === 'oracle' && user.status && (
                <p className="text-[11px] text-muted-foreground truncate">{user.status}</p>
              )}
            </button>
          )
        })}
      </div>
      <div className="p-3 border-t border-border">
        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={onCreateNew}>
          <Plus className="h-3.5 w-3.5" />
          {t('dbusers.createUser')}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter web exec tsc --noEmit 2>&1 | grep "DbUserList" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/data/dev/dblumi
git add src/web/src/components/overview/DbUserList.tsx
git commit -m "feat: add DbUserList component"
```

---

### Task 7: DbUserForm component (right panel)

**Files:**
- Create: `src/web/src/components/overview/DbUserForm.tsx`

- [ ] **Step 1: Create `src/web/src/components/overview/DbUserForm.tsx`**

```typescript
import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { SlideToConfirm } from '@/components/ui/slide-to-confirm'
import { PrivilegeCheckboxList } from './PrivilegeCheckboxList'
import { dbUsersApi } from '@/api/db-users'
import type { DbUser, DbUserPrivileges } from '@/api/db-users'
import type { DbDriver } from '@/api/connections'

// ── Privilege lists per driver ───────────────────
const MYSQL_SERVER_PRIVS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
  'RELOAD', 'SHUTDOWN', 'PROCESS', 'FILE', 'GRANT OPTION', 'REFERENCES',
  'INDEX', 'ALTER', 'SHOW DATABASES', 'SUPER', 'CREATE TEMPORARY TABLES',
  'LOCK TABLES', 'EXECUTE', 'REPLICATION SLAVE', 'REPLICATION CLIENT',
  'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE',
  'CREATE USER', 'EVENT', 'TRIGGER',
]
const MYSQL_TABLE_PRIVS = [
  'SELECT', 'INSERT', 'UPDATE', 'REFERENCES', 'DELETE', 'CREATE', 'DROP',
  'ALTER', 'INDEX', 'TRIGGER', 'CREATE VIEW', 'SHOW VIEW', 'GRANT',
  'EXECUTE', 'ALTER ROUTINE', 'CREATE ROUTINE', 'CREATE TEMPORARY TABLES',
  'LOCK TABLES', 'EVENT',
]
const PG_SERVER_PRIVS = ['SUPERUSER', 'CREATEDB', 'CREATEROLE', 'LOGIN', 'REPLICATION', 'BYPASSRLS']
const PG_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const ORACLE_SERVER_PRIVS = [
  'CREATE SESSION', 'CREATE TABLE', 'CREATE VIEW', 'CREATE PROCEDURE',
  'CREATE SEQUENCE', 'CREATE TRIGGER', 'CREATE TYPE', 'CREATE USER',
  'DROP ANY TABLE', 'ALTER ANY TABLE', 'SELECT ANY TABLE', 'INSERT ANY TABLE',
  'UPDATE ANY TABLE', 'DELETE ANY TABLE', 'GRANT ANY PRIVILEGE', 'SYSDBA', 'SYSOPER',
]
const ORACLE_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'INDEX', 'REFERENCES', 'EXECUTE']

function serverPrivsList(driver: DbDriver): string[] {
  if (driver === 'mysql') return MYSQL_SERVER_PRIVS
  if (driver === 'postgresql') return PG_SERVER_PRIVS
  return ORACLE_SERVER_PRIVS
}

function tablePrivsList(driver: DbDriver): string[] {
  if (driver === 'mysql') return MYSQL_TABLE_PRIVS
  if (driver === 'postgresql') return PG_TABLE_PRIVS
  return ORACLE_TABLE_PRIVS
}

// ── Types ────────────────────────────────────────
type TablePrivEntry = {
  id: string
  database: string
  table: string
  privileges: Record<string, boolean>
}

type Props = {
  connectionId: string
  driver: DbDriver
  selectedUser: DbUser | null
  isCreating: boolean
  onSaved: () => void
  onDropped: () => void
}

export function DbUserForm({ connectionId, driver, selectedUser, isCreating, onSaved, onDropped }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()

  // Form state
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('%')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [serverPrivs, setServerPrivs] = useState<Record<string, boolean>>({})
  const [tableEntries, setTableEntries] = useState<TablePrivEntry[]>([])
  const [advanced, setAdvanced] = useState<DbUserPrivileges['advanced']>({})

  // Fetch existing privileges when a user is selected
  const { data: privData, isLoading: privLoading } = useQuery({
    queryKey: ['db-user-privileges', connectionId, selectedUser?.username, selectedUser?.host],
    queryFn: () => dbUsersApi.getPrivileges(connectionId, selectedUser!.username, selectedUser!.host),
    enabled: !!selectedUser && !isCreating,
  })

  // Populate form when selection or priv data changes
  useEffect(() => {
    if (isCreating || !selectedUser) {
      setUsername('')
      setHost('%')
      setPassword('')
      setConfirmPassword('')
      setServerPrivs({})
      setTableEntries([])
      setAdvanced({})
      return
    }
    if (privData) {
      setUsername(selectedUser.username)
      setHost(selectedUser.host ?? '%')
      setPassword('')
      setConfirmPassword('')
      setServerPrivs(privData.serverPrivileges)
      setTableEntries(
        privData.tablePrivileges.map((tp, i) => ({
          id: String(i),
          database: tp.database,
          table: tp.table,
          privileges: Object.fromEntries(tp.privileges.map((p) => [p, true])),
        }))
      )
      setAdvanced(privData.advanced)
    }
  }, [selectedUser, privData, isCreating])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['db-users', connectionId] })
    qc.invalidateQueries({ queryKey: ['db-user-privileges', connectionId] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      dbUsersApi.create(connectionId, {
        username,
        host: driver === 'mysql' ? host : '%',
        password,
        serverPrivileges: serverPrivs,
        tablePrivileges: tableEntries.map((e) => ({
          database: e.database,
          table: e.table,
          privileges: Object.entries(e.privileges).filter(([, v]) => v).map(([p]) => p),
        })),
        advanced,
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('dbusers.created'))
      onSaved()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      dbUsersApi.update(connectionId, selectedUser!.username, {
        host: driver === 'mysql' ? host : '%',
        password: password || undefined,
        serverPrivileges: serverPrivs,
        tablePrivileges: tableEntries.map((e) => ({
          database: e.database,
          table: e.table,
          privileges: Object.entries(e.privileges).filter(([, v]) => v).map(([p]) => p),
        })),
        advanced,
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('dbusers.updated'))
      onSaved()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const dropMutation = useMutation({
    mutationFn: () =>
      dbUsersApi.drop(connectionId, selectedUser!.username, driver === 'mysql' ? (selectedUser!.host ?? '%') : undefined),
    onSuccess: () => {
      invalidate()
      toast.success(t('dbusers.dropped'))
      onDropped()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const handleSubmit = () => {
    if (!username.trim()) return
    if (password !== confirmPassword) {
      toast.error(t('dbusers.passwordMismatch'))
      return
    }
    if (isCreating) createMutation.mutate()
    else updateMutation.mutate()
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  const addTableEntry = () => {
    setTableEntries((prev) => [
      ...prev,
      { id: String(Date.now()), database: '', table: '', privileges: {} },
    ])
  }

  const removeTableEntry = (id: string) => {
    setTableEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const updateTableEntry = (id: string, field: 'database' | 'table', value: string) => {
    setTableEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)))
  }

  const updateTablePriv = (id: string, priv: string, value: boolean) => {
    setTableEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, privileges: { ...e.privileges, [priv]: value } } : e))
    )
  }

  if (!isCreating && !selectedUser) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t('dbusers.noUserSelected')}
      </div>
    )
  }

  if (!isCreating && privLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="identity">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="identity">{t('dbusers.identity')}</TabsTrigger>
            <TabsTrigger value="server">{t('dbusers.serverPrivileges')}</TabsTrigger>
            <TabsTrigger value="table">{t('dbusers.tablePrivileges')}</TabsTrigger>
            <TabsTrigger value="advanced">{t('dbusers.advanced')}</TabsTrigger>
          </TabsList>

          {/* ── Identity tab ── */}
          <TabsContent value="identity" className="space-y-3 mt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('dbusers.username')}</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!isCreating}
                placeholder="myuser"
                className="h-8 text-sm"
              />
            </div>
            {driver === 'mysql' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('dbusers.host')}</Label>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="%"
                  className="h-8 text-sm"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('dbusers.password')}
                {!isCreating && (
                  <span className="ml-1 font-normal text-muted-foreground">({t('dbusers.passwordOptional')})</span>
                )}
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 text-sm"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('dbusers.confirmPassword')}</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-8 text-sm"
                autoComplete="new-password"
              />
            </div>
          </TabsContent>

          {/* ── Server privileges tab ── */}
          <TabsContent value="server" className="mt-4">
            <PrivilegeCheckboxList
              privileges={serverPrivsList(driver)}
              checked={serverPrivs}
              onChange={(priv, value) => setServerPrivs((prev) => ({ ...prev, [priv]: value }))}
            />
          </TabsContent>

          {/* ── Table privileges tab ── */}
          <TabsContent value="table" className="mt-4 space-y-4">
            {tableEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-3 space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{t('dbusers.database')}</Label>
                    <Input
                      value={entry.database}
                      onChange={(e) => updateTableEntry(entry.id, 'database', e.target.value)}
                      placeholder="mydb"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{t('dbusers.table')}</Label>
                    <Input
                      value={entry.table}
                      onChange={(e) => updateTableEntry(entry.id, 'table', e.target.value)}
                      placeholder="mytable"
                      className="h-7 text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTableEntry(entry.id)}
                    className="mt-5 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <PrivilegeCheckboxList
                  privileges={tablePrivsList(driver)}
                  checked={entry.privileges}
                  onChange={(priv, value) => updateTablePriv(entry.id, priv, value)}
                />
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addTableEntry}>
              <Plus className="h-3.5 w-3.5" />
              {t('dbusers.addTablePrivilege')}
            </Button>
          </TabsContent>

          {/* ── Advanced tab ── */}
          <TabsContent value="advanced" className="mt-4 space-y-3">
            {driver === 'mysql' && (
              <>
                {(
                  [
                    ['maxQueriesPerHour', 'dbusers.maxQueriesPerHour'],
                    ['maxUpdatesPerHour', 'dbusers.maxUpdatesPerHour'],
                    ['maxConnectionsPerHour', 'dbusers.maxConnectionsPerHour'],
                    ['maxUserConnections', 'dbusers.maxUserConnections'],
                  ] as const
                ).map(([field, labelKey]) => (
                  <div key={field} className="space-y-1.5">
                    <Label className="text-xs">{t(labelKey)}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={(advanced as any)[field] ?? 0}
                      onChange={(e) =>
                        setAdvanced((prev) => ({ ...prev, [field]: Number(e.target.value) }))
                      }
                      className="h-8 text-sm w-40"
                    />
                  </div>
                ))}
              </>
            )}
            {driver === 'postgresql' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('dbusers.connectionLimit')}</Label>
                <Input
                  type="number"
                  min={-1}
                  value={advanced.connectionLimit ?? -1}
                  onChange={(e) =>
                    setAdvanced((prev) => ({ ...prev, connectionLimit: Number(e.target.value) }))
                  }
                  className="h-8 text-sm w-40"
                />
              </div>
            )}
            {driver === 'oracle' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('dbusers.profile')}</Label>
                <Input value={advanced.profile ?? ''} disabled className="h-8 text-sm w-60" />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-4 space-y-3">
        {!isCreating && selectedUser && (
          <SlideToConfirm
            label={t('dbusers.dropUser')}
            confirmLabel={t('dbusers.slideToDropUser')}
            onConfirm={() => dropMutation.mutate()}
            disabled={dropMutation.isPending}
          />
        )}
        <Button
          className="w-full"
          size="sm"
          disabled={isPending || !username.trim()}
          onClick={handleSubmit}
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('dbusers.save')}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter web exec tsc --noEmit 2>&1 | grep "DbUserForm" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/data/dev/dblumi
git add src/web/src/components/overview/DbUserForm.tsx
git commit -m "feat: add DbUserForm component (4 tabs, all drivers)"
```

---

### Task 8: DbUsersModal shell

**Files:**
- Create: `src/web/src/components/overview/DbUsersModal.tsx`

- [ ] **Step 1: Create `src/web/src/components/overview/DbUsersModal.tsx`**

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { dbUsersApi } from '@/api/db-users'
import { connectionsApi } from '@/api/connections'
import type { DbUser } from '@/api/db-users'
import { DbUserList } from './DbUserList'
import { DbUserForm } from './DbUserForm'

type Props = {
  connectionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DbUsersModal({ connectionId, open, onOpenChange }: Props) {
  const { t } = useI18n()
  const [selectedUser, setSelectedUser] = useState<DbUser | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Get driver from cached connections list
  const { data: connList } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
    staleTime: 5 * 60_000,
  })
  const driver = connList?.connections.find((c) => c.id === connectionId)?.driver ?? 'mysql'

  const { data, isLoading, error } = useQuery({
    queryKey: ['db-users', connectionId],
    queryFn: () => dbUsersApi.list(connectionId),
    enabled: open,
    retry: false,
    staleTime: 30_000,
  })

  // Show toast on list error (insufficient privileges, etc.)
  if (error && open) {
    toast.error((error as Error).message)
  }

  const handleSelect = (user: DbUser) => {
    setSelectedUser(user)
    setIsCreating(false)
  }

  const handleCreateNew = () => {
    setSelectedUser(null)
    setIsCreating(true)
  }

  const handleSaved = () => {
    setIsCreating(false)
    // Keep selected user so they can see the saved state
  }

  const handleDropped = () => {
    setSelectedUser(null)
    setIsCreating(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0 gap-0 bg-card border-border-subtle">
        <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-base">{t('dbusers.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left panel — user list */}
          <div className="w-56 flex-shrink-0 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <DbUserList
                users={data?.users ?? []}
                driver={driver}
                selectedUser={selectedUser}
                onSelect={handleSelect}
                onCreateNew={handleCreateNew}
              />
            )}
          </div>

          {/* Right panel — form */}
          <div className="flex-1 overflow-hidden">
            <DbUserForm
              connectionId={connectionId}
              driver={driver}
              selectedUser={selectedUser}
              isCreating={isCreating}
              onSaved={handleSaved}
              onDropped={handleDropped}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/data/dev/dblumi && pnpm --filter web exec tsc --noEmit 2>&1 | grep "DbUsersModal" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/data/dev/dblumi
git add src/web/src/components/overview/DbUsersModal.tsx
git commit -m "feat: add DbUsersModal shell"
```

---

### Task 9: Users button in OverviewPage

**Files:**
- Modify: `src/web/src/components/overview/OverviewPage.tsx`

- [ ] **Step 1: Add imports**

In `src/web/src/components/overview/OverviewPage.tsx`, update the existing imports at the top:

```typescript
import { Server, RefreshCw, Users } from 'lucide-react'
import { dbUsersApi } from '@/api/db-users'
import { DbUsersModal } from './DbUsersModal'
```

The full imports section becomes:

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi } from '@/api/connections'
import { dbUsersApi } from '@/api/db-users'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { StatsCards } from './StatsCards'
import { ActivityCard } from './ActivityCard'
import { QuickAccessCard } from './QuickAccessCard'
import { ErdDiagram } from './ErdDiagram'
import { DbUsersModal } from './DbUsersModal'
import { Server, RefreshCw, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { DriverIcon, envBadgeClass } from '@/components/ui/driver-icon'
```

- [ ] **Step 2: Update `ConnectionStatusBar` to add Users button**

Replace the entire `ConnectionStatusBar` function (lines 18–73) with:

```typescript
function ConnectionStatusBar({ connectionId }: { connectionId: string }) {
  const { t } = useI18n()
  const [checking, setChecking] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)
  const [usersOpen, setUsersOpen] = useState(false)

  const { data: stats } = useQuery({
    queryKey: ['dbstats', connectionId],
    queryFn: () => connectionsApi.stats(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const { data: usersData } = useQuery({
    queryKey: ['db-users', connectionId],
    queryFn: () => dbUsersApi.list(connectionId),
    staleTime: 60_000,
    retry: false,
    enabled: false, // only fetched when modal opens; here we just read cached count
  })

  const handleCheck = async () => {
    setChecking(true)
    try {
      const r = await connectionsApi.test(connectionId)
      if (r.ok && r.latencyMs != null) setLatency(r.latencyMs)
    } catch {
      setLatency(null)
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Server className="h-3 w-3" />
          <span>{stats?.version ?? '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Users button */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setUsersOpen(true)}
                  className="flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium transition-colors bg-surface-raised text-muted-foreground hover:text-foreground hover:bg-surface-overlay border border-border"
                >
                  <Users className="h-3 w-3" />
                  <span>{t('overview.dbUsers')}</span>
                  {usersData?.count != null && (
                    <span className="bg-indigo-500/20 text-indigo-400 rounded-full px-1.5 py-px text-[10px] font-semibold">
                      {usersData.count}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('overview.dbUsersTooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Latency button */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCheck}
                  disabled={checking}
                  className={cn(
                    'flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium transition-colors disabled:opacity-60',
                    latency != null
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                      : 'bg-surface-raised text-muted-foreground hover:text-foreground hover:bg-surface-overlay border border-border',
                  )}
                >
                  <RefreshCw className={cn('h-3 w-3', checking && 'animate-spin')} />
                  <span className="tabular-nums">
                    {latency != null ? `${latency} ms` : t('overview.latency')}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('overview.latencyTooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <DbUsersModal
        connectionId={connectionId}
        open={usersOpen}
        onOpenChange={setUsersOpen}
      />
    </>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles (full web)**

```bash
cd /c/data/dev/dblumi && pnpm --filter web exec tsc --noEmit 2>&1 | grep -v "saved-query.service" | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /c/data/dev/dblumi
git add src/web/src/components/overview/OverviewPage.tsx
git commit -m "feat: add Users button to ConnectionStatusBar + DbUsersModal integration"
```

---

### Task 10: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
cd /c/data/dev/dblumi && pnpm dev
```

- [ ] **Step 2: Test MySQL connection**

1. Open http://localhost:5173, connect to a MySQL database
2. Go to Project Overview — verify "Users" button appears left of Latency button
3. Click Users → modal opens, user list loads
4. Select a user → Identity + privileges pre-fill
5. Create a new user with a password and some privileges → toast "User created"
6. Drop a user → slide to confirm → toast "User dropped"
7. Verify errors (e.g. connect to a DB without sufficient rights) → toast shows raw SQL error

- [ ] **Step 3: Test PostgreSQL connection**

1. Connect to a PostgreSQL database
2. Open modal — Host field absent in Identity tab, Advanced shows connection limit
3. Server Privileges shows PG list (SUPERUSER, CREATEDB, etc.)

- [ ] **Step 4: Test Oracle connection (if available)**

1. Connect to Oracle
2. Modal shows username + status, Advanced tab shows profile (read-only)
3. Server Privileges shows Oracle system privilege list

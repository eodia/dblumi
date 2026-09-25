import type { Pool as PgPool, PoolClient, QueryResult } from 'pg'
import type { Pool as MySQLPool, PoolConnection, ResultSetHeader } from 'mysql2/promise'
import type { Pool as OraclePool, Connection as OracleSession } from 'oracledb'
import type { Client as LibSQLClient } from '@libsql/client'
import type { Trino } from 'trino-client'
import type { MongoClient } from 'mongodb'
import type { ConnectionPool as MssqlPool } from 'mssql'
import type { SnowflakeClient } from './snowflake.js'
import type { RedisConn } from './redis.js'
import type { DbDriver, QueryColumn } from '@dblumi/shared'
import type { DbPool } from './connection-manager.js'
import { runTrino } from './trino.js'
import type { MongoSort } from './mongo.js'
import type { MongoCommand } from './mongo-shell.js'
import { quoteIdent, type SqlDriver } from './drivers.js'
import { mainKeyword, maskSql, safeEnd, scanOptionsFor, splitStatements, topLevel } from './sql-scan.js'

export type ExecutionResult = {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  /** Total rows of the whole result, when the driver knows it for free (Snowflake, Redis). */
  total?: number
}

/** A statement: SQL text, a parsed MongoDB command, or Redis arguments. */
export type Statement = string | MongoCommand | string[]

export type SortSpec = Array<{ column: string; direction: 'asc' | 'desc' }>

/** Page size the grid sends for "All": no LIMIT is injected unless the user wrote one. */
const ALL_ROWS_SENTINEL = 10_000

/**
 * Statements after which a pooled connection can safely be reused. Anything else
 * (`SET`, `BEGIN`, `LOCK`, `ALTER SESSION`, `CREATE TEMP TABLE`…) may leave session
 * state behind — an open transaction, `autocommit=0` — that the next user of the
 * pooled connection would inherit, so that connection is destroyed instead.
 */
const STATELESS_KEYWORDS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'VALUES', 'TABLE', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'DESC', 'LIST', 'LS',
])

/**
 * T-SQL runs as a plain batch (sp_executesql would drop #temp tables at the end
 * of the call), so what outlives a batch — USE, SET options, an open
 * transaction, a #temp object — would stay on the pooled connection. Statements
 * are not always `;`-separated in T-SQL: any such keyword at top level (an
 * UPDATE's SET included, conservatively) sends the batch to a dedicated session.
 */
const MSSQL_SESSION_STATE = /\b(?:USE|SET|BEGIN|SAVE|COMMIT|ROLLBACK)\b|#/i

/** Every statement of `sql` must be stateless: `SELECT 1; SET x = 1` is not. */
function leavesSessionClean(sql: string, driver: SqlDriver): boolean {
  const opts = scanOptionsFor(driver)
  const statements = splitStatements(sql, opts)
  const stateless = statements.length > 0 && statements.every((st) => {
    const keyword = mainKeyword(st.masked)
    return keyword !== null && STATELESS_KEYWORDS.has(keyword)
  })
  return stateless && (driver !== 'mssql' || !MSSQL_SESSION_STATE.test(topLevel(maskSql(sql, opts))))
}

// ──────────────────────────────────────────────
// PostgreSQL execution
// ──────────────────────────────────────────────

type PgClient = PoolClient
type MySQLConnection = PoolConnection
type OracleConnection = OracleSession

async function runPgOn(client: PgClient, sql: string, limit: number, offset: number): Promise<ExecutionResult> {
  const start = Date.now()
  const result: QueryResult = await client.query(injectLimit(sql, limit, offset, 'postgresql'))
  const columns: QueryColumn[] = (result.fields ?? []).map((f) => ({
    name: f.name,
    dataType: pgOidToType(f.dataTypeID),
  }))
  const rows = (result.rows ?? []) as Record<string, unknown>[]
  return { columns, rows, rowCount: result.rowCount ?? rows.length, durationMs: Date.now() - start }
}

export async function executePg(
  pool: PgPool,
  sql: string,
  limit: number,
  offset = 0,
): Promise<ExecutionResult> {
  const client = await pool.connect()
  let destroy = false
  try {
    return await runPgOn(client, sql, limit, offset)
  } catch (err) {
    destroy = true // a failed statement may leave an aborted transaction behind
    throw err
  } finally {
    client.release(destroy || !leavesSessionClean(sql, 'postgresql'))
  }
}

// ──────────────────────────────────────────────
// MySQL execution
// ──────────────────────────────────────────────

async function runMySQLOn(conn: MySQLConnection, sql: string, limit: number, offset: number): Promise<ExecutionResult> {
  const start = Date.now()
  const [rows, fields] = await conn.query(injectLimit(sql, limit, offset, 'mysql'))
  const columns: QueryColumn[] = Array.isArray(fields)
    ? fields.map((f: { name: string; type?: number }) => ({
        name: f.name,
        dataType: String(f.type ?? 'unknown'),
      }))
    : []
  const resultRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
  return {
    columns,
    rows: resultRows,
    // A DML statement answers with a ResultSetHeader, not rows.
    rowCount: Array.isArray(rows) ? resultRows.length : (rows as ResultSetHeader).affectedRows ?? 0,
    durationMs: Date.now() - start,
  }
}

export async function executeMySQL(
  pool: MySQLPool,
  sql: string,
  limit: number,
  offset = 0,
): Promise<ExecutionResult> {
  const conn = await pool.getConnection()
  try {
    return await runMySQLOn(conn, sql, limit, offset)
  } finally {
    if (leavesSessionClean(sql, 'mysql')) conn.release()
    else conn.destroy()
  }
}

// ──────────────────────────────────────────────
// Oracle execution
// ──────────────────────────────────────────────

async function runOracleOn(
  conn: OracleConnection,
  sql: string,
  limit: number,
  offset: number,
  autoCommit: boolean,
): Promise<ExecutionResult> {
  const start = Date.now()
  const result = await conn.execute(injectOracleLimit(sql, limit, offset), [], { outFormat: 4002 /* OBJECT */, autoCommit })
  const columns: QueryColumn[] = (result.metaData ?? []).map((m) => ({
    name: m.name,
    dataType: String(m.dbTypeName ?? 'unknown'),
  }))
  const rows = (result.rows ?? []) as Record<string, unknown>[]
  return { columns, rows, rowCount: result.rows ? rows.length : result.rowsAffected ?? 0, durationMs: Date.now() - start }
}

export async function executeOracle(
  pool: OraclePool,
  sql: string,
  limit: number,
  offset = 0,
): Promise<ExecutionResult> {
  const conn = await pool.getConnection()
  try {
    // autoCommit: a connection handed back to the pool is rolled back, so without
    // it every INSERT/UPDATE/DELETE run from the editor was silently discarded.
    return await runOracleOn(conn, sql, limit, offset, true)
  } finally {
    await conn.close({ drop: !leavesSessionClean(sql, 'oracle') })
  }
}

// ──────────────────────────────────────────────
// SQLite execution
// ──────────────────────────────────────────────

export async function executeSQLite(
  client: LibSQLClient,
  sql: string,
  limit: number,
  offset = 0,
): Promise<ExecutionResult> {
  const start = Date.now()
  const wrappedSql = injectLimit(sql, limit, offset, 'sqlite')
  const result = await client.execute(wrappedSql)

  const columns: QueryColumn[] = result.columns.map((name, i) => ({
    name,
    dataType: sqliteAffinityToType(result.columnTypes[i] ?? ''),
  }))

  const rows: Record<string, unknown>[] = result.rows.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col.name, row[i] ?? null]))
  )

  return {
    columns,
    rows,
    rowCount: columns.length === 0 ? result.rowsAffected : rows.length,
    durationMs: Date.now() - start,
  }
}

// ──────────────────────────────
// Trino execution
// ──────────────────────────────

export async function executeTrino(
  client: Trino,
  sql: string,
  limit: number,
  offset = 0,
): Promise<ExecutionResult> {
  const start = Date.now()
  const wrappedSql = injectTrinoLimit(sql, limit, offset)
  // runTrino already zips columns × data, maps the raw Trino data types, and
  // applies the client's catalog/schema as a per-query override.
  const result = await runTrino(client, wrappedSql)

  return {
    columns: result.columns,
    rows: result.rows,
    // A DML statement returns no rows: report the coordinator's updateCount so
    // the editor does not claim "0 row" after a successful write.
    rowCount:
      result.columns.length === 0 && result.updateCount !== undefined
        ? result.updateCount
        : result.rowCount,
    durationMs: Date.now() - start,
  }
}

function sqliteAffinityToType(affinity: string): string {
  const upper = affinity.toUpperCase()
  if (upper === 'INTEGER' || upper === 'INT') return 'integer'
  if (upper === 'REAL' || upper === 'FLOAT' || upper === 'DOUBLE') return 'real'
  if (upper === 'BLOB') return 'blob'
  if (upper === 'NULL') return 'null'
  return 'text'
}

// ──────────────────────────────────────────────
// Driver dispatch
// ──────────────────────────────────────────────

export type RunOptions = {
  limit: number
  offset: number
  sort?: SortSpec | undefined
  /** MongoDB: database the command runs against. */
  database?: string | undefined
}

/**
 * Runs one statement with pagination (and the grid sort, if any) on any driver.
 * MongoDB takes the already-parsed command (parsed once for the guardrail).
 */
export async function runStatement(
  driver: DbDriver,
  pool: DbPool,
  statement: Statement,
  { limit, offset, sort, database }: RunOptions,
): Promise<ExecutionResult> {
  // Driver modules are loaded on demand, like in connection-manager: this module
  // stays importable (and testable) without every driver stack and its logger.
  if (driver === 'mongodb') {
    const { executeMongo } = await import('./mongo.js')
    return executeMongo(pool as MongoClient, database ?? '', statement as string | MongoCommand, limit, offset, sort as MongoSort | undefined)
  }
  if (driver === 'redis') {
    const { executeRedis } = await import('./redis.js')
    return executeRedis(pool as RedisConn, statement as string[], cap(limit), offset, sort ?? [])
  }
  const sql = typeof statement === 'string' ? statement : ''
  const effective = sort?.length ? applySort(driver, sql, sort) : sql
  switch (driver) {
    case 'postgresql': return executePg(pool as PgPool, effective, limit, offset)
    case 'mysql': return executeMySQL(pool as MySQLPool, effective, limit, offset)
    case 'sqlite': return executeSQLite(pool as LibSQLClient, effective, limit, offset)
    case 'trino': return executeTrino(pool as Trino, effective, limit, offset)
    case 'oracle': return executeOracle(pool as OraclePool, effective, limit, offset)
    case 'mssql': {
      const { streamMssql, withDedicatedMssql } = await import('./mssql.js')
      const mssql = pool as MssqlPool
      return leavesSessionClean(sql, 'mssql')
        ? streamMssql(mssql, effective, cap(limit), offset)
        : withDedicatedMssql(mssql, (session) => streamMssql(session, effective, cap(limit), offset))
    }
    case 'snowflake': {
      const { runSnowflake } = await import('./snowflake.js')
      const client = pool as SnowflakeClient
      const run = (conn: Parameters<Parameters<SnowflakeClient['use']>[0]>[0]) => runSnowflake(conn, effective, cap(limit), offset)
      return leavesSessionClean(sql, 'snowflake') ? client.use(run) : client.dedicated(run)
    }
  }
}

/** Page size → row cap; the "All" sentinel means no cap. */
function cap(limit: number): number | null {
  return limit >= ALL_ROWS_SENTINEL ? null : limit
}

/**
 * Runs a batch in order on ONE connection — a session. Sent one request per
 * statement, `SET search_path TO x; DELETE …` or `BEGIN; DELETE …; ROLLBACK`
 * would each run on whatever pooled connection came next.
 * Stops at the first failing statement (the error propagates). The connection
 * is dropped afterwards when the batch failed or changed session state, so the
 * session never leaks to the next user of the pool. On Oracle the batch is one
 * transaction, committed at the end unless it fails (a ROLLBACK inside works).
 */
export async function runBatch(
  driver: DbDriver,
  pool: DbPool,
  statements: Statement[],
  { limit, database }: { limit: number; database?: string | undefined },
  hooks: { onStart: (index: number) => Promise<void>; onResult: (index: number, result: ExecutionResult) => Promise<void> },
): Promise<void> {
  const each = async (run: (statement: Statement) => Promise<ExecutionResult>) => {
    for (const [i, statement] of statements.entries()) {
      await hooks.onStart(i)
      await hooks.onResult(i, await run(statement))
    }
  }
  const text = (st: Statement) => (typeof st === 'string' ? st : '')

  switch (driver) {
    case 'postgresql': {
      const client = await (pool as PgPool).connect()
      let failed = false
      try {
        await each((st) => runPgOn(client, text(st), limit, 0))
      } catch (err) {
        failed = true
        throw err
      } finally {
        client.release(failed || !statements.every((st) => leavesSessionClean(text(st), 'postgresql')))
      }
      return
    }
    case 'mysql': {
      const conn = await (pool as MySQLPool).getConnection()
      let failed = false
      try {
        await each((st) => runMySQLOn(conn, text(st), limit, 0))
      } catch (err) {
        failed = true
        throw err
      } finally {
        if (!failed && statements.every((st) => leavesSessionClean(text(st), 'mysql'))) conn.release()
        else conn.destroy()
      }
      return
    }
    case 'oracle': {
      const conn = await (pool as OraclePool).getConnection()
      let failed = false
      try {
        await each((st) => runOracleOn(conn, text(st), limit, 0, false))
        await conn.commit()
      } catch (err) {
        failed = true
        throw err
      } finally {
        // Dropping the session also rolls back what a failed batch left uncommitted.
        await conn.close({ drop: failed || !statements.every((st) => leavesSessionClean(text(st), 'oracle')) })
      }
      return
    }
    case 'sqlite':
      return each((st) => executeSQLite(pool as LibSQLClient, text(st), limit, 0))
    case 'trino':
      return each((st) => executeTrino(pool as Trino, text(st), limit, 0))
    case 'mongodb': {
      const { executeMongo } = await import('./mongo.js')
      return each((st) => executeMongo(pool as MongoClient, database ?? '', st as string | MongoCommand, limit, 0))
    }
    case 'mssql': {
      // A batch gets its own connection, closed afterwards: temp tables, SET and
      // USE live for the batch only. (A T-SQL script declaring variables arrives
      // as one statement: the editor does not split it.)
      const { streamMssql, withDedicatedMssql } = await import('./mssql.js')
      return withDedicatedMssql(pool as MssqlPool, (session) => each((st) => streamMssql(session, text(st), cap(limit), 0)))
    }
    case 'snowflake': {
      const { runSnowflake } = await import('./snowflake.js')
      return (pool as SnowflakeClient).dedicated((conn) => each((st) => runSnowflake(conn, text(st), cap(limit), 0)))
    }
    case 'redis': {
      const { runRedisBatch } = await import('./redis.js')
      return runRedisBatch(pool as RedisConn, statements as string[][], limit, hooks)
    }
  }
}

// ──────────────────────────────────────────────
// Sort & count wrappers (grid)
// ──────────────────────────────────────────────

/** The single SELECT of `sql` without its trailing `;`/comments, or null. */
function singleQueryBody(driver: SqlDriver, sql: string): string | null {
  const opts = scanOptionsFor(driver)
  const statements = splitStatements(sql, opts)
  if (statements.length !== 1) return null
  const masked = maskSql(sql, opts)
  if (mainKeyword(masked) !== 'SELECT') return null
  return sql.slice(0, safeEnd(sql, masked))
}

/**
 * Wraps a query so that the grid sort takes precedence without destroying the
 * user's own ORDER BY. Columns are quoted (mixed case, spaces, `COUNT(*)`), and
 * Oracle gets an alias without `AS`, which it rejects (ORA-00933).
 */
export function applySort(driver: SqlDriver, sql: string, sort: SortSpec): string {
  const body = singleQueryBody(driver, sql)
  if (!body || sort.length === 0) return sql
  const order = sort
    .map((s) => `${quoteIdent(driver, s.column)} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`)
    .join(', ')
  if (driver === 'mssql') return mssqlSort(body, order) ?? sql
  const alias = driver === 'oracle' ? 'dblumi_s' : 'AS _s'
  // Newlines around the body: it may end with a line comment.
  return `SELECT * FROM (\n${body}\n) ${alias} ORDER BY ${order}`
}

/**
 * What keeps a T-SQL query from being wrapped in a derived table: FOR XML /
 * OPTION(…) clauses, SELECT … INTO, and a leading CTE (`WITH` cannot open a
 * subquery in T-SQL).
 */
function mssqlShape(body: string) {
  const top = topLevel(maskSql(body, scanOptionsFor('mssql')))
  return {
    top,
    unwrappable: /\bFOR\s+(?:XML|JSON|BROWSE)\b|\bOPTION\s*\(|\bINTO\b/i.test(top),
    cte: /^\s*WITH\b/i.test(top),
    windowed: /\bTOP\b|\bOFFSET\b/i.test(top),
  }
}

/**
 * T-SQL rejects an ORDER BY inside a derived table unless TOP or OFFSET is
 * there: the user's own ORDER BY is replaced (or the sort appended) instead of
 * wrapping the query.
 */
function mssqlSort(body: string, order: string): string | null {
  const { top, unwrappable, cte, windowed } = mssqlShape(body)
  if (unwrappable) return null
  if (windowed) return cte ? null : `SELECT * FROM (\n${body}\n) AS _s ORDER BY ${order}`
  const orderBy = [...top.matchAll(/\bORDER\s+BY\b/gi)].pop()
  if (orderBy) return `${body.slice(0, orderBy.index)}ORDER BY ${order}`
  return `${body}\nORDER BY ${order}`
}

/** `SELECT COUNT(*)` over a query, for the grid's page count — null when not a query. */
export function buildCountSql(driver: SqlDriver, sql: string): string | null {
  const body = singleQueryBody(driver, sql)
  if (!body) return null
  if (driver === 'mssql') {
    const { top, unwrappable, cte, windowed } = mssqlShape(body)
    if (unwrappable || cte) return null
    // An ORDER BY without TOP/OFFSET is illegal in the derived table: drop it, it
    // does not change a count.
    const orderBy = windowed ? undefined : [...top.matchAll(/\bORDER\s+BY\b/gi)].pop()
    const inner = orderBy ? body.slice(0, orderBy.index) : body
    return `SELECT COUNT_BIG(*) AS total FROM (\n${inner}\n) AS _cnt`
  }
  return driver === 'oracle'
    ? `SELECT COUNT(*) AS "total" FROM (\n${body}\n) dblumi_cnt`
    : `SELECT COUNT(*) AS total FROM (\n${body}\n) AS _cnt`
}

// ──────────────────────────────────────────────
// Pagination
// ──────────────────────────────────────────────

/**
 * Page window over a query that may carry its own LIMIT/OFFSET: the grid pages
 * INSIDE the user's window instead of replacing it.
 *   `LIMIT 150`, page size 100, page 2 → LIMIT 50 OFFSET 100
 *   `OFFSET 10`, page size 20, page 3  → LIMIT 20 OFFSET 50
 */
export function pageWindow(
  userLimit: number | null,
  userOffset: number | null,
  limit: number,
  offset: number,
): { limit: number | null; offset: number } {
  const effOffset = (userOffset ?? 0) + offset
  if (userLimit !== null) {
    return { limit: Math.max(0, Math.min(limit, userLimit - offset)), offset: effOffset }
  }
  // "All" (null): no row cap unless the user wrote one.
  return { limit: limit >= ALL_ROWS_SENTINEL ? null : limit, offset: effOffset }
}

type Tail = { userLimit: number | null; userOffset: number | null; body: string }

/**
 * Strips the trailing LIMIT/OFFSET/FETCH clause of a statement. Clauses are
 * matched on the masked text and ANCHORED AT THE END, so a LIMIT inside a
 * subquery, a CTE, a literal or a comment is never touched.
 * Returns null when the tail uses a form we cannot rewrite safely
 * (`LIMIT $1`, `LIMIT ALL`, `FETCH … WITH TIES`…): the statement then runs as written.
 */
function stripLimitTail(sql: string, driver: SqlDriver): Tail | null {
  const masked = maskSql(sql, scanOptionsFor(driver))
  const end = safeEnd(sql, masked)
  let body = sql.slice(0, end)
  let mBody = masked.slice(0, end)
  let userLimit: number | null = null
  let userOffset: number | null = null
  const cut = (m: RegExpMatchArray) => {
    body = body.slice(0, m.index).trimEnd()
    mBody = mBody.slice(0, m.index).trimEnd()
  }
  let m: RegExpMatchArray | null

  const commaForm = driver === 'mysql' || driver === 'sqlite'
  const standardForm = driver === 'postgresql' || driver === 'oracle' || driver === 'trino'

  if (commaForm && (m = mBody.match(/\s+LIMIT\s+(\d+)\s*,\s*(\d+)\s*$/i))) {
    // MySQL / SQLite `LIMIT offset, count`
    userOffset = Number(m[1])
    userLimit = Number(m[2])
    cut(m)
  } else if (driver !== 'oracle' && driver !== 'trino' && (m = mBody.match(/\s+LIMIT\s+(\d+)\s+OFFSET\s+(\d+)\s*$/i))) {
    userLimit = Number(m[1])
    userOffset = Number(m[2])
    cut(m)
  } else {
    if (driver !== 'oracle' && (m = mBody.match(/\s+LIMIT\s+(\d+)\s*$/i))) {
      userLimit = Number(m[1])
      cut(m)
    } else if (standardForm && (m = mBody.match(/\s+FETCH\s+(?:FIRST|NEXT)\s+(?:(\d+)\s+)?ROWS?\s+ONLY\s*$/i))) {
      userLimit = m[1] !== undefined ? Number(m[1]) : 1 // `FETCH FIRST ROW ONLY` means one row
      cut(m)
    }
    // The standard OFFSET sits BEFORE LIMIT/FETCH (pg also takes `OFFSET 5 LIMIT 10`).
    if (standardForm && (m = mBody.match(/\s+OFFSET\s+(\d+)(?:\s+ROWS?)?\s*$/i))) {
      userOffset = Number(m[1])
      cut(m)
    }
  }

  // Anything left that still looks like a limiting clause is a form we do not
  // rewrite (`LIMIT ALL`, `LIMIT $1`, `WITH TIES`…). Patterns need a value after
  // the keyword, so a column merely named `offset` or `limit` does not count.
  // A value must follow the keyword: `ORDER BY offset DESC` names a column.
  // `… LIMIT 5 FOR UPDATE` keeps its LIMIT inside the statement: left as written too.
  const rest = topLevel(mBody)
  if (
    /\bLIMIT\s+(?:\d|\$\d|:\w|\?|\(|ALL\b)/i.test(rest) ||
    /\bOFFSET\s+(?:\d|\$\d|:\w|\?|\()/i.test(rest) ||
    /\bFETCH\s+(?:FIRST|NEXT)\b/i.test(rest)
  ) {
    return null
  }
  return { userLimit, userOffset, body }
}

function isQuery(sql: string, driver: SqlDriver): boolean {
  return mainKeyword(maskSql(sql, scanOptionsFor(driver))) === 'SELECT'
}

/** Trailing `;` and comments removed — drivers reject some of them, e.g. Trino. */
function withoutTrailingNoise(sql: string, driver: SqlDriver): string {
  return sql.slice(0, safeEnd(sql, maskSql(sql, scanOptionsFor(driver)))).trim()
}

/**
 * PostgreSQL / MySQL / SQLite pagination: `LIMIT n [OFFSET m]` appended to
 * queries; any other statement is left as is.
 */
export function injectLimit(
  sql: string,
  limit: number,
  offset = 0,
  driver: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql',
): string {
  const trimmed = withoutTrailingNoise(sql, driver)
  if (!isQuery(trimmed, driver)) return trimmed
  const tail = stripLimitTail(trimmed, driver)
  if (!tail) return trimmed
  const win = pageWindow(tail.userLimit, tail.userOffset, limit, offset)
  if (win.limit === null) {
    if (win.offset === 0) return tail.body
    // Unbounded OFFSET: pg takes it alone, MySQL and SQLite need a LIMIT with it.
    if (driver === 'postgresql') return `${tail.body}\nOFFSET ${win.offset}`
    const unbounded = driver === 'mysql' ? '18446744073709551615' : '-1'
    return `${tail.body}\nLIMIT ${unbounded} OFFSET ${win.offset}`
  }
  return `${tail.body}\nLIMIT ${win.limit}${win.offset > 0 ? ` OFFSET ${win.offset}` : ''}`
}

/** Oracle pagination: `OFFSET m ROWS FETCH NEXT n ROWS ONLY` (Oracle 12c+). */
export function injectOracleLimit(sql: string, limit: number, offset = 0): string {
  // PL/SQL blocks and stored code need their final `;` (after END): run verbatim.
  if (/^\s*(BEGIN|DECLARE|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|PACKAGE|TYPE)\b)/i.test(maskSql(sql))) {
    return sql.trim()
  }
  const trimmed = withoutTrailingNoise(sql, 'oracle')
  if (!isQuery(trimmed, 'oracle')) return trimmed
  const tail = stripLimitTail(trimmed, 'oracle')
  if (!tail) return trimmed
  const win = pageWindow(tail.userLimit, tail.userOffset, limit, offset)
  if (win.limit === null) {
    return win.offset > 0 ? `${tail.body}\nOFFSET ${win.offset} ROWS` : tail.body
  }
  return `${tail.body}\nOFFSET ${win.offset} ROWS FETCH NEXT ${win.limit} ROWS ONLY`
}

/**
 * Trino pagination. The grammar imposes OFFSET BEFORE LIMIT:
 *   [ORDER BY ...] [OFFSET n [ROW|ROWS]] [ LIMIT n | FETCH FIRST n ROWS ONLY ]
 * `LIMIT n OFFSET m` is a Trino parse error, so `injectLimit` cannot be reused.
 * `LIMIT` and `FETCH FIRST` are mutually exclusive alternatives of the same
 * production, so an existing `FETCH` must be stripped, never complemented.
 */
export function injectTrinoLimit(sql: string, limit: number, offset = 0): string {
  // /v1/statement refuses a trailing ';', even on non-SELECT statements.
  const trimmed = withoutTrailingNoise(sql, 'trino')
  if (!isQuery(trimmed, 'trino')) return trimmed
  const masked = maskSql(trimmed)
  // WITH TIES cannot be expressed with LIMIT: keep it as the row count.
  const ties = masked.match(/\s+FETCH\s+(?:FIRST|NEXT)\s+(?:(\d+)\s+)?ROWS?\s+WITH\s+TIES\s*$/i)
  const source = ties ? trimmed.slice(0, ties.index) + (ties[1] ? `\nLIMIT ${ties[1]}` : '\nLIMIT 1') : trimmed
  const tail = stripLimitTail(source, 'trino')
  if (!tail) return trimmed
  const win = pageWindow(tail.userLimit, tail.userOffset, limit, offset)
  let result = tail.body
  if (win.offset > 0) result += `\nOFFSET ${win.offset}`
  if (win.limit !== null) result += `\nLIMIT ${win.limit}`
  return result
}

/**
 * Very rough pg OID → human-readable type.
 * Full mapping not needed for display purposes.
 */
function pgOidToType(oid: number): string {
  const map: Record<number, string> = {
    16: 'boolean',
    20: 'bigint',
    21: 'smallint',
    23: 'integer',
    25: 'text',
    700: 'float4',
    701: 'float8',
    1043: 'varchar',
    1082: 'date',
    1083: 'time',
    1114: 'timestamp',
    1184: 'timestamptz',
    114: 'json',
    3802: 'jsonb',
    2950: 'uuid',
    1700: 'numeric',
    17: 'bytea',
    26: 'oid',
  }
  return map[oid] ?? `oid(${oid})`
}

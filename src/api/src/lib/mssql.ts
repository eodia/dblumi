import type { ConnectionPool, config as MssqlConfig } from 'mssql'
import type { QueryColumn } from '@dblumi/shared'
import type { PoolOptions } from './connection-manager.js'
import { formatBytes } from './format.js'

export const MSSQL_DEFAULT_PORT = 1433
/** Time budget of one statement (mssql's default is 15 s, too short for reporting queries). */
const REQUEST_TIMEOUT_MS = 10 * 60_000
const DUMP_MAX_ROWS = 100_000

export type MssqlResult = {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
}

type MssqlModule = typeof import('mssql')

async function loadMssql(): Promise<MssqlModule> {
  // CommonJS module: its API hangs off `default` when imported from ESM.
  const mod = (await import('mssql')) as MssqlModule & { default?: MssqlModule }
  return mod.default ?? mod
}

/**
 * Connection settings. The host may name an instance (`server\SQLEXPRESS`): it is
 * then resolved by the SQL Browser service, and the port is not sent.
 */
export function mssqlConfig(opts: PoolOptions): MssqlConfig {
  const [server = '', instanceName] = (opts.host ?? '').trim().split('\\')
  return {
    server,
    ...(instanceName ? {} : { port: opts.port ?? MSSQL_DEFAULT_PORT }),
    ...(opts.database ? { database: opts.database } : {}),
    ...(opts.username ? { user: opts.username } : {}),
    ...(opts.password ? { password: opts.password } : {}),
    options: {
      encrypt: !!opts.ssl,
      // Same trust model as the pg driver (rejectUnauthorized: false): self-signed
      // certificates are the norm on SQL Server, Azure SQL presents a valid one.
      trustServerCertificate: true,
      appName: 'dblumi',
      ...(instanceName ? { instanceName } : {}),
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 10_000,
    requestTimeout: REQUEST_TIMEOUT_MS,
  }
}

/** Settings of each pool (the mssql typings do not expose `pool.config`). */
const poolConfigs = new WeakMap<ConnectionPool, MssqlConfig>()

export async function createMssqlPool(opts: PoolOptions, onError: (err: unknown) => void): Promise<ConnectionPool> {
  const mssql = await loadMssql()
  const config = mssqlConfig(opts)
  const pool = new mssql.ConnectionPool(config)
  poolConfigs.set(pool, config)
  pool.on('error', onError)
  await pool.connect()
  return pool
}

/**
 * Runs `fn` on a pool of ONE fresh connection, closed afterwards. Used for
 * batches and session-changing statements (`USE`, `SET`, `BEGIN TRAN`, temp
 * tables): on the shared pool they would run on one connection and leave their
 * state to whoever borrows it next.
 */
export async function withDedicatedMssql<T>(pool: ConnectionPool, fn: (session: ConnectionPool) => Promise<T>): Promise<T> {
  const mssql = await loadMssql()
  const config = poolConfigs.get(pool)
  if (!config) throw new Error('Configuration SQL Server introuvable pour ce pool.')
  const session = new mssql.ConnectionPool({ ...config, pool: { max: 1, min: 0 } })
  session.on('error', () => { /* surfaced by the request itself */ })
  await session.connect()
  try {
    return await fn(session)
  } finally {
    await session.close().catch(() => {})
  }
}

type ColumnMeta = { index: number; name: string; type?: { declaration?: string } | undefined }

/** Unique, non-empty column names: `SELECT a.id, b.id` or `SELECT COUNT(*)` must stay readable. */
function columnNames(meta: ColumnMeta[]): string[] {
  const seen = new Map<string, number>()
  return meta.map((c) => {
    const base = c.name || '(No column name)'
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}_${n}`
  })
}

function cellValue(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex').toUpperCase()}`
  return v
}

/**
 * Streams a statement and keeps the page window only, then cancels the request.
 * No SQL rewriting: `OFFSET … FETCH` needs an ORDER BY in T-SQL and cannot be
 * added after a `TOP`, while reading the stream pages any statement as written.
 * Only the first result set is returned; `limit: null` reads everything.
 */
export function streamMssql(
  pool: ConnectionPool,
  sql: string,
  limit: number | null,
  offset: number,
): Promise<MssqlResult> {
  return new Promise((resolve, reject) => {
    const request = pool.request()
    request.stream = true
    request.arrayRowMode = true
    const start = Date.now()
    let names: string[] | null = null
    let columns: QueryColumn[] = []
    let recordsets = 0
    let seen = 0
    let rowsAffected = 0
    let settled = false
    const rows: Record<string, unknown>[] = []

    const finish = () => {
      if (settled) return
      settled = true
      resolve({
        columns,
        rows,
        rowCount: names ? rows.length : rowsAffected,
        durationMs: Date.now() - start,
      })
    }

    request.on('recordset', (meta: ColumnMeta[]) => {
      recordsets++
      if (recordsets !== 1) return
      names = columnNames(meta)
      columns = meta.map((c, i) => ({ name: names![i]!, dataType: c.type?.declaration ?? 'unknown' }))
    })
    request.on('row', (values: unknown[]) => {
      if (settled || recordsets !== 1 || !names) return
      if (seen++ < offset) return
      const row: Record<string, unknown> = {}
      names.forEach((name, i) => Object.defineProperty(row, name, { value: cellValue(values[i]), enumerable: true, writable: true, configurable: true }))
      rows.push(row)
      if (limit !== null && rows.length >= limit) {
        // Page full: stop the server instead of reading the rest of the result.
        request.cancel()
        finish()
      }
    })
    request.on('rowsaffected', (n: number) => { rowsAffected += n })
    request.on('error', (err: unknown) => {
      if (settled) return // ECANCEL after a full page
      settled = true
      reject(err)
    })
    request.on('done', finish)
    // A plain batch, as SSMS sends it. `query()` goes through sp_executesql, whose
    // scope drops #temp tables and reverts USE / SET at the end of the call.
    void request.batch(sql)
  })
}

// ──────────────────────────────────────────────
// Introspection
// ──────────────────────────────────────────────

type SchemaColumn = { name: string; dataType: string; nullable: boolean; primaryKey: boolean }
type SchemaTable = {
  name: string
  type: 'table' | 'view'
  comment: string
  columns: SchemaColumn[]
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>
  foreignKeys: Array<{ name: string; fields: string[]; referencedDatabase: string; referencedTable: string; referencedFields: string[]; onDelete: string; onUpdate: string }>
}
type SchemaFunction = { name: string; kind: string; return_type: string; arguments: string; language: string }

/** `dbo` is the default schema: its tables keep a bare name, the others are `schema.table`. */
function displayName(schema: string, table: string): string {
  return schema.toLowerCase() === 'dbo' ? table : `${schema}.${table}`
}

async function all<T>(pool: ConnectionPool, sql: string): Promise<T[]> {
  const res = await pool.request().query(sql)
  return res.recordset as unknown as T[]
}

export async function getMssqlSchema(pool: ConnectionPool): Promise<{ tables: SchemaTable[]; functions: SchemaFunction[] }> {
  const [cols, indexes, fks, routines] = await Promise.all([
    all<{ schema_name: string; table_name: string; table_type: string; column_name: string; data_type: string; is_nullable: boolean; is_pk: boolean; comment: string | null }>(pool, `
      SELECT s.name AS schema_name, o.name AS table_name, o.type AS table_type, c.name AS column_name,
             TYPE_NAME(c.user_type_id) +
               CASE
                 WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'char', 'varbinary', 'binary') THEN '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length AS varchar(10))) + ')'
                 WHEN TYPE_NAME(c.user_type_id) IN ('nvarchar', 'nchar') THEN '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length / 2 AS varchar(10))) + ')'
                 WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric') THEN '(' + CAST(c.precision AS varchar(3)) + ',' + CAST(c.scale AS varchar(3)) + ')'
                 ELSE ''
               END AS data_type,
             c.is_nullable,
             CAST(IIF(pk.column_id IS NULL, 0, 1) AS bit) AS is_pk,
             CAST(ep.value AS nvarchar(4000)) AS comment
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      JOIN sys.columns c ON c.object_id = o.object_id
      LEFT JOIN (
        SELECT ic.object_id, ic.column_id
        FROM sys.indexes i
        JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        WHERE i.is_primary_key = 1
      ) pk ON pk.object_id = o.object_id AND pk.column_id = c.column_id
      LEFT JOIN sys.extended_properties ep
        ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.class = 1 AND ep.name = 'MS_Description'
      WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
      ORDER BY s.name, o.name, c.column_id`),
    all<{ schema_name: string; table_name: string; index_name: string; is_unique: boolean; column_name: string }>(pool, `
      SELECT s.name AS schema_name, t.name AS table_name, i.name AS index_name, i.is_unique, c.name AS column_name
      FROM sys.indexes i
      JOIN sys.tables t ON t.object_id = i.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.is_primary_key = 0 AND i.type > 0 AND t.is_ms_shipped = 0
      ORDER BY s.name, t.name, i.name, ic.key_ordinal`),
    all<{ schema_name: string; table_name: string; fk_name: string; column_name: string; ref_schema: string; ref_table: string; ref_column: string; on_delete: string; on_update: string }>(pool, `
      SELECT s.name AS schema_name, t.name AS table_name, fk.name AS fk_name, pc.name AS column_name,
             rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_column,
             REPLACE(fk.delete_referential_action_desc, '_', ' ') AS on_delete,
             REPLACE(fk.update_referential_action_desc, '_', ' ') AS on_update
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.tables t ON t.object_id = fk.parent_object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
      JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
      JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
      JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id`),
    all<{ schema_name: string; name: string; type: string; return_type: string | null; arguments: string | null }>(pool, `
      SELECT s.name AS schema_name, o.name, o.type,
             (SELECT TYPE_NAME(p.user_type_id) FROM sys.parameters p WHERE p.object_id = o.object_id AND p.parameter_id = 0) AS return_type,
             STUFF((SELECT ', ' + p.name + ' ' + TYPE_NAME(p.user_type_id) + IIF(p.is_output = 1, ' OUTPUT', '')
                    FROM sys.parameters p WHERE p.object_id = o.object_id AND p.parameter_id > 0
                    ORDER BY p.parameter_id FOR XML PATH('')), 1, 2, '') AS arguments
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE o.type IN ('FN', 'IF', 'TF', 'P') AND o.is_ms_shipped = 0
      ORDER BY o.type, s.name, o.name`),
  ])

  const tables = new Map<string, SchemaTable>()
  for (const c of cols) {
    const key = displayName(c.schema_name, c.table_name)
    let t = tables.get(key)
    if (!t) {
      t = { name: key, type: c.table_type.trim() === 'V' ? 'view' : 'table', comment: c.comment ?? '', columns: [], indexes: [], foreignKeys: [] }
      tables.set(key, t)
    }
    t.columns.push({ name: c.column_name, dataType: c.data_type, nullable: !!c.is_nullable, primaryKey: !!c.is_pk })
  }
  for (const ix of indexes) {
    const t = tables.get(displayName(ix.schema_name, ix.table_name))
    if (!t) continue
    let idx = t.indexes.find((i) => i.name === ix.index_name)
    if (!idx) {
      idx = { name: ix.index_name, columns: [], unique: !!ix.is_unique }
      t.indexes.push(idx)
    }
    idx.columns.push(ix.column_name)
  }
  for (const fk of fks) {
    const t = tables.get(displayName(fk.schema_name, fk.table_name))
    if (!t) continue
    let entry = t.foreignKeys.find((f) => f.name === fk.fk_name)
    if (!entry) {
      entry = { name: fk.fk_name, fields: [], referencedDatabase: fk.ref_schema, referencedTable: displayName(fk.ref_schema, fk.ref_table), referencedFields: [], onDelete: fk.on_delete, onUpdate: fk.on_update }
      t.foreignKeys.push(entry)
    }
    entry.fields.push(fk.column_name)
    entry.referencedFields.push(fk.ref_column)
  }
  const functions = routines.map((r) => ({
    name: displayName(r.schema_name, r.name),
    kind: r.type.trim() === 'P' ? 'procedure' : 'function',
    return_type: r.type.trim() === 'IF' || r.type.trim() === 'TF' ? 'TABLE' : r.return_type ?? '',
    arguments: r.arguments ?? '',
    language: 'tsql',
  }))
  return { tables: [...tables.values()], functions }
}

export async function listMssqlDatabases(pool: ConnectionPool): Promise<string[]> {
  const rows = await all<{ name: string }>(pool, 'SELECT name FROM sys.databases WHERE HAS_DBACCESS(name) = 1 ORDER BY name')
  return rows.map((r) => r.name)
}

export async function getMssqlStats(pool: ConnectionPool) {
  const [row] = await all<{ version: string; collation: string | null; size_bytes: number | string | null }>(pool, `
    SELECT @@VERSION AS version,
           CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) AS collation,
           (SELECT SUM(CAST(size AS bigint)) * 8192 FROM sys.database_files) AS size_bytes`)
  let timezone: string | null = null
  try {
    // CURRENT_TIMEZONE() exists since SQL Server 2019 / Azure SQL.
    const [tz] = await all<{ tz: string }>(pool, 'SELECT CURRENT_TIMEZONE() AS tz')
    timezone = tz?.tz ?? null
  } catch { /* older server */ }
  const sizeBytes = Number(row?.size_bytes ?? 0) || null
  return {
    version: row?.version?.split('\n')[0]?.trim() ?? null,
    encoding: row?.collation ?? null,
    timezone,
    sizeBytes,
    sizePretty: sizeBytes ? formatBytes(sizeBytes) : null,
  }
}

/** Source and parameters of a function or procedure (`name` may be `schema.name`). */
export async function getMssqlRoutine(pool: ConnectionPool, name: string) {
  const mssql = await loadMssql()
  const [schema, routine] = name.includes('.') ? name.split('.', 2) as [string, string] : ['dbo', name]
  const objects = await pool.request()
    .input('schema', mssql.NVarChar, schema)
    .input('name', mssql.NVarChar, routine)
    .query(`
      SELECT o.object_id, o.name, o.type, OBJECT_DEFINITION(o.object_id) AS source,
             (SELECT TYPE_NAME(p.user_type_id) FROM sys.parameters p WHERE p.object_id = o.object_id AND p.parameter_id = 0) AS return_type
      FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE s.name = @schema AND o.name = @name AND o.type IN ('FN', 'IF', 'TF', 'P')`)
  const obj = (objects.recordset as unknown as Array<{ object_id: number; name: string; type: string; source: string | null; return_type: string | null }>)[0]
  if (!obj) return null
  const params = await pool.request()
    .input('id', mssql.Int, obj.object_id)
    .query(`SELECT p.name, TYPE_NAME(p.user_type_id) AS type FROM sys.parameters p
            WHERE p.object_id = @id AND p.parameter_id > 0 AND p.is_output = 0 ORDER BY p.parameter_id`)
  const kind = obj.type.trim() === 'P' ? 'procedure' : 'function'
  return {
    name,
    kind,
    return_type: obj.return_type ?? '',
    source: obj.source ?? '',
    language: 'tsql',
    arguments: '',
    // Parameter names keep their '@': the editor builds `EXEC name @p = …` from them.
    params: (params.recordset as unknown as Array<{ name: string; type: string }>).map((p) => ({ name: p.name, type: p.type })),
  }
}

// ──────────────────────────────────────────────
// Dump
// ──────────────────────────────────────────────

export function quoteMssql(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

/** `schema.table` (or a bare `dbo` table) → [schema].[table]. */
export function mssqlTableRef(table: string): { schema: string; name: string; ref: string } {
  const [schema, name] = table.includes('.') ? table.split('.', 2) as [string, string] : ['dbo', table]
  return { schema, name, ref: `${quoteMssql(schema)}.${quoteMssql(name)}` }
}

/** T-SQL literal: N'…' strings, 0x… binaries, 1/0 for bits (T-SQL has no TRUE/FALSE). */
export function mssqlLiteral(v: unknown, dataType = ''): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${v.toISOString()}'`
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`
  // Binaries come back from streamMssql as 0x… text: only a binary column gets them raw.
  if (typeof v === 'string' && /binary|image/i.test(dataType) && /^0x[0-9a-fA-F]*$/.test(v)) return v
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `N'${s.replace(/'/g, "''")}'`
}

export async function dumpMssqlTable(pool: ConnectionPool, table: string, includeData: boolean): Promise<string> {
  const mssql = await loadMssql()
  const { schema, name, ref } = mssqlTableRef(table)
  const cols = await pool.request()
    .input('schema', mssql.NVarChar, schema)
    .input('name', mssql.NVarChar, name)
    .query(`
      SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS type, c.CHARACTER_MAXIMUM_LENGTH AS len,
             c.NUMERIC_PRECISION AS prec, c.NUMERIC_SCALE AS scale, c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS dflt,
             COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @name
      ORDER BY c.ORDINAL_POSITION`)
  const pk = await pool.request()
    .input('schema', mssql.NVarChar, schema)
    .input('name', mssql.NVarChar, name)
    .query(`
      SELECT k.COLUMN_NAME AS name
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND k.TABLE_SCHEMA = t.TABLE_SCHEMA
      WHERE t.TABLE_SCHEMA = @schema AND t.TABLE_NAME = @name AND t.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY k.ORDINAL_POSITION`)
  type Col = { name: string; type: string; len: number | null; prec: number | null; scale: number | null; nullable: string; dflt: string | null; is_identity: number | null }
  const columns = cols.recordset as unknown as Col[]
  if (columns.length === 0) throw new Error(`Table introuvable : ${table}`)
  const defs = columns.map((c) => {
    let type = c.type
    if (['varchar', 'nvarchar', 'char', 'nchar', 'varbinary', 'binary'].includes(c.type)) type += `(${c.len === -1 ? 'max' : c.len})`
    else if (['decimal', 'numeric'].includes(c.type)) type += `(${c.prec},${c.scale})`
    let def = `  ${quoteMssql(c.name)} ${type}`
    if (c.is_identity === 1) def += ' IDENTITY(1,1)'
    if (c.dflt) def += ` DEFAULT ${c.dflt}`
    if (c.nullable === 'NO') def += ' NOT NULL'
    return def
  })
  const pkCols = (pk.recordset as unknown as Array<{ name: string }>).map((r) => quoteMssql(r.name))
  if (pkCols.length) defs.push(`  PRIMARY KEY (${pkCols.join(', ')})`)
  // The table name is bracket-quoted in the comment too: a newline in it must not end the comment.
  const parts = [`-- Table: ${quoteMssql(schema)}.${quoteMssql(name).replace(/[\r\n]+/g, ' ')}`, `CREATE TABLE ${ref} (\n${defs.join(',\n')}\n);`]

  if (includeData) {
    const data = await streamMssql(pool, `SELECT * FROM ${ref}`, DUMP_MAX_ROWS + 1, 0)
    const identity = columns.some((c) => c.is_identity === 1)
    const colList = data.columns.map((c) => quoteMssql(c.name)).join(', ')
    if (identity && data.rows.length) parts.push(`SET IDENTITY_INSERT ${ref} ON;`)
    for (const row of data.rows.slice(0, DUMP_MAX_ROWS)) {
      parts.push(`INSERT INTO ${ref} (${colList}) VALUES (${data.columns.map((c) => mssqlLiteral(row[c.name], c.dataType)).join(', ')});`)
    }
    if (identity && data.rows.length) parts.push(`SET IDENTITY_INSERT ${ref} OFF;`)
    if (data.rows.length > DUMP_MAX_ROWS) parts.push(`-- data truncated at ${DUMP_MAX_ROWS} rows`)
  }
  return parts.join('\n')
}

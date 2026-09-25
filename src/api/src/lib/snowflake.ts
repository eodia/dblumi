import type { Connection, ConnectionOptions, RowStatement } from 'snowflake-sdk'
import type { QueryColumn } from '@dblumi/shared'
import type { PoolOptions } from './connection-manager.js'
import { logger } from '../logger.js'

const DUMP_MAX_ROWS = 100_000
/** SHOW commands stop at 10 000 rows. */
const SHOW_ROW_CAP = 10_000

type SnowflakeModule = typeof import('snowflake-sdk')
type SnowflakePool = ReturnType<SnowflakeModule['createPool']>

export type SnowflakeResult = {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  /** Total rows of the result: Snowflake reports it, no COUNT(*) re-run needed. */
  total?: number
}

let configured = false

async function loadSnowflake(): Promise<SnowflakeModule> {
  const mod = (await import('snowflake-sdk')) as SnowflakeModule & { default?: SnowflakeModule }
  const sf = mod.default ?? mod
  if (!configured) {
    // The SDK writes a snowflake.log file in the working directory by default:
    // route its warnings and errors to our logger instead.
    sf.configure({
      logLevel: 'WARN',
      customLogger: {
        error: (m: string) => logger.error({ driver: 'snowflake' }, m),
        warn: (m: string) => logger.warn({ driver: 'snowflake' }, m),
        info: () => {},
        debug: () => {},
        trace: () => {},
      },
    })
    configured = true
  }
  return sf
}

/** Account identifier from what users paste: `xy12345.eu-west-1`, `org-account`, or the full URL. */
export function snowflakeAccount(host: string): string {
  return host
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.snowflakecomputing\.com$/i, '')
}

/** "DB" or "DB/SCHEMA" (also "DB.SCHEMA"), case kept: Snowflake folds unquoted names itself. */
export function parseSnowflakeTarget(target?: string | null): { database?: string; schema?: string } {
  const [database, schema] = (target ?? '').split(/[/.]/).map((s) => s.trim()).filter(Boolean)
  return { ...(database ? { database } : {}), ...(schema ? { schema } : {}) }
}

export function isPrivateKey(secret: string | undefined): boolean {
  return !!secret && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(secret)
}

/**
 * PEM with its line breaks restored. A key pasted in a password field loses
 * them (`<input>` strips newlines), and OpenSSL rejects a one-line PEM.
 */
export function normalizePrivateKey(secret: string): string {
  const m = secret.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/)
  if (!m) return secret.trim()
  const body = m[2]!.replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) ?? []
  return [`-----BEGIN ${m[1]}-----`, ...lines, `-----END ${m[1]}-----`].join('\n') + '\n'
}

/**
 * The password field holds either a password / programmatic access token, or a
 * PEM private key — key-pair authentication, which Snowflake requires for
 * service users now that password-only sign-in is being retired.
 */
export function snowflakeOptions(opts: PoolOptions, target?: string | null): ConnectionOptions {
  const { database, schema } = parseSnowflakeTarget(target ?? opts.database)
  const secret = opts.password ?? ''
  return {
    account: snowflakeAccount(opts.host ?? ''),
    ...(opts.username ? { username: opts.username } : {}),
    ...(isPrivateKey(secret)
      ? { authenticator: 'SNOWFLAKE_JWT', privateKey: normalizePrivateKey(secret) }
      : { password: secret }),
    ...(opts.options?.['warehouse'] ? { warehouse: opts.options['warehouse'] } : {}),
    ...(opts.options?.['role'] ? { role: opts.options['role'] } : {}),
    ...(database ? { database } : {}),
    ...(schema ? { schema } : {}),
    application: 'dblumi',
    clientSessionKeepAlive: true,
  }
}

/** Pool of Snowflake sessions, plus one-off sessions for statements that change session state. */
export class SnowflakeClient {
  constructor(
    private readonly sf: SnowflakeModule,
    private readonly options: ConnectionOptions,
    private readonly pool: SnowflakePool,
  ) {}

  use<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    return this.pool.use(fn)
  }

  /** A fresh session, destroyed afterwards: `USE`, `ALTER SESSION`, `BEGIN` never reach the pool. */
  async dedicated<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    const conn = this.sf.createConnection(this.options)
    await conn.connectAsync()
    try {
      return await fn(conn)
    } finally {
      await new Promise<void>((resolve) => conn.destroy(() => resolve()))
    }
  }

  async close(): Promise<void> {
    await this.pool.drain()
    await this.pool.clear()
  }
}

export async function createSnowflakeClient(opts: PoolOptions): Promise<SnowflakeClient> {
  const sf = await loadSnowflake()
  const options = snowflakeOptions(opts)
  const pool = sf.createPool(options, { max: 5, min: 0, idleTimeoutMillis: 60_000, evictionRunIntervalMillis: 30_000 })
  return new SnowflakeClient(sf, options, pool)
}

function columnType(c: { getType(): string; getPrecision(): number; getScale(): number }): string {
  const t = c.getType().toUpperCase()
  if (t === 'FIXED') return `NUMBER(${c.getPrecision()},${c.getScale()})`
  if (t === 'REAL') return 'FLOAT'
  if (t === 'TEXT') return 'VARCHAR'
  return t
}

/**
 * Runs a statement and streams only the requested row range: Snowflake keeps
 * the result server-side, so paging needs no LIMIT rewriting, and the result
 * cache makes the next page free.
 */
export function runSnowflake(conn: Connection, sql: string, limit: number | null, offset: number): Promise<SnowflakeResult> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      streamResult: true,
      rowMode: 'object_with_renamed_duplicated_columns',
      complete: (err: unknown, stmt: RowStatement) => {
        if (err) return reject(err)
        const cols = stmt.getColumns() ?? []
        const columns = cols.map((c) => ({ name: c.getName(), dataType: columnType(c) }))
        const total = stmt.getNumRows()
        const done = (rows: Record<string, unknown>[]) => resolve({
          columns,
          rows,
          rowCount: stmt.getNumUpdatedRows() ?? rows.length,
          durationMs: Date.now() - start,
          total,
        })
        if (cols.length === 0 || total === 0 || offset >= total) return done([])
        const end = (limit === null ? total : Math.min(total, offset + limit)) - 1
        const rows: Record<string, unknown>[] = []
        stmt.streamRows({ start: offset, end })
          .on('data', (row: Record<string, unknown>) => rows.push(row))
          .on('error', reject)
          .on('end', () => done(rows))
      },
    })
  })
}

async function showRows(conn: Connection, sql: string): Promise<Record<string, unknown>[]> {
  const { rows } = await runSnowflake(conn, sql, null, 0)
  return rows
}

/**
 * Identifier TYPED by the user (the connection's database/schema): bare when
 * simple, so that Snowflake folds it to upper case as it would in a query.
 */
export function sfIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

/**
 * Identifier REPORTED by Snowflake (SHOW output, schema browser), in its exact
 * case: a lower-case name was created quoted and must stay quoted.
 */
export function sfExact(name: string): string {
  return /^[A-Z_][A-Z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

/** `SCHEMA.TABLE` from the schema browser, or a bare table of the target schema. */
function tableRef(table: string, database: string, schema: string | undefined): { schemaRef: string; name: string; ref: string } {
  const [schemaRef, name] = table.includes('.')
    ? [sfExact(table.slice(0, table.indexOf('.'))), table.slice(table.indexOf('.') + 1)]
    : [sfIdent(schema ?? 'PUBLIC'), table]
  return { schemaRef: `${sfIdent(database)}.${schemaRef}`, name, ref: `${sfIdent(database)}.${schemaRef}.${sfExact(name)}` }
}

/** Database and schema to browse: the connection target, else the session defaults. */
async function resolveTarget(conn: Connection, target?: string | null): Promise<{ database: string; schema?: string }> {
  const parsed = parseSnowflakeTarget(target)
  if (parsed.database) return { database: parsed.database, ...(parsed.schema ? { schema: parsed.schema } : {}) }
  const [row] = await showRows(conn, 'SELECT CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH')
  const database = row?.['DB'] ? String(row['DB']) : ''
  if (!database) {
    throw new Error('Aucune base Snowflake définie : renseignez le champ Base (ex. ANALYTICS ou ANALYTICS/PUBLIC).')
  }
  return { database, ...(row?.['SCH'] ? { schema: String(row['SCH']) } : {}) }
}

/** SHOW COLUMNS reports types as JSON ({"type":"FIXED","precision":38,"scale":0}). */
export function snowflakeTypeFromJson(json: unknown): string {
  try {
    const t = JSON.parse(String(json)) as { type?: string; precision?: number; scale?: number; length?: number }
    const type = (t.type ?? 'UNKNOWN').toUpperCase()
    if (type === 'FIXED') return `NUMBER(${t.precision ?? 38},${t.scale ?? 0})`
    if (type === 'REAL') return 'FLOAT'
    if (type === 'TEXT') return t.length ? `VARCHAR(${t.length})` : 'VARCHAR'
    return type
  } catch {
    return String(json ?? 'UNKNOWN')
  }
}

type SchemaTable = {
  name: string
  type: 'table' | 'view'
  comment: string
  columns: Array<{ name: string; dataType: string; nullable: boolean; primaryKey: boolean }>
  indexes: never[]
  foreignKeys: Array<{ name: string; fields: string[]; referencedDatabase: string; referencedTable: string; referencedFields: string[]; onDelete: string; onUpdate: string }>
}

/**
 * Schema browser. SHOW commands read metadata without a running warehouse, so
 * browsing never spends credits. With a pinned schema, tables keep a bare
 * name; across a database they are `SCHEMA.TABLE`.
 */
export async function getSnowflakeSchema(client: SnowflakeClient, target?: string | null) {
  return client.use(async (conn) => {
    const { database, schema } = await resolveTarget(conn, target)
    const scope = schema ? `SCHEMA ${sfIdent(database)}.${sfIdent(schema)}` : `DATABASE ${sfIdent(database)}`
    const [cols, views, tablesInfo, pks, fks, fns, procs] = await Promise.all([
      showRows(conn, `SHOW COLUMNS IN ${scope}`),
      showRows(conn, `SHOW VIEWS IN ${scope}`),
      showRows(conn, `SHOW TABLES IN ${scope}`),
      showRows(conn, `SHOW PRIMARY KEYS IN ${scope}`),
      showRows(conn, `SHOW IMPORTED KEYS IN ${scope}`),
      showRows(conn, `SHOW USER FUNCTIONS IN ${scope}`).catch(() => []),
      showRows(conn, `SHOW PROCEDURES IN ${scope}`).catch(() => []),
    ])
    if (cols.length >= SHOW_ROW_CAP) {
      logger.warn({ database, schema }, 'Snowflake SHOW COLUMNS capped at 10 000 rows — pin a schema to browse the rest')
    }
    const name = (sch: unknown, tbl: unknown) => (schema ? String(tbl) : `${String(sch)}.${String(tbl)}`)
    const skip = (sch: unknown) => String(sch).toUpperCase() === 'INFORMATION_SCHEMA'
    const viewNames = new Set(views.map((v) => name(v['schema_name'], v['name'])))
    const comments = new Map(tablesInfo.map((t) => [name(t['schema_name'], t['name']), String(t['comment'] ?? '')]))
    const pkCols = new Set(pks.map((p) => `${name(p['schema_name'], p['table_name'])}\u0000${String(p['column_name'])}`))

    const tables = new Map<string, SchemaTable>()
    for (const c of cols) {
      if (skip(c['schema_name'])) continue
      const key = name(c['schema_name'], c['table_name'])
      let t = tables.get(key)
      if (!t) {
        t = { name: key, type: viewNames.has(key) ? 'view' : 'table', comment: comments.get(key) ?? '', columns: [], indexes: [], foreignKeys: [] }
        tables.set(key, t)
      }
      t.columns.push({
        name: String(c['column_name']),
        dataType: snowflakeTypeFromJson(c['data_type']),
        nullable: String(c['null?']).toLowerCase() !== 'false',
        primaryKey: pkCols.has(`${key}\u0000${String(c['column_name'])}`),
      })
    }
    for (const fk of fks) {
      const t = tables.get(name(fk['fk_schema_name'], fk['fk_table_name']))
      if (!t) continue
      const fkName = String(fk['fk_name'] ?? '')
      let entry = t.foreignKeys.find((f) => f.name === fkName)
      if (!entry) {
        entry = {
          name: fkName, fields: [], referencedDatabase: String(fk['pk_schema_name'] ?? ''),
          referencedTable: name(fk['pk_schema_name'], fk['pk_table_name']), referencedFields: [],
          onDelete: String(fk['delete_rule'] ?? 'NO ACTION'), onUpdate: String(fk['update_rule'] ?? 'NO ACTION'),
        }
        t.foreignKeys.push(entry)
      }
      entry.fields.push(String(fk['fk_column_name']))
      entry.referencedFields.push(String(fk['pk_column_name']))
    }
    // "arguments" reads `MY_FN(NUMBER, VARCHAR) RETURN NUMBER`.
    const routine = (r: Record<string, unknown>, kind: string) => {
      const sig = String(r['arguments'] ?? '')
      const args = sig.match(/\(([^)]*)\)/)?.[1] ?? ''
      const ret = sig.match(/RETURN\s+(.+)$/i)?.[1] ?? ''
      return { name: name(r['schema_name'], r['name']), kind, return_type: ret, arguments: args, language: String(r['language'] ?? 'sql').toLowerCase() }
    }
    const functions = [
      ...fns.filter((f) => String(f['is_builtin'] ?? 'N') !== 'Y' && !skip(f['schema_name'])).map((f) => routine(f, 'function')),
      ...procs.filter((p) => String(p['is_builtin'] ?? 'N') !== 'Y' && !skip(p['schema_name'])).map((p) => routine(p, 'procedure')),
    ]
    return { tables: [...tables.values()], functions }
  })
}

/**
 * Connection test: signs in, then resolves the database and schema so that a
 * typo fails here rather than as an empty schema browser. A warehouse that
 * does not exist is silently ignored by Snowflake: report it too.
 */
export async function pingSnowflake(client: SnowflakeClient, target: string | null | undefined, warehouse?: string): Promise<void> {
  await client.use(async (conn) => {
    const [ctx] = await showRows(conn, 'SELECT CURRENT_VERSION() AS V, CURRENT_WAREHOUSE() AS WH')
    if (warehouse && !ctx?.['WH']) {
      throw new Error(`Warehouse '${warehouse}' introuvable ou inaccessible avec ce rôle.`)
    }
    const { database, schema } = parseSnowflakeTarget(target)
    if (!database) return
    const schemas = await showRows(conn, `SHOW SCHEMAS IN DATABASE ${sfIdent(database)}`)
    if (schema && !schemas.some((r) => String(r['name']).toUpperCase() === schema.toUpperCase())) {
      throw new Error(`Schéma '${schema}' introuvable dans la base '${database}'.`)
    }
  })
}

/** Databases, or `DB/SCHEMA` targets once a database is pinned (re-injectable into switch-database). */
export async function listSnowflakeDatabases(client: SnowflakeClient, target?: string | null): Promise<string[]> {
  return client.use(async (conn) => {
    const { database } = parseSnowflakeTarget(target)
    if (!database) return (await showRows(conn, 'SHOW DATABASES')).map((r) => String(r['name']))
    const schemas = await showRows(conn, `SHOW SCHEMAS IN DATABASE ${sfIdent(database)}`)
    return schemas
      .map((r) => String(r['name']))
      .filter((s) => s.toUpperCase() !== 'INFORMATION_SCHEMA')
      .map((s) => `${database}/${s}`)
  })
}

export async function getSnowflakeStats(client: SnowflakeClient) {
  return client.use(async (conn) => {
    const [v] = await showRows(conn, 'SELECT CURRENT_VERSION() AS V')
    const [tz] = await showRows(conn, "SHOW PARAMETERS LIKE 'TIMEZONE' IN SESSION").catch(() => [])
    return {
      version: v?.['V'] ? `Snowflake ${String(v['V'])}` : null,
      encoding: 'UTF-8',
      timezone: tz?.['value'] ? String(tz['value']) : null,
      sizePretty: null,
      sizeBytes: null,
    }
  })
}

/** Row count from table metadata (no warehouse needed), COUNT(*) for views. */
export async function countSnowflakeTable(client: SnowflakeClient, table: string, target?: string | null): Promise<number> {
  return client.use(async (conn) => {
    const { database, schema } = await resolveTarget(conn, target)
    const { schemaRef, name, ref } = tableRef(table, database, schema)
    // LIKE is case-insensitive and `_` a wildcard here: keep the exact match only.
    const shown = await showRows(conn, `SHOW TABLES LIKE ${snowflakeLiteral(name)} IN SCHEMA ${schemaRef}`)
    const exact = shown.find((r) => String(r['name']) === name)
    if (exact && exact['rows'] !== null && exact['rows'] !== undefined) return Number(exact['rows'])
    const [row] = await showRows(conn, `SELECT COUNT(*) AS N FROM ${ref}`)
    return Number(row?.['N'] ?? 0)
  })
}

/** Snowflake string literal: backslash is an escape character in '…'. */
export function snowflakeLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return `'${v.toISOString()}'`
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

export async function dumpSnowflakeTable(client: SnowflakeClient, table: string, includeData: boolean, target?: string | null): Promise<string> {
  return client.use(async (conn) => {
    const { database, schema } = await resolveTarget(conn, target)
    const { ref } = tableRef(table, database, schema)
    const [ddl] = await showRows(conn, `SELECT GET_DDL('TABLE', ${snowflakeLiteral(ref)}) AS DDL`)
    const parts = [`-- Table: ${ref.replace(/[\r\n]+/g, ' ')}`, String(ddl?.['DDL'] ?? '').trim()]
    if (includeData) {
      const data = await runSnowflake(conn, `SELECT * FROM ${ref}`, DUMP_MAX_ROWS, 0)
      const cols = data.columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(', ')
      for (const row of data.rows) {
        parts.push(`INSERT INTO ${ref} (${cols}) VALUES (${data.columns.map((c) => snowflakeLiteral(row[c.name])).join(', ')});`)
      }
      if ((data.total ?? 0) > DUMP_MAX_ROWS) parts.push(`-- data truncated at ${DUMP_MAX_ROWS} rows`)
    }
    return parts.join('\n')
  })
}

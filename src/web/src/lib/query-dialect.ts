import type { DbDriver, SchemaTable } from '@/api/connections'
import type { FilterRow, QueryColumn } from '@/stores/editor.store'
import { splitSqlStatements } from '@/lib/sql-split'
import { splitMongoStatements } from '@/lib/mongo-split'
import { splitMssqlStatements } from '@/lib/mssql-split'
import { globEscape, likeToGlob, quoteRedisArg, splitRedisCommands } from '@/lib/redis-command'

/**
 * Everything the client writes in the connection's own language: the query of
 * a table tab, grid edits, filters, exports. SQL identifiers are quoted per
 * dialect (a bare `user` is `current_user` in PostgreSQL); MongoDB gets mongosh
 * commands and Redis redis-cli commands, which the API parses without
 * evaluating them. A Redis "table" is a key pattern (`user:*`), its rows keys.
 */

export const isMongo = (driver: DbDriver | undefined): boolean => driver === 'mongodb'
export const isRedis = (driver: DbDriver | undefined): boolean => driver === 'redis'

// ── SQL identifiers & literals ───────────────────

const RESERVED = new Set([
  'all', 'and', 'as', 'asc', 'between', 'by', 'case', 'check', 'column', 'constraint', 'create', 'cross',
  'current_date', 'current_time', 'current_timestamp', 'current_user', 'default', 'delete', 'desc',
  'distinct', 'drop', 'else', 'end', 'exists', 'false', 'fetch', 'for', 'foreign', 'from', 'full', 'grant',
  'group', 'having', 'in', 'index', 'inner', 'insert', 'intersect', 'into', 'is', 'join', 'key', 'left',
  'like', 'limit', 'not', 'null', 'offset', 'on', 'or', 'order', 'outer', 'primary', 'references', 'right',
  'rows', 'select', 'session_user', 'set', 'table', 'then', 'to', 'true', 'union', 'unique', 'update',
  'user', 'using', 'values', 'when', 'where', 'with',
])

function isPlainIdent(driver: DbDriver | undefined, name: string): boolean {
  if (RESERVED.has(name.toLowerCase())) return false
  // Oracle and Snowflake fold unquoted names to upper case, the others to lower
  // case (MySQL keeps them; SQL Server compares them per the collation).
  if (driver === 'oracle') return /^[A-Z][A-Z0-9_$#]*$/.test(name)
  if (driver === 'snowflake') return /^[A-Z_][A-Z0-9_$]*$/.test(name)
  if (driver === 'mysql') return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)
  if (driver === 'mssql') return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
  return /^[a-z_][a-z0-9_$]*$/.test(name)
}

/** Identifier, quoted only when it has to be (mixed case, spaces, reserved word). */
export function quoteIdent(driver: DbDriver | undefined, name: string): string {
  if (isPlainIdent(driver, name)) return name
  if (driver === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  if (driver === 'mssql') return '[' + name.replace(/]/g, ']]') + ']'
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Table reference. Trino, SQL Server and Snowflake list tables outside the
 * default schema as `schema.table`: quote each part.
 */
export function tableRef(driver: DbDriver | undefined, table: string): string {
  if ((driver === 'trino' || driver === 'mssql' || driver === 'snowflake') && table.includes('.')) {
    return table.split('.').map((p) => quoteIdent(driver, p)).join('.')
  }
  return quoteIdent(driver, table)
}

/**
 * String literal. MySQL and Snowflake also treat a backslash as an escape
 * character; SQL Server needs the N prefix to keep non-Latin text.
 */
export function sqlString(driver: DbDriver | undefined, value: string): string {
  const escaped = driver === 'mysql' || driver === 'snowflake' ? value.replace(/\\/g, '\\\\') : value
  return `${driver === 'mssql' ? 'N' : ''}'${escaped.replace(/'/g, "''")}'`
}

function sqlLiteral(driver: DbDriver | undefined, value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'object') return sqlString(driver, JSON.stringify(value))
  return sqlString(driver, String(value))
}

// ── MongoDB references & literals ────────────────

/** Names that are methods of `db` in mongosh: `db.stats.find()` would not reach a collection. */
const DB_METHODS = new Set([
  'getCollection', 'getCollectionNames', 'getCollectionInfos', 'getSiblingDB', 'runCommand', 'adminCommand',
  'stats', 'version', 'getName', 'createCollection', 'createView', 'dropDatabase', 'aggregate', 'getUsers',
  'getRoles', 'currentOp', 'serverStatus', 'listCollections',
])

export function collectionRef(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !DB_METHODS.has(name)
    ? `db.${name}`
    : `db.getCollection(${JSON.stringify(name)})`
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/

/**
 * mongosh literal for a value typed in the grid (always a string) given the
 * column's BSON type. Object/array cells hold Extended JSON text, which the API
 * parser turns back into the same BSON types.
 */
export function mongoLiteral(raw: string | null, dataType: string): string {
  if (raw === null) return 'null'
  const text = raw.trim()
  switch (dataType) {
    case 'objectId':
      return OBJECT_ID.test(text) ? `ObjectId(${JSON.stringify(text)})` : JSON.stringify(raw)
    case 'int':
    case 'double':
      return text !== '' && Number.isFinite(Number(text)) ? String(Number(text)) : JSON.stringify(raw)
    case 'long':
      return /^-?\d+$/.test(text) ? `NumberLong(${JSON.stringify(text)})` : JSON.stringify(raw)
    case 'decimal':
      return text !== '' && !Number.isNaN(Number(text)) ? `NumberDecimal(${JSON.stringify(text)})` : JSON.stringify(raw)
    case 'bool':
      return text === 'true' || text === '1' ? 'true' : text === 'false' || text === '0' ? 'false' : JSON.stringify(raw)
    case 'date':
      return text && !Number.isNaN(new Date(text).getTime()) ? `ISODate(${JSON.stringify(new Date(text).toISOString())})` : JSON.stringify(raw)
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? `UUID(${JSON.stringify(text)})` : JSON.stringify(raw)
    case 'object':
    case 'array':
      try {
        JSON.parse(text)
        return text
      } catch {
        return JSON.stringify(raw)
      }
    default:
      return JSON.stringify(raw)
  }
}

/** Literal of a value as it came back from the API (for `_id` lookups). */
function mongoValueLiteral(value: unknown, dataType: string): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'object') return JSON.stringify(value) // Extended JSON — parsed back by the API
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const s = String(value)
  if (dataType === 'objectId' || (dataType === 'mixed' && OBJECT_ID.test(s))) return `ObjectId(${JSON.stringify(s)})`
  if (dataType === 'uuid') return `UUID(${JSON.stringify(s)})`
  if (dataType === 'date') return `ISODate(${JSON.stringify(s)})`
  return JSON.stringify(s)
}

// ── Statements ───────────────────────────────────

/** SCAN of a key pattern, with an optional TYPE filter. The API walks the cursor to fill a page. */
function redisScan(pattern: string, type?: string): string {
  return `SCAN 0 MATCH ${quoteRedisArg(pattern)}${type ? ` TYPE ${quoteRedisArg(type)}` : ''} COUNT 1000`
}

/** The query a table tab runs. */
export function tableQuery(driver: DbDriver | undefined, table: string): string {
  if (isMongo(driver)) return `${collectionRef(table)}.find({})`
  if (isRedis(driver)) return redisScan(table)
  return `SELECT * FROM ${tableRef(driver, table)}`
}

/** A quick preview query, for the schema sidebar. */
export function previewQuery(driver: DbDriver | undefined, table: string): string {
  if (isMongo(driver)) return `${collectionRef(table)}.find({}).limit(100)`
  if (isRedis(driver)) return redisScan(table)
  if (driver === 'oracle') return `SELECT * FROM ${tableRef(driver, table)} FETCH FIRST 100 ROWS ONLY`
  if (driver === 'mssql') return `SELECT TOP 100 * FROM ${tableRef(driver, table)};`
  return `SELECT * FROM ${tableRef(driver, table)} LIMIT 100;`
}

/** "List the tables" of a connection, in its own language. */
export function listTablesQuery(driver: DbDriver | undefined): string {
  switch (driver) {
    case 'mongodb': return 'db.getCollectionInfos()'
    case 'redis': return 'SCAN 0 COUNT 1000'
    case 'mysql': return 'SELECT * FROM information_schema.tables WHERE table_schema = DATABASE() LIMIT 50;'
    case 'mssql': return 'SELECT TOP 50 * FROM INFORMATION_SCHEMA.TABLES;'
    case 'oracle': return 'SELECT table_name FROM user_tables FETCH FIRST 50 ROWS ONLY'
    case 'sqlite': return "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') LIMIT 50;"
    case 'trino':
    case 'snowflake': return 'SHOW TABLES;'
    default: return "SELECT * FROM information_schema.tables WHERE table_schema = 'public' LIMIT 50;"
  }
}

export function splitStatementsFor(driver: DbDriver | undefined, text: string): string[] {
  if (isMongo(driver)) return splitMongoStatements(text)
  if (isRedis(driver)) return splitRedisCommands(text)
  if (driver === 'mssql') return splitMssqlStatements(text)
  return splitSqlStatements(text)
}

/** Statement dropping a table / view / routine from the schema sidebar (never offered on Redis). */
export function dropStatement(driver: DbDriver | undefined, kind: 'table' | 'view' | 'function' | 'procedure', name: string): string {
  if (isMongo(driver)) return `${collectionRef(name)}.drop()`
  if (isRedis(driver)) throw new Error('A Redis key pattern cannot be dropped as a whole.')
  const keyword = { table: 'TABLE', view: 'VIEW', function: 'FUNCTION', procedure: 'PROCEDURE' }[kind]
  return `DROP ${keyword} ${tableRef(driver, name)}`
}

/** EXPLAIN toggle of the results bar: is `sql` an explain, and what to run to switch. */
export function explainToggle(driver: DbDriver | undefined, sql: string): { explaining: boolean; next: string } {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (isMongo(driver)) {
    const m = trimmed.match(/\.explain\(\s*(?:"[^"]*"|'[^']*')?\s*\)$/)
    return m ? { explaining: true, next: trimmed.slice(0, m.index) } : { explaining: false, next: `${trimmed}.explain()` }
  }
  if (/^EXPLAIN\s/i.test(trimmed)) return { explaining: true, next: trimmed.replace(/^EXPLAIN\s+(?:PLAN\s+FOR\s+)?/i, '') }
  return { explaining: false, next: driver === 'oracle' ? `EXPLAIN PLAN FOR ${trimmed}` : `EXPLAIN ${trimmed}` }
}

// ── Grid edits ───────────────────────────────────

/**
 * Columns identifying a row. MongoDB: `_id`. SQL: the primary key declared in
 * the schema (composite keys included), else a column named `id`. Never "the
 * first column": on `order_items(order_id, …)` that edited every line of the order.
 */
export function keyColumns(
  driver: DbDriver | undefined,
  table: string,
  columns: QueryColumn[],
  schema: SchemaTable[] | undefined,
): QueryColumn[] | null {
  if (isMongo(driver) || isRedis(driver)) {
    const id = columns.find((c) => c.name === (isMongo(driver) ? '_id' : 'key'))
    return id ? [id] : null
  }
  const declared = schema?.find((t) => t.name === table)?.columns.filter((c) => c.primaryKey).map((c) => c.name) ?? []
  const fromSchema = declared.map((name) => columns.find((c) => c.name === name))
  if (declared.length > 0 && fromSchema.every(Boolean)) return fromSchema as QueryColumn[]
  const id = columns.find((c) => c.name.toLowerCase() === 'id')
  return id ? [id] : null
}

function sqlKeyPredicate(driver: DbDriver | undefined, keys: QueryColumn[], row: Record<string, unknown>): string {
  return keys
    .map((k) => {
      const v = row[k.name]
      return v === null || v === undefined ? `${quoteIdent(driver, k.name)} IS NULL` : `${quoteIdent(driver, k.name)} = ${sqlLiteral(driver, v)}`
    })
    .join(' AND ')
}

/**
 * Can this grid cell be written back? Redis rows describe keys: the key can be
 * renamed, the TTL changed, and the value of a string key set; the type and
 * size are computed, and SET on a hash or list key would replace it.
 */
export function isCellEditable(driver: DbDriver | undefined, row: Record<string, unknown>, column: string): boolean {
  if (!isRedis(driver)) return true
  return column === 'key' || column === 'ttl' || (column === 'value' && row['type'] === 'string')
}

/** Redis write of one key cell (see isCellEditable). */
function redisCellCommand(row: Record<string, unknown>, column: string, value: string | null): string {
  const key = quoteRedisArg(String(row['key'] ?? ''))
  if (column === 'key') return `RENAMENX ${key} ${quoteRedisArg(value ?? '')}`
  if (column === 'ttl') {
    const ttl = Number(value)
    // An empty or negative TTL removes the expiry.
    return value === null || !Number.isFinite(ttl) || ttl < 0 ? `PERSIST ${key}` : `EXPIRE ${key} ${Math.floor(ttl)}`
  }
  return `SET ${key} ${quoteRedisArg(value ?? '')} KEEPTTL`
}

/** Sets one cell (`null` = NULL). */
export function updateCellStatement(
  driver: DbDriver | undefined,
  table: string,
  keys: QueryColumn[],
  row: Record<string, unknown>,
  column: QueryColumn,
  value: string | null,
): string {
  if (isRedis(driver)) return redisCellCommand(row, column.name, value)
  if (isMongo(driver)) {
    const id = keys[0]!
    return `${collectionRef(table)}.updateOne({ _id: ${mongoValueLiteral(row[id.name], id.dataType)} }, { $set: { ${JSON.stringify(column.name)}: ${mongoLiteral(value, column.dataType)} } })`
  }
  const lit = value === null ? 'NULL' : sqlString(driver, value)
  return `UPDATE ${tableRef(driver, table)} SET ${quoteIdent(driver, column.name)} = ${lit} WHERE ${sqlKeyPredicate(driver, keys, row)}`
}

/**
 * Statements setting several cells of one row: a single UPDATE, except on Redis
 * where each field is its own command.
 */
export function updateRowStatements(
  driver: DbDriver | undefined,
  table: string,
  keys: QueryColumn[],
  row: Record<string, unknown>,
  changes: Array<{ column: QueryColumn; value: string | null }>,
): string[] {
  if (isRedis(driver)) {
    return changes
      .filter((c) => isCellEditable(driver, row, c.column.name))
      .map((c) => redisCellCommand(row, c.column.name, c.value))
  }
  return [updateRowStatement(driver, table, keys, row, changes)]
}

/** Sets several cells of one row. */
function updateRowStatement(
  driver: DbDriver | undefined,
  table: string,
  keys: QueryColumn[],
  row: Record<string, unknown>,
  changes: Array<{ column: QueryColumn; value: string | null }>,
): string {
  if (isMongo(driver)) {
    const id = keys[0]!
    const set = changes.map((c) => `${JSON.stringify(c.column.name)}: ${mongoLiteral(c.value, c.column.dataType)}`).join(', ')
    return `${collectionRef(table)}.updateOne({ _id: ${mongoValueLiteral(row[id.name], id.dataType)} }, { $set: { ${set} } })`
  }
  const sets = changes
    .map((c) => `${quoteIdent(driver, c.column.name)} = ${c.value === null ? 'NULL' : sqlString(driver, c.value)}`)
    .join(', ')
  return `UPDATE ${tableRef(driver, table)} SET ${sets} WHERE ${sqlKeyPredicate(driver, keys, row)}`
}

export function deleteRowsStatement(
  driver: DbDriver | undefined,
  table: string,
  keys: QueryColumn[],
  rows: Record<string, unknown>[],
): string {
  if (isMongo(driver)) {
    const id = keys[0]!
    const ids = rows.map((r) => mongoValueLiteral(r[id.name], id.dataType)).join(', ')
    return `${collectionRef(table)}.deleteMany({ _id: { $in: [${ids}] } })`
  }
  if (isRedis(driver)) return `DEL ${rows.map((r) => quoteRedisArg(String(r['key'] ?? ''))).join(' ')}`
  if (keys.length === 1) {
    const k = keys[0]!
    if (rows.every((r) => r[k.name] !== null && r[k.name] !== undefined)) {
      return `DELETE FROM ${tableRef(driver, table)} WHERE ${quoteIdent(driver, k.name)} IN (${rows.map((r) => sqlLiteral(driver, r[k.name])).join(', ')})`
    }
  }
  return `DELETE FROM ${tableRef(driver, table)} WHERE ${rows.map((r) => `(${sqlKeyPredicate(driver, keys, r)})`).join(' OR ')}`
}

/** Inserts one row; `'NULL'` typed in a SQL field stays the NULL keyword. */
export function insertRowStatement(
  driver: DbDriver | undefined,
  table: string,
  values: Array<{ column: QueryColumn; value: string }>,
): string {
  if (isMongo(driver)) {
    const fields = values.map((v) => `${JSON.stringify(v.column.name)}: ${mongoLiteral(v.value === 'NULL' ? null : v.value, v.column.dataType)}`)
    return `${collectionRef(table)}.insertOne({ ${fields.join(', ')} })`
  }
  if (isRedis(driver)) {
    // A new row is a string key; NX never overwrites an existing key.
    const field = (name: string) => values.find((v) => v.column.name === name)?.value
    const ttl = Number(field('ttl'))
    const expiry = Number.isInteger(ttl) && ttl > 0 ? ` EX ${ttl}` : ''
    return `SET ${quoteRedisArg(field('key') ?? '')} ${quoteRedisArg(field('value') ?? '')} NX${expiry}`
  }
  const cols = values.map((v) => quoteIdent(driver, v.column.name)).join(', ')
  const vals = values.map((v) => (v.value === 'NULL' ? 'NULL' : sqlString(driver, v.value))).join(', ')
  return `INSERT INTO ${tableRef(driver, table)} (${cols}) VALUES (${vals})`
}

/** Query of a table tab with the grid filters applied. */
export function filteredTableQuery(
  driver: DbDriver | undefined,
  table: string,
  filters: FilterRow[],
  columns: QueryColumn[],
): string {
  const valid = filters.filter((f) => f.column && f.operator)
  if (isMongo(driver)) {
    if (valid.length === 0) return tableQuery(driver, table)
    const clauses = valid.map((f) => {
      const type = columns.find((c) => c.name === f.column)?.dataType ?? 'string'
      const field = JSON.stringify(f.column)
      switch (f.operator) {
        case 'IS NULL': return `${field}: null`
        case 'IS NOT NULL': return `${field}: { $ne: null }`
        case 'LIKE':
        case 'ILIKE': return `${field}: { $regex: ${JSON.stringify(likeToRegex(f.value))}${f.operator === 'ILIKE' ? ', $options: "i"' : ''} }`
        case '!=': return `${field}: { $ne: ${mongoLiteral(f.value, type)} }`
        case '>': return `${field}: { $gt: ${mongoLiteral(f.value, type)} }`
        case '<': return `${field}: { $lt: ${mongoLiteral(f.value, type)} }`
        case '>=': return `${field}: { $gte: ${mongoLiteral(f.value, type)} }`
        case '<=': return `${field}: { $lte: ${mongoLiteral(f.value, type)} }`
        default: return `${field}: ${mongoLiteral(f.value, type)}`
      }
    })
    // One clause per filter inside $and: two filters on the same field must not overwrite each other.
    return `${collectionRef(table)}.find({ $and: [${clauses.map((c) => `{ ${c} }`).join(', ')}] })`
  }
  if (isRedis(driver)) return redisFilteredScan(table, valid)
  let sql = tableQuery(driver, table)
  if (valid.length > 0) {
    const clauses = valid.map((f) => {
      const col = quoteIdent(driver, f.column)
      if (f.operator === 'IS NULL') return `${col} IS NULL`
      if (f.operator === 'IS NOT NULL') return `${col} IS NOT NULL`
      return `${col} ${f.operator} ${sqlString(driver, f.value)}`
    })
    sql += ` WHERE ${clauses.join(' AND ')}`
  }
  return sql
}

/**
 * SCAN can only filter on the key (MATCH) and the type (TYPE): a key filter
 * narrows the tab's pattern (`user:*` + LIKE `%42%` → `user:*42*`); filters on
 * other columns cannot be expressed and are left out.
 */
function redisFilteredScan(pattern: string, filters: FilterRow[]): string {
  const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : ''
  let match = pattern
  let type: string | undefined
  for (const f of filters) {
    if (f.column === 'type' && f.operator === '=') type = f.value
    if (f.column !== 'key') continue
    const glob = f.operator === '=' ? globEscape(f.value) : f.operator === 'LIKE' || f.operator === 'ILIKE' ? likeToGlob(f.value) : null
    if (glob === null) continue
    match = glob.startsWith(prefix) ? glob : `${prefix}${glob}`
  }
  return redisScan(match, type)
}

/** SQL LIKE pattern → anchored regular expression. */
function likeToRegex(pattern: string): string {
  let out = '^'
  for (const ch of pattern) {
    if (ch === '%') out += '.*'
    else if (ch === '_') out += '.'
    else out += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return `${out}$`
}

/** "Copy / export as SQL" of the grid: INSERT statements, or an insertMany on MongoDB. */
export function exportAsStatements(
  driver: DbDriver | undefined,
  table: string,
  rows: Record<string, unknown>[],
  columns: QueryColumn[],
): string {
  if (isMongo(driver)) {
    const docs = rows.map((r) => {
      const fields = columns
        .filter((c) => r[c.name] !== undefined)
        .map((c) => `${JSON.stringify(c.name)}: ${mongoValueLiteral(r[c.name], c.dataType)}`)
      return `  { ${fields.join(', ')} }`
    })
    return `${collectionRef(table)}.insertMany([\n${docs.join(',\n')}\n])`
  }
  if (isRedis(driver)) {
    // Key rows: only string values are in the grid; other types are exported by the dump.
    return rows
      .map((r) => {
        const key = quoteRedisArg(String(r['key'] ?? ''))
        if (r['type'] !== undefined && r['type'] !== 'string') return `# ${key}: ${String(r['type'])} (use Export → dump)`
        const ttl = Number(r['ttl'])
        return `SET ${key} ${quoteRedisArg(String(r['value'] ?? ''))}${ttl > 0 ? ` EX ${ttl}` : ''}`
      })
      .join('\n')
  }
  const cols = columns.map((c) => quoteIdent(driver, c.name)).join(', ')
  return rows
    .map((r) => `INSERT INTO ${tableRef(driver, table)} (${cols}) VALUES (${columns.map((c) => sqlLiteral(driver, r[c.name])).join(', ')});`)
    .join('\n')
}

/** Type used to pick the grid editor widget: a BSON date carries a time. */
export function editorDataType(driver: DbDriver | undefined, dataType: string): string {
  if (isMongo(driver) && dataType === 'date') return 'timestamp'
  return dataType
}

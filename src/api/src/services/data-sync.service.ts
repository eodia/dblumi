import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import { logger } from '../logger.js'

type DbDriver = 'postgresql' | 'mysql' | 'oracle'
type AnyPool = PgPool | MySQLPool | OraclePool

export type SyncProgress = {
  phase: 'schema' | 'create' | 'insert' | 'table-done' | 'done' | 'error'
  table: string
  tableIndex: number
  totalTables: number
  rowsInserted: number
  totalRows: number
  error?: string
}

// ── Cross-driver type normalisation ──────────

const GENERIC_MAP: Record<string, string> = {
  // PostgreSQL
  'integer': 'integer', 'int': 'integer', 'int4': 'integer', 'serial': 'integer',
  'smallint': 'integer', 'int2': 'integer', 'smallserial': 'integer',
  'bigint': 'bigint', 'int8': 'bigint', 'bigserial': 'bigint',
  'numeric': 'decimal', 'decimal': 'decimal', 'money': 'decimal',
  'real': 'float', 'float4': 'float', 'float': 'float',
  'double precision': 'float', 'float8': 'float', 'double': 'float', 'binary_double': 'float',
  'boolean': 'boolean', 'bool': 'boolean', 'tinyint': 'boolean',
  'date': 'date',
  'timestamp': 'timestamp', 'timestamptz': 'timestamp', 'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamp', 'datetime': 'timestamp',
  'text': 'text', 'clob': 'text', 'mediumtext': 'text', 'longtext': 'text', 'tinytext': 'text',
  'character varying': 'varchar', 'varchar': 'varchar', 'varchar2': 'varchar',
  'char': 'varchar', 'character': 'varchar', 'nchar': 'varchar', 'nvarchar': 'varchar', 'nvarchar2': 'varchar',
  'json': 'text', 'jsonb': 'text', 'xml': 'text', 'uuid': 'varchar',
  'bytea': 'text', 'blob': 'text', 'raw': 'text', 'longblob': 'text', 'mediumblob': 'text',
  'enum': 'varchar', 'set': 'varchar',
}

function normalizeType(nativeType: string): string {
  const lower = nativeType.toLowerCase().replace(/\(.*\)/, '').trim()
  if (GENERIC_MAP[lower]) return GENERIC_MAP[lower]!
  // Oracle NUMBER with precision
  if (lower === 'number') return 'decimal'
  return 'text'
}

// ── Type mapping per target driver ───────────

const TYPE_MAP: Record<DbDriver, Record<string, string>> = {
  postgresql: {
    text: 'TEXT', varchar: 'VARCHAR(255)', integer: 'INTEGER', bigint: 'BIGINT',
    decimal: 'NUMERIC(18,6)', boolean: 'BOOLEAN', date: 'DATE', timestamp: 'TIMESTAMP', float: 'DOUBLE PRECISION',
  },
  mysql: {
    text: 'TEXT', varchar: 'VARCHAR(255)', integer: 'INT', bigint: 'BIGINT',
    decimal: 'DECIMAL(18,6)', boolean: 'TINYINT(1)', date: 'DATE', timestamp: 'DATETIME', float: 'DOUBLE',
  },
  oracle: {
    text: 'CLOB', varchar: 'VARCHAR2(255)', integer: 'NUMBER(10)', bigint: 'NUMBER(19)',
    decimal: 'NUMBER(18,6)', boolean: 'NUMBER(1)', date: 'DATE', timestamp: 'TIMESTAMP', float: 'BINARY_DOUBLE',
  },
}

function quoteId(name: string, driver: DbDriver): string {
  if (driver === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  const escaped = name.replace(/"/g, '""')
  return `"${driver === 'oracle' ? escaped.toUpperCase() : escaped}"`
}

function resolveType(generic: string, driver: DbDriver): string {
  return TYPE_MAP[driver][generic] ?? TYPE_MAP[driver]['text']!
}

// ── Schema reading ───────────────────────────

type ColumnInfo = { name: string; dataType: string; genericType: string }

async function readColumns(pool: AnyPool, driver: DbDriver, table: string): Promise<ColumnInfo[]> {
  if (driver === 'postgresql') {
    const client = await (pool as PgPool).connect()
    try {
      const res = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
        [table],
      )
      return res.rows.map((r: Record<string, string>) => ({
        name: r.column_name!, dataType: r.data_type!, genericType: normalizeType(r.data_type!),
      }))
    } finally { client.release() }
  } else if (driver === 'mysql') {
    const conn = await (pool as MySQLPool).getConnection()
    try {
      const [rows] = await conn.query(
        `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() ORDER BY ORDINAL_POSITION`,
        [table],
      )
      return (rows as Record<string, string>[]).map((r) => ({
        name: r['COLUMN_NAME']!, dataType: r['DATA_TYPE']!, genericType: normalizeType(r['DATA_TYPE']!),
      }))
    } finally { conn.release() }
  } else {
    const conn = await (pool as OraclePool).getConnection()
    try {
      const res = await conn.execute(
        `SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :t ORDER BY COLUMN_ID`,
        [table.toUpperCase()], { outFormat: 4002 },
      )
      return ((res.rows ?? []) as Record<string, string>[]).map((r) => ({
        name: r.COLUMN_NAME!, dataType: r.DATA_TYPE!, genericType: normalizeType(r.DATA_TYPE!),
      }))
    } finally { await conn.close() }
  }
}

// ── Data reading ─────────────────────────────

async function readAllRows(pool: AnyPool, driver: DbDriver, table: string): Promise<Record<string, unknown>[]> {
  if (driver === 'postgresql') {
    const client = await (pool as PgPool).connect()
    try {
      const res = await client.query(`SELECT * FROM "${table}"`)
      return res.rows as Record<string, unknown>[]
    } finally { client.release() }
  } else if (driver === 'mysql') {
    const conn = await (pool as MySQLPool).getConnection()
    try {
      const [rows] = await conn.query(`SELECT * FROM \`${table}\``)
      return rows as Record<string, unknown>[]
    } finally { conn.release() }
  } else {
    const conn = await (pool as OraclePool).getConnection()
    try {
      const res = await conn.execute(`SELECT * FROM "${table.toUpperCase()}"`, [], { outFormat: 4002 })
      return (res.rows ?? []) as Record<string, unknown>[]
    } finally { await conn.close() }
  }
}

// ── Write to target ──────────────────────────

function escapeValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return `'${v.toISOString()}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

const BATCH_SIZE = 200

async function insertRows(
  pool: AnyPool, driver: DbDriver, table: string,
  columns: ColumnInfo[], rows: Record<string, unknown>[],
  onBatch: (inserted: number) => Promise<void>,
): Promise<void> {
  const colNames = columns.map((c) => quoteId(c.name, driver)).join(', ')
  const srcColNames = columns.map((c) => c.name)

  if (driver === 'postgresql') {
    const client = await (pool as PgPool).connect()
    try {
      await client.query('BEGIN')
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)
        const values: unknown[] = []
        const placeholders: string[] = []
        for (let r = 0; r < batch.length; r++) {
          const row = batch[r]!
          const ph: string[] = []
          for (let c = 0; c < srcColNames.length; c++) {
            values.push(row[srcColNames[c]!] ?? null)
            ph.push(`$${r * srcColNames.length + c + 1}`)
          }
          placeholders.push(`(${ph.join(', ')})`)
        }
        await client.query(`INSERT INTO ${quoteId(table, driver)} (${colNames}) VALUES ${placeholders.join(', ')}`, values)
        await onBatch(Math.min(i + BATCH_SIZE, rows.length))
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally { client.release() }
  } else if (driver === 'mysql') {
    const conn = await (pool as MySQLPool).getConnection()
    try {
      await conn.beginTransaction()
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)
        const values: unknown[] = []
        const placeholders: string[] = []
        for (const row of batch) {
          placeholders.push(`(${srcColNames.map(() => '?').join(', ')})`)
          for (const col of srcColNames) values.push(row[col] ?? null)
        }
        await conn.query(`INSERT INTO ${quoteId(table, driver)} (${colNames}) VALUES ${placeholders.join(', ')}`, values)
        await onBatch(Math.min(i + BATCH_SIZE, rows.length))
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback().catch(() => {})
      throw err
    } finally { conn.release() }
  } else {
    const conn = await (pool as OraclePool).getConnection()
    try {
      const bindNames = srcColNames.map((_, i) => `:${i + 1}`).join(', ')
      const sql = `INSERT INTO ${quoteId(table, driver)} (${colNames}) VALUES (${bindNames})`
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)
        await conn.executeMany(sql, batch.map((row) => srcColNames.map((col) => row[col] ?? null)))
        await onBatch(Math.min(i + BATCH_SIZE, rows.length))
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback().catch(() => {})
      throw err
    } finally { await conn.close() }
  }
}

async function createTable(pool: AnyPool, driver: DbDriver, table: string, columns: ColumnInfo[]): Promise<void> {
  const colDefs = columns.map((c) => `${quoteId(c.name, driver)} ${resolveType(c.genericType, driver)}`).join(', ')
  const dropSql = driver === 'oracle'
    ? `DROP TABLE ${quoteId(table, driver)}`
    : `DROP TABLE IF EXISTS ${quoteId(table, driver)}`
  const createSql = `CREATE TABLE ${quoteId(table, driver)} (${colDefs})`

  if (driver === 'postgresql') {
    const client = await (pool as PgPool).connect()
    try {
      try { await client.query(dropSql) } catch { /* may not exist */ }
      await client.query(createSql)
    } finally { client.release() }
  } else if (driver === 'mysql') {
    const conn = await (pool as MySQLPool).getConnection()
    try {
      await conn.query(dropSql)
      await conn.query(createSql)
    } finally { conn.release() }
  } else {
    const conn = await (pool as OraclePool).getConnection()
    try {
      try { await conn.execute(dropSql) } catch { /* may not exist */ }
      await conn.execute(createSql)
    } finally { await conn.close() }
  }
}

// ── Index & FK reading ───────────────────────

type IndexInfo = { name: string; columns: string[]; unique: boolean }
type FkInfo = { name: string; columns: string[]; refTable: string; refColumns: string[]; onDelete: string; onUpdate: string }

/** Ensure a value that may be a string, an array, or null becomes a string[] */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

async function readIndexes(pool: AnyPool, driver: DbDriver, table: string): Promise<IndexInfo[]> {
  if (driver === 'postgresql') {
    const client = await (pool as PgPool).connect()
    try {
      const res = await client.query(
        `SELECT i.relname AS index_name, ix.indisunique AS is_unique,
                array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
         FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         WHERE t.relname = $1 AND NOT ix.indisprimary
         GROUP BY i.relname, ix.indisunique`, [table])
      return res.rows.map((r: Record<string, unknown>) => ({
        name: r.index_name as string, columns: toStringArray(r.columns), unique: !!r.is_unique,
      }))
    } finally { client.release() }
  } else if (driver === 'mysql') {
    const conn = await (pool as MySQLPool).getConnection()
    try {
      const [rows] = await conn.query(
        `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, NOT NON_UNIQUE AS is_unique
         FROM information_schema.STATISTICS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() AND INDEX_NAME != 'PRIMARY'
         GROUP BY INDEX_NAME, NON_UNIQUE`, [table])
      return (rows as Record<string, unknown>[]).map((r) => ({
        name: r['INDEX_NAME'] as string, columns: toStringArray(r['cols']), unique: !!(r['is_unique'] as number),
      }))
    } finally { conn.release() }
  }
  return [] // Oracle: skip for MVP
}

async function readForeignKeys(pool: AnyPool, driver: DbDriver, table: string): Promise<FkInfo[]> {
  if (driver === 'postgresql') {
    const client = await (pool as PgPool).connect()
    try {
      const res = await client.query(
        `SELECT tc.constraint_name, array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
                ccu.table_name AS ref_table, array_agg(ccu.column_name ORDER BY kcu.ordinal_position) AS ref_columns,
                rc.delete_rule, rc.update_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
         WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
         GROUP BY tc.constraint_name, ccu.table_name, rc.delete_rule, rc.update_rule`, [table])
      return res.rows.map((r: Record<string, unknown>) => ({
        name: r.constraint_name as string, columns: toStringArray(r.columns),
        refTable: r.ref_table as string, refColumns: toStringArray(r.ref_columns),
        onDelete: r.delete_rule as string, onUpdate: r.update_rule as string,
      }))
    } finally { client.release() }
  } else if (driver === 'mysql') {
    const conn = await (pool as MySQLPool).getConnection()
    try {
      const [rows] = await conn.query(
        `SELECT CONSTRAINT_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols,
                REFERENCED_TABLE_NAME AS ref_table, GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS ref_cols
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
         GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME`, [table])
      return (rows as Record<string, unknown>[]).map((r) => ({
        name: r['CONSTRAINT_NAME'] as string, columns: toStringArray(r['cols']),
        refTable: r['ref_table'] as string, refColumns: toStringArray(r['ref_cols']),
        onDelete: 'NO ACTION', onUpdate: 'NO ACTION',
      }))
    } finally { conn.release() }
  }
  return [] // Oracle: skip for MVP
}

async function createConstraints(
  pool: AnyPool, driver: DbDriver, table: string,
  indexes: IndexInfo[], foreignKeys: FkInfo[],
): Promise<void> {
  const stmts: string[] = []
  for (const idx of indexes) {
    const cols = idx.columns.map((c) => quoteId(c, driver)).join(', ')
    const unique = idx.unique ? 'UNIQUE ' : ''
    stmts.push(`CREATE ${unique}INDEX ${quoteId(idx.name, driver)} ON ${quoteId(table, driver)} (${cols})`)
  }
  for (const fk of foreignKeys) {
    const cols = fk.columns.map((c) => quoteId(c, driver)).join(', ')
    const refCols = fk.refColumns.map((c) => quoteId(c, driver)).join(', ')
    stmts.push(`ALTER TABLE ${quoteId(table, driver)} ADD CONSTRAINT ${quoteId(fk.name, driver)} FOREIGN KEY (${cols}) REFERENCES ${quoteId(fk.refTable, driver)} (${refCols})`)
  }
  if (stmts.length === 0) return

  if (driver === 'postgresql') {
    const client = await (pool as PgPool).connect()
    try { for (const s of stmts) await client.query(s) } finally { client.release() }
  } else if (driver === 'mysql') {
    const conn = await (pool as MySQLPool).getConnection()
    try { for (const s of stmts) await conn.query(s) } finally { conn.release() }
  } else {
    const conn = await (pool as OraclePool).getConnection()
    try { for (const s of stmts) await conn.execute(s) } finally { await conn.close() }
  }
}

// ── Public API ───────────────────────────────

export type TableMapping = { source: string; target: string }

export type SyncOptions = {
  includeConstraints: boolean
  includeData: boolean
}

export async function executeSync(
  sourcePool: AnyPool,
  sourceDriver: DbDriver,
  targetPool: AnyPool,
  targetDriver: DbDriver,
  tableMapping: TableMapping[],
  options: SyncOptions,
  onProgress: (p: SyncProgress) => Promise<void>,
): Promise<void> {
  logger.info({ tables: tableMapping.length, sourceDriver, targetDriver, options }, 'Starting data sync')

  for (let i = 0; i < tableMapping.length; i++) {
    const { source, target } = tableMapping[i]!
    const label = source === target ? source : `${source} → ${target}`
    try {
      await onProgress({ phase: 'schema', table: label, tableIndex: i, totalTables: tableMapping.length, rowsInserted: 0, totalRows: 0 })

      const columns = await readColumns(sourcePool, sourceDriver, source)
      const rows = options.includeData ? await readAllRows(sourcePool, sourceDriver, source) : []

      await onProgress({ phase: 'create', table: label, tableIndex: i, totalTables: tableMapping.length, rowsInserted: 0, totalRows: rows.length })
      await createTable(targetPool, targetDriver, target, columns)

      if (rows.length > 0) {
        await insertRows(targetPool, targetDriver, target, columns, rows, async (inserted) => {
          await onProgress({ phase: 'insert', table: label, tableIndex: i, totalTables: tableMapping.length, rowsInserted: inserted, totalRows: rows.length })
        })
      }

      if (options.includeConstraints) {
        const indexes = await readIndexes(sourcePool, sourceDriver, source)
        const foreignKeys = await readForeignKeys(sourcePool, sourceDriver, source)
        if (indexes.length > 0 || foreignKeys.length > 0) {
          await createConstraints(targetPool, targetDriver, target, indexes, foreignKeys)
        }
      }

      await onProgress({ phase: 'table-done', table: label, tableIndex: i, totalTables: tableMapping.length, rowsInserted: rows.length, totalRows: rows.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ table: label, err }, 'Sync error for table')
      await onProgress({ phase: 'error', table: label, tableIndex: i, totalTables: tableMapping.length, rowsInserted: 0, totalRows: 0, error: message })
    }
  }

  await onProgress({ phase: 'done', table: '', tableIndex: tableMapping.length, totalTables: tableMapping.length, rowsInserted: 0, totalRows: 0 })
}

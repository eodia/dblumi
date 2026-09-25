import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import type { ConnectionPool as MssqlPool } from 'mssql'
import { Decimal128, Long, type Document, type MongoClient } from 'mongodb'
import { logger } from '../logger.js'
import { mssqlTableRef } from '../lib/mssql.js'

type DbDriver = 'postgresql' | 'mysql' | 'oracle' | 'mssql'

export type ImportColumn = {
  name: string
  type: string // generic type: text, varchar, integer, bigint, decimal, boolean, date, timestamp, float
}

export type ImportRequest = {
  tableName: string
  createTable: boolean
  ifExists: 'error' | 'append' | 'replace'
  columns: ImportColumn[]
  rows: (string | number | boolean | null)[][]
}

export type ImportProgress = {
  phase: 'create' | 'insert' | 'done'
  rowsInserted: number
  totalRows: number
  error?: string
}

export class ImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

// ── Type mapping per driver ──────────────────

const TYPE_MAP: Record<DbDriver, Record<string, string>> = {
  postgresql: {
    text: 'TEXT',
    varchar: 'VARCHAR(255)',
    integer: 'INTEGER',
    bigint: 'BIGINT',
    decimal: 'NUMERIC(18,6)',
    boolean: 'BOOLEAN',
    date: 'DATE',
    timestamp: 'TIMESTAMP',
    float: 'DOUBLE PRECISION',
  },
  mysql: {
    text: 'TEXT',
    varchar: 'VARCHAR(255)',
    integer: 'INT',
    bigint: 'BIGINT',
    decimal: 'DECIMAL(18,6)',
    boolean: 'TINYINT(1)',
    date: 'DATE',
    timestamp: 'DATETIME',
    float: 'DOUBLE',
  },
  oracle: {
    text: 'CLOB',
    varchar: 'VARCHAR2(255)',
    integer: 'NUMBER(10)',
    bigint: 'NUMBER(19)',
    decimal: 'NUMBER(18,6)',
    boolean: 'NUMBER(1)',
    date: 'DATE',
    timestamp: 'TIMESTAMP',
    float: 'BINARY_DOUBLE',
  },
  mssql: {
    text: 'NVARCHAR(MAX)',
    varchar: 'NVARCHAR(255)',
    integer: 'INT',
    bigint: 'BIGINT',
    decimal: 'DECIMAL(18,6)',
    boolean: 'BIT',
    date: 'DATE',
    timestamp: 'DATETIME2',
    float: 'FLOAT',
  },
}

function quoteId(name: string, driver: DbDriver): string {
  if (driver === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  if (driver === 'mssql') return '[' + name.replace(/]/g, ']]') + ']'
  const escaped = name.replace(/"/g, '""')
  return `"${driver === 'oracle' ? escaped.toUpperCase() : escaped}"`
}

function resolveType(genericType: string, driver: DbDriver): string {
  return TYPE_MAP[driver][genericType] ?? TYPE_MAP[driver]['text']!
}

// ── SQL generation ───────────────────────────

function buildCreateTable(
  tableName: string,
  columns: ImportColumn[],
  driver: DbDriver,
  ifNotExists = false,
): string {
  const cols = columns
    .map((c) => `  ${quoteId(c.name, driver)} ${resolveType(c.type, driver)}`)
    .join(',\n')
  const ine = ifNotExists && driver !== 'oracle' ? ' IF NOT EXISTS' : ''
  return `CREATE TABLE${ine} ${quoteId(tableName, driver)} (\n${cols}\n)`
}

function buildDropTable(tableName: string, driver: DbDriver): string {
  if (driver === 'oracle') {
    return `DROP TABLE ${quoteId(tableName, driver)}`
  }
  return `DROP TABLE IF EXISTS ${quoteId(tableName, driver)}`
}

// ── Execution per driver ─────────────────────

const BATCH_SIZE = 200

async function executeImportPg(
  pool: PgPool,
  req: ImportRequest,
  driver: DbDriver,
  onProgress: (p: ImportProgress) => Promise<void>,
): Promise<void> {
  // pg caps a statement at 65 535 bind parameters: wide tables need smaller batches.
  const batchSize = Math.max(1, Math.min(BATCH_SIZE, Math.floor(65_535 / Math.max(1, req.columns.length))))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (req.createTable) {
      if (req.ifExists === 'replace') {
        await client.query(buildDropTable(req.tableName, driver))
        await client.query(buildCreateTable(req.tableName, req.columns, driver))
      } else {
        await client.query(buildCreateTable(req.tableName, req.columns, driver, req.ifExists === 'append'))
      }
      await onProgress({ phase: 'create', rowsInserted: 0, totalRows: req.rows.length })
    }

    const colNames = req.columns.map((c) => quoteId(c.name, driver)).join(', ')
    const colCount = req.columns.length

    for (let i = 0; i < req.rows.length; i += batchSize) {
      const batch = req.rows.slice(i, i + batchSize)
      const values: unknown[] = []
      const placeholders: string[] = []

      for (let r = 0; r < batch.length; r++) {
        const row = batch[r]!
        const rowPlaceholders: string[] = []
        for (let c = 0; c < colCount; c++) {
          values.push(row[c] ?? null)
          rowPlaceholders.push(`$${r * colCount + c + 1}`)
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`)
      }

      const sql = `INSERT INTO ${quoteId(req.tableName, driver)} (${colNames}) VALUES ${placeholders.join(', ')}`
      await client.query(sql, values)
      await onProgress({ phase: 'insert', rowsInserted: Math.min(i + batchSize, req.rows.length), totalRows: req.rows.length })
    }

    await client.query('COMMIT')
    await onProgress({ phase: 'done', rowsInserted: req.rows.length, totalRows: req.rows.length })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function executeImportMySQL(
  pool: MySQLPool,
  req: ImportRequest,
  driver: DbDriver,
  onProgress: (p: ImportProgress) => Promise<void>,
): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    if (req.createTable) {
      if (req.ifExists === 'replace') {
        await conn.query(buildDropTable(req.tableName, driver))
        await conn.query(buildCreateTable(req.tableName, req.columns, driver))
      } else {
        await conn.query(buildCreateTable(req.tableName, req.columns, driver, req.ifExists === 'append'))
      }
      await onProgress({ phase: 'create', rowsInserted: 0, totalRows: req.rows.length })
    }

    const colNames = req.columns.map((c) => quoteId(c.name, driver)).join(', ')
    const colCount = req.columns.length

    for (let i = 0; i < req.rows.length; i += BATCH_SIZE) {
      const batch = req.rows.slice(i, i + BATCH_SIZE)
      const values: unknown[] = []
      const placeholders: string[] = []

      for (const row of batch) {
        const rowPlaceholders = Array.from({ length: colCount }, () => '?')
        placeholders.push(`(${rowPlaceholders.join(', ')})`)
        for (let c = 0; c < colCount; c++) {
          values.push(row[c] ?? null)
        }
      }

      const sql = `INSERT INTO ${quoteId(req.tableName, driver)} (${colNames}) VALUES ${placeholders.join(', ')}`
      await conn.query(sql, values)
      await onProgress({ phase: 'insert', rowsInserted: Math.min(i + BATCH_SIZE, req.rows.length), totalRows: req.rows.length })
    }

    await conn.commit()
    await onProgress({ phase: 'done', rowsInserted: req.rows.length, totalRows: req.rows.length })
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
  }
}

async function executeImportOracle(
  pool: OraclePool,
  req: ImportRequest,
  driver: DbDriver,
  onProgress: (p: ImportProgress) => Promise<void>,
): Promise<void> {
  const conn = await pool.getConnection()
  try {
    if (req.createTable) {
      if (req.ifExists === 'replace') {
        try {
          await conn.execute(buildDropTable(req.tableName, driver))
        } catch {
          // Table might not exist — ignore
        }
        await conn.execute(buildCreateTable(req.tableName, req.columns, driver))
      } else {
        try {
          await conn.execute(buildCreateTable(req.tableName, req.columns, driver))
        } catch (err) {
          // ORA-00955 (name already used) is expected in append mode only:
          // 'error' mode must not silently insert into an existing table.
          const exists = err instanceof Error && err.message.includes('ORA-00955')
          if (!(exists && req.ifExists === 'append')) throw err
        }
      }
      await onProgress({ phase: 'create', rowsInserted: 0, totalRows: req.rows.length })
    }

    const colNames = req.columns.map((c) => quoteId(c.name, driver)).join(', ')
    const colCount = req.columns.length
    const bindNames = Array.from({ length: colCount }, (_, i) => `:${i + 1}`).join(', ')
    const sql = `INSERT INTO ${quoteId(req.tableName, driver)} (${colNames}) VALUES (${bindNames})`

    for (let i = 0; i < req.rows.length; i += BATCH_SIZE) {
      const batch = req.rows.slice(i, i + BATCH_SIZE)
      await conn.executeMany(sql, batch.map((row) => row.map((v) => v ?? null)))
      await onProgress({ phase: 'insert', rowsInserted: Math.min(i + BATCH_SIZE, req.rows.length), totalRows: req.rows.length })
    }

    await conn.commit()
    await onProgress({ phase: 'done', rowsInserted: req.rows.length, totalRows: req.rows.length })
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    await conn.close()
  }
}

// ── SQL Server ───────────────────────────────

/** SQL Server caps a request at 2 100 parameters. */
const MSSQL_MAX_PARAMS = 2_000

/**
 * T-SQL converts 'true'/'false' to BIT, not the other spellings a CSV carries
 * (yes, oui, t, 1): normalise boolean cells, leave the rest to SQL Server.
 */
function toMssqlValue(v: string | number | boolean | null, type: string): string | number | boolean | null {
  if (v === null || type !== 'boolean' || typeof v === 'boolean') return v
  const text = String(v).trim().toLowerCase()
  if (text === '') return null
  if (['true', '1', 'yes', 'oui', 'y', 't'].includes(text)) return true
  if (['false', '0', 'no', 'non', 'n', 'f'].includes(text)) return false
  return v
}

async function executeImportMssql(
  pool: MssqlPool,
  req: ImportRequest,
  onProgress: (p: ImportProgress) => Promise<void>,
): Promise<void> {
  // The wizard lists tables outside `dbo` as `schema.table`, like the schema browser.
  const { ref } = mssqlTableRef(req.tableName)
  const colCount = req.columns.length
  // 1 000 rows at most in a VALUES list, 2 100 parameters per request.
  const batchSize = Math.max(1, Math.min(BATCH_SIZE, Math.floor(MSSQL_MAX_PARAMS / Math.max(1, colCount))))
  const cols = req.columns.map((c) => `  ${quoteId(c.name, 'mssql')} ${resolveType(c.type, 'mssql')}`).join(',\n')
  const createSql = `CREATE TABLE ${ref} (\n${cols}\n)`

  const tx = pool.transaction()
  await tx.begin()
  try {
    if (req.createTable) {
      if (req.ifExists === 'replace') {
        await tx.request().batch(`DROP TABLE IF EXISTS ${ref}`)
        await tx.request().batch(createSql)
      } else if (req.ifExists === 'append') {
        // No CREATE TABLE IF NOT EXISTS in T-SQL.
        const name = ref.replace(/'/g, "''")
        await tx.request().batch(`IF OBJECT_ID(N'${name}', N'U') IS NULL\n${createSql}`)
      } else {
        await tx.request().batch(createSql)
      }
      await onProgress({ phase: 'create', rowsInserted: 0, totalRows: req.rows.length })
    }

    const colNames = req.columns.map((c) => quoteId(c.name, 'mssql')).join(', ')
    for (let i = 0; i < req.rows.length; i += batchSize) {
      const batch = req.rows.slice(i, i + batchSize)
      const request = tx.request()
      const placeholders = batch.map((row, r) => {
        const names = req.columns.map((col, c) => {
          const name = `p${r * colCount + c}`
          request.input(name, toMssqlValue(row[c] ?? null, col.type))
          return `@${name}`
        })
        return `(${names.join(', ')})`
      })
      await request.query(`INSERT INTO ${ref} (${colNames}) VALUES ${placeholders.join(', ')}`)
      await onProgress({ phase: 'insert', rowsInserted: Math.min(i + batchSize, req.rows.length), totalRows: req.rows.length })
    }

    await tx.commit()
    await onProgress({ phase: 'done', rowsInserted: req.rows.length, totalRows: req.rows.length })
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

// ── MongoDB ──────────────────────────────────

/** CSV cells are strings: give them the BSON type chosen in the wizard. */
function toBsonValue(v: string | number | boolean | null, type: string): unknown {
  if (v === null || v === '') return null
  const text = String(v).trim()
  switch (type) {
    case 'integer':
    case 'bigint': {
      const n = typeof v === 'number' ? v : Number(text)
      if (!Number.isInteger(n)) return text
      return Number.isSafeInteger(n) ? n : Long.fromString(text)
    }
    case 'float': {
      const n = typeof v === 'number' ? v : Number(text)
      return Number.isFinite(n) ? n : text
    }
    case 'decimal':
      try {
        return Decimal128.fromString(text)
      } catch {
        return text
      }
    case 'boolean':
      return typeof v === 'boolean' ? v : ['true', '1', 'yes', 'oui', 'y', 't'].includes(text.toLowerCase())
    case 'date':
    case 'timestamp': {
      const d = new Date(typeof v === 'boolean' ? Number.NaN : v)
      return Number.isNaN(d.getTime()) ? text : d
    }
    default:
      return typeof v === 'string' ? v : text
  }
}

/**
 * MongoDB import: the table is a collection, created on first insert.
 * `createTable` + `ifExists` keep their SQL meaning (error / append / replace).
 */
export async function executeImportMongo(
  client: MongoClient,
  database: string,
  req: ImportRequest,
  onProgress: (p: ImportProgress) => Promise<void>,
): Promise<void> {
  logger.info({ tableName: req.tableName, rows: req.rows.length, driver: 'mongodb' }, 'Starting data import')
  const db = client.db(database)
  if (req.createTable) {
    const exists = (await db.listCollections({ name: req.tableName }, { nameOnly: true }).toArray()).length > 0
    if (exists && req.ifExists === 'error') {
      throw new ImportError('TABLE_EXISTS', `La collection ${req.tableName} existe déjà.`)
    }
    if (exists && req.ifExists === 'replace') await db.collection(req.tableName).drop()
    await onProgress({ phase: 'create', rowsInserted: 0, totalRows: req.rows.length })
  }

  const coll = db.collection(req.tableName)
  const MONGO_BATCH = 1000
  for (let i = 0; i < req.rows.length; i += MONGO_BATCH) {
    const docs = req.rows.slice(i, i + MONGO_BATCH).map((row) => {
      const doc: Document = {}
      req.columns.forEach((col, idx) => {
        const value = toBsonValue(row[idx] ?? null, col.type)
        // Empty cells are left out: in a schemaless store a missing field beats an explicit null.
        if (value !== null) {
          Object.defineProperty(doc, col.name, { value, enumerable: true, writable: true, configurable: true })
        }
      })
      return doc
    })
    await coll.insertMany(docs, { ordered: true })
    await onProgress({ phase: 'insert', rowsInserted: Math.min(i + MONGO_BATCH, req.rows.length), totalRows: req.rows.length })
  }
  await onProgress({ phase: 'done', rowsInserted: req.rows.length, totalRows: req.rows.length })
}

// ── Public API ───────────────────────────────

export async function executeImport(
  pool: PgPool | MySQLPool | OraclePool | MssqlPool,
  driver: DbDriver,
  req: ImportRequest,
  onProgress: (p: ImportProgress) => Promise<void>,
): Promise<void> {
  logger.info({ tableName: req.tableName, rows: req.rows.length, driver }, 'Starting data import')

  if (driver === 'mssql') {
    await executeImportMssql(pool as MssqlPool, req, onProgress)
  } else if (driver === 'postgresql') {
    await executeImportPg(pool as PgPool, req, driver, onProgress)
  } else if (driver === 'mysql') {
    await executeImportMySQL(pool as MySQLPool, req, driver, onProgress)
  } else {
    await executeImportOracle(pool as OraclePool, req, driver, onProgress)
  }
}

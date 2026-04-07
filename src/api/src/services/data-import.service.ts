import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import { logger } from '../logger.js'

type DbDriver = 'postgresql' | 'mysql' | 'oracle'

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
}

function quoteId(name: string, driver: DbDriver): string {
  if (driver === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
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
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (req.createTable) {
      if (req.ifExists === 'replace') {
        await client.query(buildDropTable(req.tableName, driver))
        await client.query(buildCreateTable(req.tableName, req.columns, driver))
      } else {
        await client.query(buildCreateTable(req.tableName, req.columns, driver, true))
      }
      await onProgress({ phase: 'create', rowsInserted: 0, totalRows: req.rows.length })
    }

    const colNames = req.columns.map((c) => quoteId(c.name, driver)).join(', ')
    const colCount = req.columns.length

    for (let i = 0; i < req.rows.length; i += BATCH_SIZE) {
      const batch = req.rows.slice(i, i + BATCH_SIZE)
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
      await onProgress({ phase: 'insert', rowsInserted: Math.min(i + BATCH_SIZE, req.rows.length), totalRows: req.rows.length })
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
        await conn.query(buildCreateTable(req.tableName, req.columns, driver, true))
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
        } catch {
          // Table already exists — ignore in error/append mode
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

// ── Public API ───────────────────────────────

export async function executeImport(
  pool: PgPool | MySQLPool | OraclePool,
  driver: DbDriver,
  req: ImportRequest,
  onProgress: (p: ImportProgress) => Promise<void>,
): Promise<void> {
  logger.info({ tableName: req.tableName, rows: req.rows.length, driver }, 'Starting data import')

  if (driver === 'postgresql') {
    await executeImportPg(pool as PgPool, req, driver, onProgress)
  } else if (driver === 'mysql') {
    await executeImportMySQL(pool as MySQLPool, req, driver, onProgress)
  } else {
    await executeImportOracle(pool as OraclePool, req, driver, onProgress)
  }
}

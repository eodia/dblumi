import type { Pool as PgPool, QueryResult } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { QueryColumn } from '@dblumi/shared'

export type ExecutionResult = {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
}

// ──────────────────────────────────────────────
// PostgreSQL execution
// ──────────────────────────────────────────────

export async function executePg(
  pool: PgPool,
  sql: string,
  limit: number,
  offset = 0,
): Promise<ExecutionResult> {
  const client = await pool.connect()
  const start = Date.now()

  try {
    const wrappedSql = injectLimit(sql, limit, offset)
    const result: QueryResult = await client.query(wrappedSql)

    const columns: QueryColumn[] = (result.fields ?? []).map((f) => ({
      name: f.name,
      dataType: pgOidToType(f.dataTypeID),
    }))

    const rows = (result.rows ?? []) as Record<string, unknown>[]

    return {
      columns,
      rows,
      rowCount: result.rowCount ?? rows.length,
      durationMs: Date.now() - start,
    }
  } finally {
    client.release()
  }
}

// ──────────────────────────────────────────────
// MySQL execution
// ──────────────────────────────────────────────

export async function executeMySQL(
  pool: MySQLPool,
  sql: string,
  limit: number,
  offset = 0,
): Promise<ExecutionResult> {
  const conn = await pool.getConnection()
  const start = Date.now()

  try {
    const wrappedSql = injectLimit(sql, limit, offset)
    const [rows, fields] = await conn.query(wrappedSql)

    const columns: QueryColumn[] = Array.isArray(fields)
      ? fields.map((f: { name: string; type?: number }) => ({
          name: f.name,
          dataType: String(f.type ?? 'unknown'),
        }))
      : []

    const resultRows = Array.isArray(rows)
      ? (rows as Record<string, unknown>[])
      : []

    return {
      columns,
      rows: resultRows,
      rowCount: resultRows.length,
      durationMs: Date.now() - start,
    }
  } finally {
    conn.release()
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Wraps SELECT statements in a subquery with LIMIT.
 * Leaves non-SELECT statements unchanged.
 */
function injectLimit(sql: string, limit: number, offset = 0): string {
  const trimmed = sql.trim().replace(/;+$/, '')
  const upper = trimmed.toUpperCase()

  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return trimmed
  }

  // Detect user-provided LIMIT
  const userLimitMatch = trimmed.match(/\bLIMIT\s+(\d+)/i)
  const userLimit = userLimitMatch ? parseInt(userLimitMatch[1]!, 10) : null

  // Strip existing LIMIT / OFFSET clauses
  let clean = trimmed
    .replace(/\bLIMIT\s+\d+\s*,\s*\d+/i, '') // MySQL LIMIT offset, count
    .replace(/\bOFFSET\s+\d+/i, '')
    .replace(/\bLIMIT\s+\d+/i, '')
    .trim()

  // Use the smaller of user LIMIT and pagination LIMIT
  const effectiveLimit = userLimit !== null ? Math.min(userLimit, limit) : limit

  let result = `${clean}\nLIMIT ${effectiveLimit}`
  if (offset > 0) result += ` OFFSET ${offset}`
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

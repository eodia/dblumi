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
  limit: number
): Promise<ExecutionResult> {
  const client = await pool.connect()
  const start = Date.now()

  try {
    // Wrap SELECT-like queries in a LIMIT subquery if needed
    const wrappedSql = injectLimit(sql, limit)
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
  limit: number
): Promise<ExecutionResult> {
  const conn = await pool.getConnection()
  const start = Date.now()

  try {
    const wrappedSql = injectLimit(sql, limit)
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
function injectLimit(sql: string, limit: number): string {
  const trimmed = sql.trim()
  const upper = trimmed.toUpperCase()

  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return trimmed
  }

  // Already has a LIMIT clause — respect it (but cap it)
  const limitMatch = upper.match(/\bLIMIT\s+(\d+)\b/)
  if (limitMatch) {
    const existing = parseInt(limitMatch[1] ?? '0', 10)
    if (existing <= limit) return trimmed
    return trimmed.replace(/\bLIMIT\s+\d+\b/i, `LIMIT ${limit}`)
  }

  return `${trimmed}\nLIMIT ${limit}`
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

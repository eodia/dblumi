import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import type { Client as LibSQLClient } from '@libsql/client'
import type { Trino } from 'trino-client'
import type { MongoClient } from 'mongodb'
import type { ConnectionPool as MssqlPool } from 'mssql'
import type { DbDriver } from '@dblumi/shared'
import type { SnowflakeClient } from '../lib/snowflake.js'
import type { RedisConn } from '../lib/redis.js'
import { connectionManager, type DbPool } from '../lib/connection-manager.js'
import { runTrino, parseTrinoTarget, quoteTrinoIdent, quoteTrinoString } from '../lib/trino.js'
import { getMongoSchema, mongoDatabaseName } from '../lib/mongo.js'
import { logger } from '../logger.js'

// ──────────────────────────────────────────────
// Schema introspection, shared by the schema browser (routes/connections.ts)
// and the copilot prompt (routes/copilot.ts).
// ──────────────────────────────────────────────

type SchemaRow = {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
  is_primary_key: boolean
  table_type: string
  table_comment: string | null
}

type SchemaIndex = { name: string; columns: string[]; unique: boolean }
type SchemaFK = { name: string; fields: string[]; referencedDatabase: string; referencedTable: string; referencedFields: string[]; onDelete: string; onUpdate: string }

export type SchemaItem = {
  name: string
  type: 'table' | 'view'
  comment: string
  columns: Array<{ name: string; dataType: string; nullable: boolean; primaryKey: boolean }>
  indexes: SchemaIndex[]
  foreignKeys: SchemaFK[]
}

type IndexRow = { table_name: string; index_name: string; is_unique: boolean; column_name: string }
type FKRow = { table_name: string; constraint_name: string; column_name: string; referenced_schema: string; referenced_table: string; referenced_column: string; on_delete: string; on_update: string }

function groupByTable(rows: SchemaRow[]) {
  const map = new Map<string, SchemaItem>()
  for (const row of rows) {
    if (!map.has(row.table_name)) {
      const isView = row.table_type === 'VIEW'
      map.set(row.table_name, { name: row.table_name, type: isView ? 'view' : 'table', comment: row.table_comment ?? '', columns: [], indexes: [], foreignKeys: [] })
    }
    map.get(row.table_name)!.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      primaryKey:
        row.is_primary_key === true || (row.is_primary_key as unknown) === 1,
    })
  }
  return map
}

function mergeIndexes(map: Map<string, SchemaItem>, indexRows: IndexRow[]) {
  for (const row of indexRows) {
    const table = map.get(row.table_name)
    if (!table) continue
    let idx = table.indexes.find((i) => i.name === row.index_name)
    if (!idx) {
      idx = { name: row.index_name, columns: [], unique: row.is_unique }
      table.indexes.push(idx)
    }
    idx.columns.push(row.column_name)
  }
}

function mergeForeignKeys(map: Map<string, SchemaItem>, fkRows: FKRow[]) {
  for (const row of fkRows) {
    const table = map.get(row.table_name)
    if (!table) continue
    let fk = table.foreignKeys.find((f) => f.name === row.constraint_name)
    if (!fk) {
      fk = { name: row.constraint_name, fields: [], referencedDatabase: row.referenced_schema, referencedTable: row.referenced_table, referencedFields: [], onDelete: row.on_delete, onUpdate: row.on_update }
      table.foreignKeys.push(fk)
    }
    fk.fields.push(row.column_name)
    fk.referencedFields.push(row.referenced_column)
  }
  return { tables: Array.from(map.values()) }
}

export type FunctionRow = {
  name: string
  kind: string       // 'function' or 'procedure'
  return_type: string
  arguments: string
  language: string
}

async function getPgSchema(pool: PgPool) {
  const client = await pool.connect()
  try {
    const { rows } = await client.query<SchemaRow>(`
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        t.table_type,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
        -- format('%I.%I') quotes the name: a bare 'public.' || name cast lowercases
        -- it, and one mixed-case table used to fail the whole schema fetch.
        obj_description(format('%I.%I', c.table_schema, c.table_name)::regclass, 'pg_class') AS table_comment
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      LEFT JOIN (
        SELECT ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
      WHERE c.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY t.table_type, c.table_name, c.ordinal_position
    `)

    const { rows: funcRows } = await client.query<FunctionRow>(`
      SELECT
        p.proname AS name,
        CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind,
        pg_get_function_result(p.oid) AS return_type,
        pg_get_function_identity_arguments(p.oid) AS arguments,
        l.lanname AS language
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
      ORDER BY p.prokind, p.proname
    `)

    const { rows: idxRows } = await client.query<IndexRow>(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        a.attname AS column_name
      FROM pg_class t
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = 'public' AND t.relkind = 'r' AND NOT ix.indisprimary
      ORDER BY t.relname, i.relname, array_position(ix.indkey, a.attnum)
    `)

    const { rows: fkRows } = await client.query<FKRow>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema  AS referenced_schema,
        ccu.table_name    AS referenced_table,
        ccu.column_name   AS referenced_column,
        rc.delete_rule    AS on_delete,
        rc.update_rule    AS on_update
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    `)

    const tableMap = groupByTable(rows)
    mergeIndexes(tableMap, idxRows)
    const result = mergeForeignKeys(tableMap, fkRows)
    return { ...result, functions: funcRows }
  } finally {
    client.release()
  }
}

async function getMySQLSchema(pool: MySQLPool) {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query(`
      SELECT
        c.TABLE_NAME    AS table_name,
        c.COLUMN_NAME   AS column_name,
        c.DATA_TYPE     AS data_type,
        c.IS_NULLABLE   AS is_nullable,
        t.TABLE_TYPE    AS table_type,
        CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END AS is_primary_key,
        t.TABLE_COMMENT AS table_comment
      FROM information_schema.COLUMNS c
      JOIN information_schema.TABLES t
        ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
      WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY t.TABLE_TYPE, c.TABLE_NAME, c.ORDINAL_POSITION
    `)

    const [funcRows] = await conn.query(`
      SELECT
        r.ROUTINE_NAME AS name,
        LOWER(r.ROUTINE_TYPE) AS kind,
        r.DTD_IDENTIFIER AS return_type,
        -- The real parameter list (position 0 is a function's return value);
        -- ROUTINE_COMMENT used to be shown — and sent to the copilot — as arguments.
        COALESCE((
          SELECT GROUP_CONCAT(CONCAT(p.PARAMETER_NAME, ' ', p.DTD_IDENTIFIER) ORDER BY p.ORDINAL_POSITION SEPARATOR ', ')
          FROM information_schema.PARAMETERS p
          WHERE p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA AND p.SPECIFIC_NAME = r.SPECIFIC_NAME AND p.ORDINAL_POSITION > 0
        ), '') AS arguments,
        r.EXTERNAL_LANGUAGE AS language
      FROM information_schema.ROUTINES r
      WHERE r.ROUTINE_SCHEMA = DATABASE()
      ORDER BY r.ROUTINE_TYPE, r.ROUTINE_NAME
    `)

    const [idxRows] = await conn.query(`
      SELECT
        TABLE_NAME  AS table_name,
        INDEX_NAME  AS index_name,
        NOT NON_UNIQUE AS is_unique,
        COLUMN_NAME AS column_name
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME != 'PRIMARY'
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    `)

    const [fkRows] = await conn.query(`
      SELECT
        kcu.TABLE_NAME        AS table_name,
        kcu.CONSTRAINT_NAME   AS constraint_name,
        kcu.COLUMN_NAME       AS column_name,
        kcu.REFERENCED_TABLE_SCHEMA  AS referenced_schema,
        kcu.REFERENCED_TABLE_NAME    AS referenced_table,
        kcu.REFERENCED_COLUMN_NAME   AS referenced_column,
        rc.DELETE_RULE        AS on_delete,
        rc.UPDATE_RULE        AS on_update
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
      WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `)

    const tableMap = groupByTable(rows as SchemaRow[])
    mergeIndexes(tableMap, idxRows as IndexRow[])
    const result = mergeForeignKeys(tableMap, fkRows as FKRow[])
    return { ...result, functions: funcRows as FunctionRow[] }
  } finally {
    conn.release()
  }
}

async function getSQLiteSchema(client: LibSQLClient) {
  const tablesResult = await client.execute(
    `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )

  const tables: SchemaItem[] = []

  for (const tableRow of tablesResult.rows) {
    const tableName = String(tableRow[0])
    const tableType = tableRow[1] === 'view' ? 'view' : ('table' as const)

    // PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
    const colsResult = await client.execute(`PRAGMA table_info(${JSON.stringify(tableName)})`)
    const columns = colsResult.rows.map((r) => ({
      name: String(r[1]),
      dataType: String(r[2] || 'text').toLowerCase(),
      nullable: r[3] === 0,
      primaryKey: Number(r[5]) > 0,
    }))

    // PRAGMA index_list: seq, name, unique, origin, partial
    const idxListResult = await client.execute(`PRAGMA index_list(${JSON.stringify(tableName)})`)
    const indexes: SchemaIndex[] = []
    for (const idxRow of idxListResult.rows) {
      const idxName = String(idxRow[1])
      const isUnique = Number(idxRow[2]) === 1
      const idxInfoResult = await client.execute(`PRAGMA index_info(${JSON.stringify(idxName)})`)
      const idxColumns = idxInfoResult.rows.map((r) => String(r[2]))
      indexes.push({ name: idxName, columns: idxColumns, unique: isUnique })
    }

    // PRAGMA foreign_key_list: id, seq, table, from, to, on_delete, on_update, match
    const fkResult = await client.execute(`PRAGMA foreign_key_list(${JSON.stringify(tableName)})`)
    const fkMap = new Map<number, { referencedTable: string; fields: string[]; referencedFields: string[]; onDelete: string; onUpdate: string }>()
    for (const fkRow of fkResult.rows) {
      const fkId = Number(fkRow[0])
      if (!fkMap.has(fkId)) {
        fkMap.set(fkId, { referencedTable: String(fkRow[2]), fields: [], referencedFields: [], onDelete: String(fkRow[5]), onUpdate: String(fkRow[6]) })
      }
      const entry = fkMap.get(fkId)!
      entry.fields.push(String(fkRow[3]))
      entry.referencedFields.push(String(fkRow[4]))
    }
    const foreignKeys: SchemaFK[] = Array.from(fkMap.entries()).map(([fkId, fk]) => ({
      name: `fk_${tableName}_${fkId}`,
      fields: fk.fields,
      referencedDatabase: '',
      referencedTable: fk.referencedTable,
      referencedFields: fk.referencedFields,
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    }))

    tables.push({ name: tableName, type: tableType, comment: '', columns, indexes, foreignKeys })
  }

  return { tables, functions: [] as FunctionRow[] }
}

async function getOracleSchema(pool: OraclePool) {
  const conn = await pool.getConnection()
  try {
    const { rows: colRows } = await conn.execute<[string, string, string, string, number]>(`
      SELECT
        c.TABLE_NAME,
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.NULLABLE,
        CASE WHEN p.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
      FROM USER_TAB_COLUMNS c
      LEFT JOIN (
        SELECT cc.TABLE_NAME, cc.COLUMN_NAME
        FROM USER_CONSTRAINTS uc
        JOIN USER_CONS_COLUMNS cc ON cc.CONSTRAINT_NAME = uc.CONSTRAINT_NAME
        WHERE uc.CONSTRAINT_TYPE = 'P'
      ) p ON p.TABLE_NAME = c.TABLE_NAME AND p.COLUMN_NAME = c.COLUMN_NAME
      ORDER BY c.TABLE_NAME, c.COLUMN_ID
    `, [], { outFormat: 4001 /* ARRAY */ })

    const map = new Map<string, SchemaItem>()
    for (const row of (colRows ?? []) as [string, string, string, string, number][]) {
      const [tableName, columnName, dataType, nullable, isPk] = row
      if (!tableName) continue
      if (!map.has(tableName)) {
        map.set(tableName, { name: tableName, type: 'table', comment: '', columns: [], indexes: [], foreignKeys: [] })
      }
      map.get(tableName)!.columns.push({
        name: columnName ?? '',
        dataType: dataType ?? 'unknown',
        nullable: nullable === 'Y',
        primaryKey: isPk === 1,
      })
    }

    const { rows: fkRows } = await conn.execute<[string, string, string, string, string, string]>(`
      SELECT
        uc.TABLE_NAME,
        uc.CONSTRAINT_NAME,
        cc.COLUMN_NAME,
        rc.TABLE_NAME AS REF_TABLE,
        rcc.COLUMN_NAME AS REF_COLUMN,
        uc.DELETE_RULE
      FROM USER_CONSTRAINTS uc
      JOIN USER_CONS_COLUMNS cc ON cc.CONSTRAINT_NAME = uc.CONSTRAINT_NAME
      JOIN USER_CONSTRAINTS rc ON rc.CONSTRAINT_NAME = uc.R_CONSTRAINT_NAME
      JOIN USER_CONS_COLUMNS rcc ON rcc.CONSTRAINT_NAME = uc.R_CONSTRAINT_NAME AND rcc.POSITION = cc.POSITION
      WHERE uc.CONSTRAINT_TYPE = 'R'
      ORDER BY uc.TABLE_NAME, uc.CONSTRAINT_NAME, cc.POSITION
    `, [], { outFormat: 4001 })

    for (const row of (fkRows ?? []) as [string, string, string, string, string, string][]) {
      const [tableName, constraintName, columnName, refTable, refColumn, deleteRule] = row
      if (!tableName) continue
      const table = map.get(tableName)
      if (!table) continue
      let fk = table.foreignKeys.find((f) => f.name === constraintName)
      if (!fk) {
        fk = { name: constraintName ?? '', fields: [], referencedDatabase: '', referencedTable: refTable ?? '', referencedFields: [], onDelete: deleteRule ?? 'NO ACTION', onUpdate: 'NO ACTION' }
        table.foreignKeys.push(fk)
      }
      fk.fields.push(columnName ?? '')
      fk.referencedFields.push(refColumn ?? '')
    }

    return { tables: Array.from(map.values()), functions: [] }
  } finally {
    await conn.close()
  }
}

/**
 * Effective target of a connection whose database is chosen per live client:
 * Trino ("catalog" or "catalog/schema") and MongoDB (database name).
 *
 * `POST /:id/switch-database` re-creates the client with a new target WITHOUT
 * persisting it on the row, so the stored `database` alone would keep every
 * metadata route pinned to the original (often empty) value and turn the
 * database switcher into a no-op.
 */
export function liveDatabaseOf(connectionId: string, stored?: string | null): string | null {
  return connectionManager.liveDatabase(connectionId) ?? stored ?? null
}

/** Schemas introspected in one pass when no schema is pinned on the connection. */
const TRINO_MAX_SCHEMAS = 50

/**
 * Trino introspection through the catalog's `information_schema`.
 *
 * Two modes, driven by the connection target ("catalog" or "catalog/schema"):
 *  - pinned schema  -> bare table names (`orders`)
 *  - catalog only   -> qualified names (`default.orders`), because the front-end
 *                      builds `SELECT * FROM ${tableName}` without qualification.
 *
 * Trino exposes no primary keys, no indexes, no foreign keys and no user routines:
 * those collections are always returned empty.
 */
async function getTrinoSchema(client: Trino, target?: string | null) {
  const { catalog, schema } = parseTrinoTarget(target)
  if (!catalog) {
    throw new Error(
      'Aucun catalogue Trino défini : renseignez le champ Catalogue (ex. hive ou hive/default).',
    )
  }
  const cat = quoteTrinoIdent(catalog)
  const SYSTEM_SCHEMAS = new Set(['information_schema', 'pg_catalog', 'sys'])

  let where: string
  let nameExpr: string
  if (schema) {
    where = `c.table_schema = ${quoteTrinoString(schema)}`
    nameExpr = 'c.table_name'
  } else {
    // `SHOW SCHEMAS` + `IN (...)` is pushed down to the connector, while a
    // `NOT IN (...)` filter makes Trino enumerate metadata for the whole catalog.
    const shown = await runTrino(client, `SHOW SCHEMAS FROM ${cat}`)
    const all = shown.data
      .map((r) => String(r[0] ?? ''))
      .filter((s) => s && !SYSTEM_SCHEMAS.has(s.toLowerCase()))
    const schemas = all.slice(0, TRINO_MAX_SCHEMAS) // guardrail against over-scanning
    if (all.length > schemas.length) {
      logger.warn(
        { catalog, total: all.length, kept: schemas.length },
        'Trino schema list truncated — pin a schema on the connection to browse the rest',
      )
    }
    if (schemas.length === 0) return { tables: [] as SchemaItem[], functions: [] as FunctionRow[] }
    where = `c.table_schema IN (${schemas.map(quoteTrinoString).join(', ')})`
    nameExpr = `c.table_schema || '.' || c.table_name`
  }

  // A single columns query: every Trino statement costs several HTTP round-trips.
  const sql = `
    SELECT ${nameExpr} AS table_name, c.column_name, c.data_type, c.is_nullable,
           t.table_type, false AS is_primary_key, CAST(NULL AS varchar) AS table_comment
    FROM ${cat}.information_schema.columns c
    JOIN ${cat}.information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE ${where}
    ORDER BY 1, c.ordinal_position`
  const result = await runTrino(client, sql)

  // An empty result is ambiguous: an empty schema, or a schema that does not
  // exist at all (`information_schema.columns` simply matches nothing). Resolve
  // it here — only on that path, so the normal case keeps its single query.
  if (result.rows.length === 0 && schema) {
    const shown = await runTrino(client, `SHOW SCHEMAS FROM ${cat}`)
    const wanted = schema.toLowerCase()
    const known = shown.data.some((r) => String(r[0] ?? '').toLowerCase() === wanted)
    if (!known) {
      throw new Error(
        `Schéma '${schema}' introuvable dans le catalogue '${catalog}' : corrigez le champ Catalogue de la connexion.`,
      )
    }
  }

  const map = groupByTable(result.rows as unknown as SchemaRow[])
  return { ...mergeForeignKeys(map, []), functions: [] as FunctionRow[] }
}

export type DbSchema = { tables: SchemaItem[]; functions: FunctionRow[] }

/** Schema of the connection's current database, whatever the driver. */
export async function fetchSchema(
  connectionId: string,
  driver: DbDriver,
  pool: DbPool,
  storedDatabase?: string | null,
): Promise<DbSchema> {
  switch (driver) {
    case 'postgresql':
      return getPgSchema(pool as PgPool)
    case 'mysql':
      return getMySQLSchema(pool as MySQLPool)
    case 'sqlite':
      return getSQLiteSchema(pool as LibSQLClient)
    case 'oracle':
      return getOracleSchema(pool as OraclePool)
    case 'trino':
      return getTrinoSchema(pool as Trino, liveDatabaseOf(connectionId, storedDatabase))
    case 'mongodb':
      return getMongoSchema(pool as MongoClient, mongoDatabaseName(liveDatabaseOf(connectionId, storedDatabase)))
    case 'mssql': {
      const { getMssqlSchema } = await import('../lib/mssql.js')
      return getMssqlSchema(pool as MssqlPool)
    }
    case 'snowflake': {
      const { getSnowflakeSchema } = await import('../lib/snowflake.js')
      return getSnowflakeSchema(pool as SnowflakeClient, liveDatabaseOf(connectionId, storedDatabase))
    }
    case 'redis': {
      const { getRedisSchema } = await import('../lib/redis.js')
      return getRedisSchema(pool as RedisConn)
    }
  }
}

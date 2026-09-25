import type { DbDriver } from '@dblumi/shared'

/**
 * Runtime list of drivers, for Zod enums and OpenAPI docs. `@dblumi/shared` is
 * only ever imported for its types, so its `DbDriverSchema` is not usable here.
 */
export const DB_DRIVERS = [
  'postgresql', 'mysql', 'oracle', 'sqlite', 'trino', 'mongodb', 'mssql', 'snowflake', 'redis',
] as const

// Compile-time guard: this list and the shared `DbDriver` type must not drift apart.
type Missing = Exclude<DbDriver, (typeof DB_DRIVERS)[number]>
type Extra = Exclude<(typeof DB_DRIVERS)[number], DbDriver>
export const DB_DRIVERS_IN_SYNC: [Missing, Extra] extends [never, never] ? true : never = true

/** Drivers that speak SQL. */
export type SqlDriver = Exclude<DbDriver, 'mongodb' | 'redis'>

export function isSqlDriver(driver: DbDriver): driver is SqlDriver {
  return driver !== 'mongodb' && driver !== 'redis'
}

/**
 * What the API can do per driver. Routes check this table instead of repeating
 * `driver === '…'` lists — the lists used to drift, and unknown drivers fell
 * through to the Oracle branches.
 */
export const DRIVER_SUPPORT: Record<DbDriver, {
  dbUsers: boolean
  importWizard: boolean
  sync: boolean
  createDatabase: boolean
  functions: boolean
}> = {
  postgresql: { dbUsers: true, importWizard: true, sync: true, createDatabase: true, functions: true },
  mysql: { dbUsers: true, importWizard: true, sync: true, createDatabase: true, functions: true },
  oracle: { dbUsers: true, importWizard: true, sync: true, createDatabase: false, functions: true },
  sqlite: { dbUsers: false, importWizard: false, sync: false, createDatabase: false, functions: false },
  trino: { dbUsers: false, importWizard: false, sync: false, createDatabase: false, functions: false },
  mongodb: { dbUsers: false, importWizard: true, sync: false, createDatabase: false, functions: false },
  mssql: { dbUsers: false, importWizard: true, sync: false, createDatabase: true, functions: true },
  snowflake: { dbUsers: false, importWizard: false, sync: false, createDatabase: false, functions: false },
  redis: { dbUsers: false, importWizard: false, sync: false, createDatabase: false, functions: false },
}

/** Human name, for error messages. */
export const DRIVER_LABELS: Record<DbDriver, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  oracle: 'Oracle',
  sqlite: 'SQLite',
  trino: 'Trino',
  mongodb: 'MongoDB',
  mssql: 'SQL Server',
  snowflake: 'Snowflake',
  redis: 'Redis',
}

/**
 * Quotes one identifier (table, column) for the target dialect.
 * Double quotes by default, backticks for MySQL, brackets for SQL Server; the
 * closing character is escaped by doubling.
 */
export function quoteIdent(driver: SqlDriver, name: string): string {
  if (driver === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  if (driver === 'mssql') return '[' + name.replace(/]/g, ']]') + ']'
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Table reference. Trino, SQL Server and Snowflake list tables outside the
 * default schema as `schema.table`: each part is quoted on its own.
 */
export function quoteTable(driver: SqlDriver, name: string): string {
  if ((driver === 'trino' || driver === 'mssql' || driver === 'snowflake') && name.includes('.')) {
    return name.split('.').map((part) => quoteIdent(driver, part)).join('.')
  }
  return quoteIdent(driver, name)
}

import type { DbDriver } from '@/api/connections'

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

/** Default port per server-based driver (SQLite is a file, Snowflake an account URL). */
export const DEFAULT_PORTS: Partial<Record<DbDriver, number>> = {
  postgresql: 5432,
  mysql: 3306,
  oracle: 1521,
  trino: 8080,
  mongodb: 27017,
  mssql: 1433,
  redis: 6379,
}

/**
 * What the UI offers per driver. Mirrors DRIVER_SUPPORT in the API
 * (src/api/src/lib/drivers.ts): an entry point the API refuses must not be shown.
 */
export const DRIVER_CAPS: Record<DbDriver, {
  /** TableStructureEditor — it only emits PostgreSQL / MySQL / Oracle / SQLite DDL. */
  structureEditor: boolean
  /** CSV rows appended to an existing table, as INSERTs from the grid. */
  csvImport: boolean
  importWizard: boolean
  sync: boolean
  dbUsers: boolean
  /** The results bar EXPLAIN toggle. */
  explain: boolean
  /** DROP of a table / view / routine from the schema tree. */
  drop: boolean
  /** CREATE DATABASE from the database switcher. */
  createDatabase: boolean
}> = {
  postgresql: { structureEditor: true, csvImport: true, importWizard: true, sync: true, dbUsers: true, explain: true, drop: true, createDatabase: true },
  mysql: { structureEditor: true, csvImport: true, importWizard: true, sync: true, dbUsers: true, explain: true, drop: true, createDatabase: true },
  oracle: { structureEditor: true, csvImport: true, importWizard: true, sync: true, dbUsers: true, explain: true, drop: true, createDatabase: false },
  sqlite: { structureEditor: true, csvImport: true, importWizard: false, sync: false, dbUsers: false, explain: true, drop: true, createDatabase: false },
  trino: { structureEditor: false, csvImport: false, importWizard: false, sync: false, dbUsers: false, explain: true, drop: true, createDatabase: false },
  mongodb: { structureEditor: false, csvImport: true, importWizard: true, sync: false, dbUsers: false, explain: true, drop: true, createDatabase: false },
  // T-SQL has no EXPLAIN: plans need SET SHOWPLAN_XML in a batch of their own.
  mssql: { structureEditor: false, csvImport: true, importWizard: true, sync: false, dbUsers: false, explain: false, drop: true, createDatabase: true },
  snowflake: { structureEditor: false, csvImport: true, importWizard: false, sync: false, dbUsers: false, explain: true, drop: true, createDatabase: false },
  // A Redis "table" is a key prefix: nothing to drop or import into as a whole.
  redis: { structureEditor: false, csvImport: false, importWizard: false, sync: false, dbUsers: false, explain: false, drop: false, createDatabase: false },
}

/** Capabilities of a driver not known yet (connection list loading): offer nothing risky. */
export function driverCaps(driver: DbDriver | undefined) {
  return driver ? DRIVER_CAPS[driver] : DRIVER_CAPS.redis
}

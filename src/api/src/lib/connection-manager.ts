import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import type { Client as LibSQLClient } from '@libsql/client'
import type { Trino } from 'trino-client'
import { logger } from '../logger.js'

type PoolEntry =
  | { driver: 'postgresql'; pool: PgPool }
  | { driver: 'mysql'; pool: MySQLPool }
  | { driver: 'oracle'; pool: OraclePool }
  | { driver: 'sqlite'; client: LibSQLClient }
  // `database` records the target the live client was built with. Trino is the
  // only driver whose introspection is driven by that value instead of by the
  // pool itself, so `switch-database` (runtime only) must be observable here.
  | { driver: 'trino'; client: Trino; database?: string | undefined }

/**
 * Singleton manager — one pool/client per active connection ID.
 * Pools are created on first use and destroyed on disconnect.
 */
class ConnectionManager {
  private readonly pools = new Map<string, PoolEntry>()

  async getPool(
    id: string,
    opts: PoolOptions,
  ): Promise<PgPool | MySQLPool | OraclePool | LibSQLClient | Trino> {
    const existing = this.pools.get(id)
    if (existing) {
      return existing.driver === 'sqlite' || existing.driver === 'trino'
        ? existing.client
        : existing.pool
    }

    const entry = await this.createPool(id, opts)
    this.pools.set(id, entry)
    return entry.driver === 'sqlite' || entry.driver === 'trino' ? entry.client : entry.pool
  }

  async release(id: string): Promise<void> {
    const entry = this.pools.get(id)
    if (!entry) return

    try {
      if (entry.driver === 'sqlite') {
        entry.client.close()
      } else if (entry.driver === 'trino') {
        // Stateless HTTP client: nothing to close. The `finally` block below
        // removes the Map entry, which is the whole lifecycle for Trino.
      } else if (entry.driver === 'oracle') {
        await (entry.pool as OraclePool).close(0)
      } else {
        await entry.pool.end()
      }
      logger.info({ connectionId: id }, 'Connection pool released')
    } catch (err) {
      logger.warn({ connectionId: id, err }, 'Error releasing pool')
    } finally {
      this.pools.delete(id)
    }
  }

  has(id: string): boolean {
    return this.pools.has(id)
  }

  /**
   * Trino target ("catalog" or "catalog/schema") of the LIVE client.
   *
   * `POST /:id/switch-database` re-creates the client without persisting the new
   * value on the connection row, so every Trino route must read the target from
   * here first — reading `poolOpts.database` alone would keep returning the
   * stored (possibly empty) catalog and make the switcher a no-op.
   */
  trinoTarget(id: string): string | undefined {
    const entry = this.pools.get(id)
    return entry?.driver === 'trino' ? entry.database : undefined
  }

  async releaseAll(): Promise<void> {
    await Promise.allSettled(
      [...this.pools.keys()].map((id) => this.release(id))
    )
  }

  private async createPool(id: string, opts: PoolOptions): Promise<PoolEntry> {
    if (opts.driver === 'postgresql') {
      const { Pool } = await import('pg')
      const pool = new Pool({
        host: opts.host,
        port: opts.port,
        database: opts.database || 'postgres',
        user: opts.username,
        password: opts.password,
        ...(opts.ssl ? { ssl: { rejectUnauthorized: false } } : { ssl: false }),
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      })
      // Propagate pool errors to logger (avoids unhandled rejection)
      pool.on('error', (err) => {
        logger.error({ connectionId: id, err }, 'pg pool error')
      })
      logger.info({ connectionId: id, driver: 'postgresql' }, 'Pool created')
      return { driver: 'postgresql', pool }
    } else if (opts.driver === 'mysql') {
      const mysql = await import('mysql2/promise')
      const pool = mysql.createPool({
        ...(opts.host ? { host: opts.host } : {}),
        ...(opts.port ? { port: opts.port } : {}),
        ...(opts.database ? { database: opts.database } : {}),
        ...(opts.username ? { user: opts.username } : {}),
        ...(opts.password ? { password: opts.password } : {}),
        ...(opts.ssl ? { ssl: {} } : {}),
        connectionLimit: 5,
        connectTimeout: 10_000,
      })
      logger.info({ connectionId: id, driver: 'mysql' }, 'Pool created')
      return { driver: 'mysql', pool }
    } else if (opts.driver === 'oracle') {
      const oracledb = await import('oracledb')
      const connectString = opts.database
        ? `${opts.host}:${opts.port}/${opts.database}`
        : `${opts.host}:${opts.port}`
      const pool = await oracledb.createPool({
        user: opts.username,
        password: opts.password,
        connectString,
        poolMax: 5,
        poolMin: 0,
        poolTimeout: 30,
        connectTimeout: 10,
      })
      logger.info({ connectionId: id, driver: 'oracle' }, 'Pool created')
      return { driver: 'oracle', pool }
    } else if (opts.driver === 'trino') {
      const { createTrinoClient } = await import('./trino.js')
      const client = createTrinoClient(opts)
      logger.info({ connectionId: id, driver: 'trino' }, 'Trino client created')
      return { driver: 'trino', client, ...(opts.database ? { database: opts.database } : {}) }
    } else if (opts.driver === 'sqlite') {
      // SQLite via @libsql/client
      const { createClient } = await import('@libsql/client')
      const filePath = opts.filePath ?? ''
      const url = filePath === ':memory:' ? ':memory:' : `file:${filePath}`
      const client = createClient({ url })
      logger.info({ connectionId: id, driver: 'sqlite', filePath }, 'SQLite client created')
      return { driver: 'sqlite', client }
    } else {
      // Exhaustiveness guard: a driver added to the enum without a branch here
      // used to silently build a libsql `file:` client with an empty path.
      const unsupported: never = opts.driver
      throw new Error(`Driver non supporté : ${String(unsupported)}`)
    }
  }
}

export type PoolOptions = {
  driver: 'postgresql' | 'mysql' | 'oracle' | 'sqlite' | 'trino'
  // PostgreSQL / MySQL / Oracle / Trino
  host?: string | undefined
  port?: number | undefined
  /** PostgreSQL/MySQL/Oracle: database name. Trino: "catalog" or "catalog/schema". */
  database?: string | undefined
  username?: string | undefined
  password?: string | undefined
  ssl?: boolean | undefined
  // SQLite
  filePath?: string | undefined
}

export const connectionManager = new ConnectionManager()

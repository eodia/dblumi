import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import type { Client as LibSQLClient } from '@libsql/client'
import { logger } from '../logger.js'

type PoolEntry =
  | { driver: 'postgresql'; pool: PgPool }
  | { driver: 'mysql'; pool: MySQLPool }
  | { driver: 'oracle'; pool: OraclePool }
  | { driver: 'sqlite'; client: LibSQLClient }

/**
 * Singleton manager — one pool/client per active connection ID.
 * Pools are created on first use and destroyed on disconnect.
 */
class ConnectionManager {
  private readonly pools = new Map<string, PoolEntry>()

  async getPool(id: string, opts: PoolOptions): Promise<PgPool | MySQLPool | OraclePool | LibSQLClient> {
    const existing = this.pools.get(id)
    if (existing) {
      return existing.driver === 'sqlite' ? existing.client : existing.pool
    }

    const entry = await this.createPool(id, opts)
    this.pools.set(id, entry)
    return entry.driver === 'sqlite' ? entry.client : entry.pool
  }

  async release(id: string): Promise<void> {
    const entry = this.pools.get(id)
    if (!entry) return

    try {
      if (entry.driver === 'sqlite') {
        entry.client.close()
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
    } else {
      // SQLite via @libsql/client
      const { createClient } = await import('@libsql/client')
      const filePath = opts.filePath ?? ''
      const url = filePath === ':memory:' ? ':memory:' : `file:${filePath}`
      const client = createClient({ url })
      logger.info({ connectionId: id, driver: 'sqlite', filePath }, 'SQLite client created')
      return { driver: 'sqlite', client }
    }
  }
}

export type PoolOptions = {
  driver: 'postgresql' | 'mysql' | 'oracle' | 'sqlite'
  // PostgreSQL / MySQL / Oracle
  host?: string | undefined
  port?: number | undefined
  database?: string | undefined
  username?: string | undefined
  password?: string | undefined
  ssl?: boolean | undefined
  // SQLite
  filePath?: string | undefined
}

export const connectionManager = new ConnectionManager()

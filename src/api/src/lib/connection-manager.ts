import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import { logger } from '../logger.js'

type PoolEntry =
  | { driver: 'postgresql'; pool: PgPool }
  | { driver: 'mysql'; pool: MySQLPool }
  | { driver: 'oracle'; pool: OraclePool }

/**
 * Singleton manager — one pool per active connection ID.
 * Pools are created on first use and destroyed on disconnect.
 */
class ConnectionManager {
  private readonly pools = new Map<string, PoolEntry>()

  async getPool(id: string, opts: PoolOptions): Promise<PgPool | MySQLPool | OraclePool> {
    const existing = this.pools.get(id)
    if (existing) return existing.pool

    const entry = await this.createPool(id, opts)
    this.pools.set(id, entry)
    return entry.pool
  }

  async release(id: string): Promise<void> {
    const entry = this.pools.get(id)
    if (!entry) return

    try {
      if (entry.driver === 'oracle') {
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
        host: opts.host,
        port: opts.port,
        ...(opts.database ? { database: opts.database } : {}),
        user: opts.username,
        password: opts.password,
        ...(opts.ssl ? { ssl: {} } : {}),
        connectionLimit: 5,
        connectTimeout: 10_000,
      })
      logger.info({ connectionId: id, driver: 'mysql' }, 'Pool created')
      return { driver: 'mysql', pool }
    } else {
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
    }
  }
}

export type PoolOptions = {
  driver: 'postgresql' | 'mysql' | 'oracle'
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: boolean
}

export const connectionManager = new ConnectionManager()

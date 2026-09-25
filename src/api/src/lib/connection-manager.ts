import type { Pool as PgPool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { Pool as OraclePool } from 'oracledb'
import type { Client as LibSQLClient } from '@libsql/client'
import type { Trino } from 'trino-client'
import type { MongoClient } from 'mongodb'
import type { ConnectionPool as MssqlPool } from 'mssql'
import type { DbDriver } from '@dblumi/shared'
import type { SnowflakeClient } from './snowflake.js'
import type { RedisConn } from './redis.js'
import { logger } from '../logger.js'

type PoolEntry =
  | { driver: 'postgresql'; pool: PgPool }
  | { driver: 'mysql'; pool: MySQLPool }
  | { driver: 'oracle'; pool: OraclePool }
  | { driver: 'sqlite'; client: LibSQLClient }
  // `database` records the target the live client was built with. For Trino and
  // MongoDB, introspection is driven by that value instead of by the pool itself,
  // so `switch-database` (runtime only) must be observable here.
  | { driver: 'trino'; client: Trino; database?: string | undefined }
  | { driver: 'mongodb'; client: MongoClient; database?: string | undefined }
  | { driver: 'snowflake'; client: SnowflakeClient; database?: string | undefined }
  | { driver: 'mssql'; pool: MssqlPool }
  | { driver: 'redis'; client: RedisConn }

export type DbPool = PgPool | MySQLPool | OraclePool | LibSQLClient | Trino | MongoClient | MssqlPool | SnowflakeClient | RedisConn

function handleOf(entry: PoolEntry): DbPool {
  return 'pool' in entry ? entry.pool : entry.client
}

/**
 * Singleton manager — one pool/client per active connection ID.
 * Pools are created on first use and destroyed on disconnect.
 */
class ConnectionManager {
  private readonly pools = new Map<string, PoolEntry>()
  /**
   * Creations in flight. Without it, the requests a freshly opened connection
   * fires in parallel (schema, stats, databases…) each built their own pool and
   * all but the last one leaked.
   */
  private readonly pending = new Map<string, Promise<PoolEntry>>()

  async getPool(id: string, opts: PoolOptions): Promise<DbPool> {
    const existing = this.pools.get(id)
    if (existing) return handleOf(existing)

    let creation = this.pending.get(id)
    if (!creation) {
      const created = this.createPool(id, opts)
      creation = created
      this.pending.set(id, created)
      // Registered before any caller's `await`, so the pool is in the map by the
      // time they resume.
      created.then(
        (entry) => {
          if (this.pending.get(id) === created) {
            this.pending.delete(id)
            this.pools.set(id, entry)
          } else {
            // Released while being created (credentials changed, database switched):
            // never register a pool built from stale options.
            void this.close(id, entry)
          }
        },
        () => {
          if (this.pending.get(id) === created) this.pending.delete(id)
        },
      )
    }
    return handleOf(await creation)
  }

  /**
   * Forgets the pool immediately, then closes it in the background: `pg`'s
   * `end()` waits for every borrowed client, so awaiting it would stall the
   * caller (and hand out a closing pool) for as long as the slowest query runs.
   */
  async release(id: string): Promise<void> {
    this.pending.delete(id)
    const entry = this.pools.get(id)
    if (!entry) return
    this.pools.delete(id)
    void this.close(id, entry)
  }

  has(id: string): boolean {
    return this.pools.has(id)
  }

  /**
   * Target of the LIVE client for drivers whose database is chosen per client:
   * Trino ("catalog" or "catalog/schema"), Snowflake ("DB" or "DB/SCHEMA") and
   * MongoDB (database name).
   *
   * `POST /:id/switch-database` re-creates the client without persisting the new
   * value on the connection row, so these routes must read the target from here
   * first — reading `poolOpts.database` alone would keep returning the stored
   * (possibly empty) value and make the switcher a no-op.
   */
  liveDatabase(id: string): string | undefined {
    const entry = this.pools.get(id)
    return entry?.driver === 'trino' || entry?.driver === 'mongodb' || entry?.driver === 'snowflake' ? entry.database : undefined
  }

  async releaseAll(): Promise<void> {
    const entries = [...this.pools.entries()]
    this.pools.clear()
    this.pending.clear()
    await Promise.allSettled(entries.map(([id, entry]) => this.close(id, entry)))
  }

  private async close(id: string, entry: PoolEntry): Promise<void> {
    try {
      if (entry.driver === 'sqlite') {
        entry.client.close()
      } else if (entry.driver === 'trino') {
        // Stateless HTTP client: nothing to close.
      } else if (entry.driver === 'mongodb') {
        await entry.client.close()
      } else if (entry.driver === 'snowflake') {
        await entry.client.close()
      } else if (entry.driver === 'mssql') {
        await entry.pool.close()
      } else if (entry.driver === 'redis') {
        await entry.client.close()
      } else if (entry.driver === 'oracle') {
        await entry.pool.close(0)
      } else {
        await entry.pool.end()
      }
      logger.info({ connectionId: id }, 'Connection pool released')
    } catch (err) {
      logger.warn({ connectionId: id, err }, 'Error releasing pool')
    }
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
    } else if (opts.driver === 'mongodb') {
      const { createMongoClient } = await import('./mongo.js')
      const client = createMongoClient(opts)
      logger.info({ connectionId: id, driver: 'mongodb' }, 'MongoDB client created')
      return { driver: 'mongodb', client, ...(opts.database ? { database: opts.database } : {}) }
    } else if (opts.driver === 'mssql') {
      const { createMssqlPool } = await import('./mssql.js')
      const pool = await createMssqlPool(opts, (err) => logger.error({ connectionId: id, err }, 'mssql pool error'))
      logger.info({ connectionId: id, driver: 'mssql' }, 'Pool created')
      return { driver: 'mssql', pool }
    } else if (opts.driver === 'snowflake') {
      const { createSnowflakeClient } = await import('./snowflake.js')
      const client = await createSnowflakeClient(opts)
      logger.info({ connectionId: id, driver: 'snowflake' }, 'Snowflake pool created')
      return { driver: 'snowflake', client, ...(opts.database ? { database: opts.database } : {}) }
    } else if (opts.driver === 'redis') {
      const { createRedisClient } = await import('./redis.js')
      const client = await createRedisClient(opts, (err) => logger.warn({ connectionId: id, err }, 'redis client error'))
      logger.info({ connectionId: id, driver: 'redis' }, 'Redis client created')
      return { driver: 'redis', client }
    } else if (opts.driver === 'sqlite') {
      // SQLite via @libsql/client
      const { createClient } = await import('@libsql/client')
      const { assertSqlitePathAllowed, sqliteUrl } = await import('./sqlite-path.js')
      const filePath = opts.filePath ?? ''
      // Checked here too, not only when saving: connections created before the
      // check existed, and test-raw, must not reach the metadata database either.
      assertSqlitePathAllowed(filePath)
      const client = createClient({ url: sqliteUrl(filePath) })
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
  driver: DbDriver
  // PostgreSQL / MySQL / Oracle / Trino / MongoDB
  /** MongoDB: a hostname, or a credential-free `mongodb[+srv]://` URI. */
  host?: string | undefined
  port?: number | undefined
  /** PostgreSQL/MySQL/Oracle/MongoDB: database name. Trino: "catalog" or "catalog/schema". */
  database?: string | undefined
  username?: string | undefined
  password?: string | undefined
  ssl?: boolean | undefined
  // SQLite
  filePath?: string | undefined
  /** Driver-specific settings (Snowflake warehouse and role). */
  options?: Record<string, string> | undefined
}

export const connectionManager = new ConnectionManager()

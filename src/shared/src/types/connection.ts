import { z } from 'zod'

export const DbDriverSchema = z.enum(['postgresql', 'mysql', 'oracle', 'sqlite', 'trino', 'mongodb', 'mssql', 'snowflake', 'redis'])
export type DbDriver = z.infer<typeof DbDriverSchema>

/** Non-secret, driver-specific connection settings (secrets always go to the encrypted password). */
export const ConnectionOptionsSchema = z.record(z.string().max(64), z.string().max(256))
export type ConnectionOptions = z.infer<typeof ConnectionOptionsSchema>

export const ConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  driver: DbDriverSchema,
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  // PostgreSQL/MySQL/Oracle/MongoDB: database name. Trino: target "catalog" or "catalog/schema".
  // MongoDB: host may also be a credential-free mongodb[+srv]:// URI (Atlas, replica sets).
  // Snowflake: host = account identifier, database = "DB" or "DB/SCHEMA". Redis: database = index.
  // SQL Server: host may be `server\instance` (named instance, no port).
  database: z.string().optional(),
  username: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  // password stored encrypted — never returned to client
  ssl: z.boolean().default(false),
  /** Driver-specific settings with no dedicated column (Snowflake warehouse and role). */
  options: ConnectionOptionsSchema.optional(),
  color: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Connection = z.infer<typeof ConnectionSchema>

export const CreateConnectionSchema = ConnectionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  password: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.driver === 'sqlite') {
    if (!val.filePath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'filePath is required for SQLite', path: ['filePath'] })
    }
  } else {
    if (!val.host) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'host is required', path: ['host'] })
    // Snowflake is reached by account identifier, a MongoDB or Redis URI carries its own port.
    const portless = val.driver === 'snowflake'
      || (val.driver === 'mongodb' && /^mongodb(\+srv)?:\/\//i.test(val.host ?? ''))
      || (val.driver === 'redis' && /^rediss?:\/\//i.test(val.host ?? ''))
    if (!val.port && !portless) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'port is required', path: ['port'] })
    // MongoDB and Redis servers may run without authentication.
    if (!val.username && val.driver !== 'mongodb' && val.driver !== 'redis') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'username is required', path: ['username'] })
    }
  }
})
export type CreateConnection = z.infer<typeof CreateConnectionSchema>

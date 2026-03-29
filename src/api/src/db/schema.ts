import { sql } from 'drizzle-orm'
import {
  sqliteTable,
  text,
  integer,
  blob,
} from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),                       // null for OAuth users
  role: text('role', { enum: ['admin', 'editor', 'viewer'] })
    .notNull()
    .default('viewer'),
  avatarUrl: text('avatar_url'),
  oauthProvider: text('oauth_provider'),
  oauthProviderId: text('oauth_provider_id'),
  anthropicApiKey: blob('anthropic_api_key'),                // encrypted AES-256
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  driver: text('driver', { enum: ['postgresql', 'mysql'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  database: text('database').notNull(),
  username: text('username').notNull(),
  passwordEncrypted: blob('password_encrypted').notNull(),   // AES-256-GCM
  ssl: integer('ssl', { mode: 'boolean' }).notNull().default(false),
  color: text('color'),
  environment: text('environment'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const savedQueries = sqliteTable('saved_queries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sql: text('sql').notNull(),
  description: text('description'),
  folder: text('folder'),
  sortOrder: integer('sort_order'),
  connectionId: text('connection_id').references(() => connections.id, {
    onDelete: 'set null',
  }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const revokedTokens = sqliteTable('revoked_tokens', {
  jti: text('jti').primaryKey(),
  expiresAt: text('expires_at').notNull(),
})

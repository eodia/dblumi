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
  language: text('language').default('fr'),
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
  driver: text('driver', { enum: ['postgresql', 'mysql', 'oracle'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  database: text('database').notNull(),
  username: text('username').notNull(),
  passwordEncrypted: blob('password_encrypted').notNull(),   // AES-256-GCM
  ssl: integer('ssl', { mode: 'boolean' }).notNull().default(false),
  color: text('color'),
  environment: text('environment'),
  visibility: text('visibility', { enum: ['private', 'public'] }).notNull().default('private'),
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

export const savedQueryVersions = sqliteTable('saved_query_versions', {
  id: text('id').primaryKey(),
  queryId: text('query_id')
    .notNull()
    .references(() => savedQueries.id, { onDelete: 'cascade' }),
  sql: text('sql').notNull(),
  label: text('label'),
  editedBy: text('edited_by')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const collabMessages = sqliteTable('collab_messages', {
  id: text('id').primaryKey(),
  queryId: text('query_id')
    .notNull()
    .references(() => savedQueries.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  content: text('content').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const revokedTokens = sqliteTable('revoked_tokens', {
  jti: text('jti').primaryKey(),
  expiresAt: text('expires_at').notNull(),
})

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const userGroups = sqliteTable('user_groups', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
})

export const connectionGroups = sqliteTable('connection_groups', {
  connectionId: text('connection_id')
    .notNull()
    .references(() => connections.id, { onDelete: 'cascade' }),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
})

export const connectionUsers = sqliteTable('connection_users', {
  connectionId: text('connection_id')
    .notNull()
    .references(() => connections.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
})

export const queryGroups = sqliteTable('query_groups', {
  queryId: text('query_id')
    .notNull()
    .references(() => savedQueries.id, { onDelete: 'cascade' }),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  collaborative: integer('collaborative', { mode: 'boolean' }).notNull().default(false),
})

export const queryUsers = sqliteTable('query_users', {
  queryId: text('query_id')
    .notNull()
    .references(() => savedQueries.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  collaborative: integer('collaborative', { mode: 'boolean' }).notNull().default(false),
})

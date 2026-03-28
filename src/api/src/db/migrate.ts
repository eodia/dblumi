import { migrate } from 'drizzle-orm/libsql/migrator'
import { db } from './index.js'
import { logger } from '../logger.js'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../migrations'
)

export async function runMigrations() {
  logger.info('Running database migrations…')
  await migrate(db, { migrationsFolder })
  logger.info('Migrations complete')
}

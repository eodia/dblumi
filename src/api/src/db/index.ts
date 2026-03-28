import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config } from '../config.js'
import { logger } from '../logger.js'
import * as schema from './schema.js'

function createDatabase() {
  const absolutePath = resolve(config.DATABASE_PATH)
  mkdirSync(dirname(absolutePath), { recursive: true })

  const client = createClient({
    url: `file:${absolutePath}`,
  })

  logger.info({ path: absolutePath }, 'SQLite database opened')

  return drizzle(client, { schema })
}

export const db = createDatabase()
export type Db = typeof db

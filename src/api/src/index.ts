import { serve } from '@hono/node-server'
import { config } from './config.js'
import { logger } from './logger.js'
import { app } from './app.js'
import { runMigrations } from './db/migrate.js'

async function main() {
  await runMigrations()

  serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      logger.info(
        { port: info.port, url: config.BASE_URL },
        `🚀 dblumi API listening on port ${info.port}`
      )
    }
  )
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error')
  process.exit(1)
})

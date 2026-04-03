import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import { logger } from './logger.js'
import { app } from './app.js'
import { runMigrations } from './db/migrate.js'
import { authenticateCollabUser } from './collab/collab-auth.js'
import { handleCollabConnection } from './collab/collab-server.js'

async function main() {
  await runMigrations()

  const server = serve(
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

  // WebSocket server for collaborative editing
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`)
    const match = url.pathname.match(/^\/ws\/collab\/([a-f0-9-]+)$/)

    if (!match) {
      socket.destroy()
      return
    }

    const queryId = match[1]!
    const token = url.searchParams.get('token')

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const user = await authenticateCollabUser(token, queryId)
    if (!user) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const clientId = Math.floor(Math.random() * 2147483647)
      logger.info({ queryId, userId: user.userId }, 'Collab WebSocket connected')
      handleCollabConnection(ws, queryId, clientId)
    })
  })
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error')
  process.exit(1)
})

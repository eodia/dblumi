import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { health } from './routes/health.js'
import { logger as httpLogger } from 'hono/logger'

const app = new Hono()

// Logger
app.use('*', httpLogger())

// CORS (dev only — in prod, same origin)
if (process.env['NODE_ENV'] !== 'production') {
  app.use(
    '/api/*',
    cors({
      origin: 'http://localhost:5173',
      credentials: true,
    })
  )
}

// API routes
app.route('/api/health', health)

// Serve frontend static files (production)
app.use(
  '/*',
  serveStatic({
    root: './public',
  })
)

// SPA fallback — serve index.html for all unmatched routes
app.get('*', serveStatic({ path: './public/index.html' }))

export { app }

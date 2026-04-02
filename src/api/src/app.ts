import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { logger as httpLogger } from 'hono/logger'
import { health } from './routes/health.js'
import { auth } from './routes/auth.js'
import { connectionsRouter } from './routes/connections.js'
import { queryRouter } from './routes/query.js'
import { savedQueriesRouter } from './routes/saved-queries.js'
import { copilotRouter } from './routes/copilot.js'
import { adminRouter } from './routes/admin.js'
import { sharingRouter } from './routes/sharing.js'

const app = new Hono()

// ── Logging ───────────────────────────────────
app.use('*', httpLogger())

// ── CORS (dev only) ───────────────────────────
if (process.env['NODE_ENV'] !== 'production') {
  app.use(
    '/api/*',
    cors({
      origin: ['http://localhost:5173', 'http://localhost:5174'],
      credentials: true,
    })
  )
}

// ── Error handler ─────────────────────────────
app.onError((err, c) => {
  const status = 'status' in err ? (err.status as number) : 500
  const message = status >= 500 ? 'Internal server error' : err.message
  return c.json(
    { type: `https://dblumi.dev/errors/${status}`, title: message, status },
    status as Parameters<typeof c.json>[1]
  )
})

// ── API routes ────────────────────────────────
app.route('/api/health', health)
app.route('/api/v1/auth', auth)
app.route('/api/v1/connections', connectionsRouter)
app.route('/api/v1/query', queryRouter)
app.route('/api/v1/saved-queries', savedQueriesRouter)
app.route('/api/v1/copilot', copilotRouter)
app.route('/api/v1/admin', adminRouter)
app.route('/api/v1/sharing', sharingRouter)

// ── Static files (production) ─────────────────
app.use('/*', serveStatic({ root: './public' }))
app.get('*', serveStatic({ path: './public/index.html' }))

export { app }

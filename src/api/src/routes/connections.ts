import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  ConnectionError,
} from '../services/connection.service.js'
import type { AuthVariables } from '../middleware/auth.js'

const connectionsRouter = new Hono<AuthVariables>()

// All routes require auth
connectionsRouter.use('*', authMiddleware)

// ──────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  driver: z.enum(['postgresql', 'mysql']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string(),
  ssl: z.boolean().default(false),
  color: z.string().optional(),
})

const UpdateSchema = CreateSchema.partial()

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function problem(status: number, title: string, detail?: string) {
  return { type: `https://dblumi.dev/errors/${status}`, title, status, detail }
}

function handleError(e: unknown, c: Parameters<typeof problem>[0]) {
  if (e instanceof ConnectionError) {
    const status = e.code === 'NOT_FOUND' ? 404 : 400
    return { status, body: problem(status, e.message) }
  }
  throw e
}

// ──────────────────────────────────────────────
// GET /connections
// ──────────────────────────────────────────────

connectionsRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const list = await listConnections(userId)
  return c.json({ connections: list })
})

// ──────────────────────────────────────────────
// GET /connections/:id
// ──────────────────────────────────────────────

connectionsRouter.get('/:id', async (c) => {
  const userId = c.get('userId')
  try {
    const conn = await getConnection(c.req.param('id'), userId)
    return c.json({ connection: conn })
  } catch (e) {
    if (e instanceof ConnectionError)
      return c.json(problem(404, e.message), 404)
    throw e
  }
})

// ──────────────────────────────────────────────
// POST /connections
// ──────────────────────────────────────────────

connectionsRouter.post(
  '/',
  zValidator('json', CreateSchema),
  async (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')
    const conn = await createConnection({ ...body, color: body.color ?? null }, userId)
    return c.json({ connection: conn }, 201)
  }
)

// ──────────────────────────────────────────────
// PUT /connections/:id
// ──────────────────────────────────────────────

connectionsRouter.put(
  '/:id',
  zValidator('json', UpdateSchema),
  async (c) => {
    const userId = c.get('userId')
    const raw = c.req.valid('json')
    // Strip undefined keys so exactOptionalPropertyTypes is satisfied
    const body = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== undefined)
    ) as Parameters<typeof updateConnection>[1]
    try {
      const conn = await updateConnection(c.req.param('id'), body, userId)
      return c.json({ connection: conn })
    } catch (e) {
      if (e instanceof ConnectionError)
        return c.json(problem(404, e.message), 404)
      throw e
    }
  }
)

// ──────────────────────────────────────────────
// DELETE /connections/:id
// ──────────────────────────────────────────────

connectionsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  try {
    await deleteConnection(c.req.param('id'), userId)
    return c.body(null, 204)
  } catch (e) {
    if (e instanceof ConnectionError)
      return c.json(problem(404, e.message), 404)
    throw e
  }
})

// ──────────────────────────────────────────────
// POST /connections/:id/test
// ──────────────────────────────────────────────

connectionsRouter.post('/:id/test', async (c) => {
  const userId = c.get('userId')
  try {
    const result = await testConnection(c.req.param('id'), userId)
    return c.json(result, result.ok ? 200 : 502)
  } catch (e) {
    if (e instanceof ConnectionError)
      return c.json(problem(404, e.message), 404)
    throw e
  }
})

export { connectionsRouter }

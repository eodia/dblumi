import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import {
  listSavedQueries,
  getSavedQuery,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
  reorderSavedQueries,
  SavedQueryError,
} from '../services/saved-query.service.js'
import type { AuthVariables } from '../middleware/auth.js'

const savedQueriesRouter = new Hono<AuthVariables>()
savedQueriesRouter.use('*', authMiddleware)

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  sql: z.string().min(1).max(100_000),
  description: z.string().max(1000).optional(),
  connectionId: z.string().uuid().optional(),
  folder: z.string().max(100).optional(),
  sortOrder: z.number().int().optional(),
})

const UpdateSchema = CreateSchema.partial()

const ReorderSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })),
})

function problem(status: number, title: string) {
  return { type: `https://dblumi.dev/errors/${status}`, title, status }
}

savedQueriesRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const list = await listSavedQueries(userId)
  return c.json({ savedQueries: list })
})

savedQueriesRouter.get('/:id', async (c) => {
  const userId = c.get('userId')
  try {
    const sq = await getSavedQuery(c.req.param('id'), userId)
    return c.json({ savedQuery: sq })
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
})

savedQueriesRouter.post('/', zValidator('json', CreateSchema), async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const sq = await createSavedQuery(
    {
      name: body.name,
      sql: body.sql,
      description: body.description ?? null,
      connectionId: body.connectionId ?? null,
      folder: body.folder ?? null,
      sortOrder: body.sortOrder ?? null,
    },
    userId
  )
  return c.json({ savedQuery: sq }, 201)
})

savedQueriesRouter.put('/:id', zValidator('json', UpdateSchema), async (c) => {
  const userId = c.get('userId')
  const raw = c.req.valid('json')
  const body = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined)
  ) as Parameters<typeof updateSavedQuery>[1]
  try {
    const sq = await updateSavedQuery(c.req.param('id'), body, userId)
    return c.json({ savedQuery: sq })
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
})

savedQueriesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  try {
    await deleteSavedQuery(c.req.param('id'), userId)
    return c.body(null, 204)
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
})

savedQueriesRouter.patch('/reorder', zValidator('json', ReorderSchema), async (c) => {
  const userId = c.get('userId')
  const { items } = c.req.valid('json')
  await reorderSavedQueries(items, userId)
  return c.body(null, 204)
})

export { savedQueriesRouter }

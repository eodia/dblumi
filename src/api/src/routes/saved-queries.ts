import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { queryGroups, queryUsers, groups, users } from '../db/schema.js'
import {
  listSavedQueries,
  getSavedQuery,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
  reorderSavedQueries,
  SavedQueryError,
} from '../services/saved-query.service.js'
import { listVersions, updateVersionLabel } from '../services/saved-query-version.service.js'
import type { AuthVariables } from '../middleware/auth.js'

const savedQueriesRouter = new Hono<AuthVariables>()
savedQueriesRouter.use('*', authMiddleware)

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  sql: z.string().min(1).max(100_000),
  description: z.string().max(1000).optional(),
  connectionId: z.string().uuid().optional(),
  folder: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
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

const SharesSchema = z.object({
  groupIds: z.array(z.string().uuid()),
  userIds: z.array(z.string().uuid()),
})

savedQueriesRouter.get('/:id/shares', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  try {
    await getSavedQuery(id, userId)
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
  const groupRows = await db
    .select({ id: groups.id, name: groups.name, color: groups.color })
    .from(queryGroups)
    .innerJoin(groups, eq(queryGroups.groupId, groups.id))
    .where(eq(queryGroups.queryId, id))
  const userRows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(queryUsers)
    .innerJoin(users, eq(queryUsers.userId, users.id))
    .where(eq(queryUsers.queryId, id))
  return c.json({ groups: groupRows, users: userRows })
})

savedQueriesRouter.put('/:id/shares', zValidator('json', SharesSchema), async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  try {
    await getSavedQuery(id, userId)
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
  const { groupIds, userIds } = c.req.valid('json')

  // Replace query groups
  await db.delete(queryGroups).where(eq(queryGroups.queryId, id))
  if (groupIds.length > 0) {
    await db.insert(queryGroups).values(groupIds.map((groupId) => ({ queryId: id, groupId })))
  }

  // Replace query users
  await db.delete(queryUsers).where(eq(queryUsers.queryId, id))
  if (userIds.length > 0) {
    await db.insert(queryUsers).values(userIds.map((uid) => ({ queryId: id, userId: uid })))
  }

  return c.json({ groupIds, userIds })
})

savedQueriesRouter.get('/:id/versions', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  try {
    await getSavedQuery(id, userId)
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
  const cursor = c.req.query('cursor')
  const limit = Number(c.req.query('limit') ?? '50')
  const result = await listVersions(id, cursor || undefined, Math.min(limit, 100))
  return c.json(result)
})

const UpdateLabelSchema = z.object({
  label: z.string().max(200).nullable(),
})

savedQueriesRouter.patch(
  '/:id/versions/:versionId',
  zValidator('json', UpdateLabelSchema),
  async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    try {
      await getSavedQuery(id, userId)
    } catch (e) {
      if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
      throw e
    }
    const { label } = c.req.valid('json')
    await updateVersionLabel(c.req.param('versionId'), id, label)
    return c.body(null, 204)
  },
)

export { savedQueriesRouter }

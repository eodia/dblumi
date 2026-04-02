import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { users, groups, userGroups } from '../db/schema.js'
import type { AuthVariables } from '../middleware/auth.js'

const adminRouter = new Hono<AuthVariables>()
adminRouter.use('*', authMiddleware)
adminRouter.use('*', adminMiddleware)

// ── GET /admin/users ─────────────────────────────

adminRouter.get('/users', async (c) => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatarUrl: users.avatarUrl,
      language: users.language,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(users.createdAt)

  return c.json({ users: rows })
})

// ── PATCH /admin/users/:id ───────────────────────

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  email: z.string().email().optional(),
})

adminRouter.patch(
  '/users/:id',
  zValidator('json', UpdateUserSchema),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const user = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).get()
    if (!user) return c.json({ type: 'error', message: 'Utilisateur introuvable.' }, 404)

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (body.name !== undefined) updates['name'] = body.name
    if (body.role !== undefined) updates['role'] = body.role
    if (body.email !== undefined) updates['email'] = body.email

    await db.update(users).set(updates).where(eq(users.id, id))

    const updated = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        avatarUrl: users.avatarUrl,
        language: users.language,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .get()

    return c.json({ user: updated })
  },
)

// ── DELETE /admin/users/:id ──────────────────────

adminRouter.delete('/users/:id', async (c) => {
  const id = c.req.param('id')
  const currentUserId = c.get('userId')

  if (id === currentUserId) {
    return c.json({ type: 'error', message: 'Vous ne pouvez pas supprimer votre propre compte.' }, 400)
  }

  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).get()
  if (!user) return c.json({ type: 'error', message: 'Utilisateur introuvable.' }, 404)

  await db.delete(users).where(eq(users.id, id))
  return c.body(null, 204)
})

// ── GET /admin/groups ────────────────────────────

adminRouter.get('/groups', async (c) => {
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      color: groups.color,
      createdAt: groups.createdAt,
      updatedAt: groups.updatedAt,
      memberCount: count(userGroups.userId),
    })
    .from(groups)
    .leftJoin(userGroups, eq(groups.id, userGroups.groupId))
    .groupBy(groups.id)
    .orderBy(groups.createdAt)

  return c.json({ groups: rows })
})

// ── POST /admin/groups ───────────────────────────

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
})

adminRouter.post(
  '/groups',
  zValidator('json', CreateGroupSchema),
  async (c) => {
    const body = c.req.valid('json')
    const id = randomUUID()
    const now = new Date().toISOString()

    await db.insert(groups).values({
      id,
      name: body.name,
      description: body.description ?? null,
      color: body.color ?? null,
      createdAt: now,
      updatedAt: now,
    })

    const created = await db
      .select()
      .from(groups)
      .where(eq(groups.id, id))
      .get()

    return c.json({ group: created }, 201)
  },
)

// ── PATCH /admin/groups/:id ──────────────────────

const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
})

adminRouter.patch(
  '/groups/:id',
  zValidator('json', UpdateGroupSchema),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const group = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).get()
    if (!group) return c.json({ type: 'error', message: 'Groupe introuvable.' }, 404)

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (body.name !== undefined) updates['name'] = body.name
    if (body.description !== undefined) updates['description'] = body.description
    if (body.color !== undefined) updates['color'] = body.color

    await db.update(groups).set(updates).where(eq(groups.id, id))

    const updated = await db
      .select()
      .from(groups)
      .where(eq(groups.id, id))
      .get()

    return c.json({ group: updated })
  },
)

// ── DELETE /admin/groups/:id ─────────────────────

adminRouter.delete('/groups/:id', async (c) => {
  const id = c.req.param('id')

  const group = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).get()
  if (!group) return c.json({ type: 'error', message: 'Groupe introuvable.' }, 404)

  await db.delete(groups).where(eq(groups.id, id))
  return c.body(null, 204)
})

// ── GET /admin/groups/:id/members ────────────────

adminRouter.get('/groups/:id/members', async (c) => {
  const id = c.req.param('id')

  const group = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).get()
  if (!group) return c.json({ type: 'error', message: 'Groupe introuvable.' }, 404)

  const members = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatarUrl: users.avatarUrl,
    })
    .from(userGroups)
    .innerJoin(users, eq(userGroups.userId, users.id))
    .where(eq(userGroups.groupId, id))
    .orderBy(users.name)

  return c.json({ members })
})

// ── POST /admin/groups/:id/members ───────────────

const AddMembersSchema = z.object({
  userIds: z.array(z.string()).min(1),
})

adminRouter.post(
  '/groups/:id/members',
  zValidator('json', AddMembersSchema),
  async (c) => {
    const id = c.req.param('id')
    const { userIds } = c.req.valid('json')

    const group = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).get()
    if (!group) return c.json({ type: 'error', message: 'Groupe introuvable.' }, 404)

    for (const userId of userIds) {
      const user = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()
      if (!user) continue

      const existing = await db
        .select()
        .from(userGroups)
        .where(and(eq(userGroups.groupId, id), eq(userGroups.userId, userId)))
        .get()

      if (!existing) {
        await db.insert(userGroups).values({ groupId: id, userId })
      }
    }

    return c.json({ success: true }, 201)
  },
)

// ── DELETE /admin/groups/:id/members/:userId ─────

adminRouter.delete('/groups/:id/members/:userId', async (c) => {
  const id = c.req.param('id')
  const userId = c.req.param('userId')

  const membership = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.groupId, id), eq(userGroups.userId, userId)))
    .get()

  if (!membership) return c.json({ type: 'error', message: 'Membre introuvable dans ce groupe.' }, 404)

  await db.delete(userGroups).where(and(eq(userGroups.groupId, id), eq(userGroups.userId, userId)))
  return c.body(null, 204)
})

// ── GET /admin/users/:id/groups ──────────────────

adminRouter.get('/users/:id/groups', async (c) => {
  const userId = c.req.param('id')
  const rows = await db
    .select({ id: groups.id, name: groups.name, color: groups.color })
    .from(userGroups)
    .innerJoin(groups, eq(userGroups.groupId, groups.id))
    .where(eq(userGroups.userId, userId))
  return c.json({ groups: rows })
})

// ── PUT /admin/users/:id/groups ──────────────────

adminRouter.put(
  '/users/:id/groups',
  zValidator('json', z.object({ groupIds: z.array(z.string()) })),
  async (c) => {
    const userId = c.req.param('id')
    const { groupIds } = c.req.valid('json')
    await db.delete(userGroups).where(eq(userGroups.userId, userId))
    for (const groupId of groupIds) {
      await db.insert(userGroups).values({ userId, groupId }).onConflictDoNothing()
    }
    return c.json({ groupIds })
  },
)

export { adminRouter }

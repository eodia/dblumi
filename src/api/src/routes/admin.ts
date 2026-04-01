import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
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

export { adminRouter }

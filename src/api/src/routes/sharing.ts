import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { groups, users, userGroups } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import type { AuthVariables } from '../middleware/auth.js'

const sharingRouter = new Hono<AuthVariables>()
sharingRouter.use('*', authMiddleware)

// GET /sharing/groups — all groups the user belongs to + all groups (for admins)
sharingRouter.get('/groups', async (c) => {
  const userId = c.get('userId')
  const userRole = c.get('userRole')

  if (userRole === 'admin') {
    // Admins see all groups
    const rows = await db.select({ id: groups.id, name: groups.name, color: groups.color }).from(groups)
    return c.json({ groups: rows })
  }

  // Non-admins see groups they belong to
  const rows = await db
    .select({ id: groups.id, name: groups.name, color: groups.color })
    .from(userGroups)
    .innerJoin(groups, eq(userGroups.groupId, groups.id))
    .where(eq(userGroups.userId, userId))

  return c.json({ groups: rows })
})

// GET /sharing/users — all users (for sharing purposes)
sharingRouter.get('/users', async (c) => {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .orderBy(users.name)

  return c.json({ users: rows })
})

export { sharingRouter }

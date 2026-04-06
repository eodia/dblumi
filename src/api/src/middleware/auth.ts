import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import { verifyToken, extractToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../services/auth.service.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import type { UserRole } from '@dblumi/shared'

export type AuthVariables = {
  Variables: {
    userId: string
    userEmail: string
    userRole: UserRole
    jti: string
  }
}

export const authMiddleware = createMiddleware<AuthVariables>(async (c, next) => {
  const token = extractToken(c.req.raw)

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' })
  }

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }

  // Revocation check
  if (payload.jti && await isTokenRevoked(payload.jti)) {
    throw new HTTPException(401, { message: 'Token has been revoked' })
  }

  // Password change invalidation: reject tokens issued before password was changed
  if (payload.iat) {
    const user = await db
      .select({ passwordChangedAt: users.passwordChangedAt })
      .from(users)
      .where(eq(users.id, payload.sub))
      .get()

    if (user?.passwordChangedAt) {
      const changedAtMs = new Date(user.passwordChangedAt).getTime()
      const issuedAtMs = payload.iat * 1000
      if (issuedAtMs < changedAtMs) {
        throw new HTTPException(401, { message: 'Password has been changed, please log in again' })
      }
    }
  }

  c.set('userId', payload.sub)
  c.set('userEmail', payload.email)
  c.set('userRole', payload.role)
  c.set('jti', payload.jti)

  await next()
})

export const adminMiddleware = createMiddleware<AuthVariables>(async (c, next) => {
  const role = c.get('userRole')
  if (role !== 'admin') {
    throw new HTTPException(403, { message: 'Admin access required' })
  }
  await next()
})

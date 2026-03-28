import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { verifyToken, extractToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../services/auth.service.js'
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

  c.set('userId', payload.sub)
  c.set('userEmail', payload.email)
  c.set('userRole', payload.role)
  c.set('jti', payload.jti)

  await next()
})

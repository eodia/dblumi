import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { jwtVerify, type JWTPayload } from 'jose'
import { config } from '../config.js'
import type { UserRole } from '@dblumi/shared'

type AuthEnv = {
  Variables: {
    userId: string
    userEmail: string
    userRole: UserRole
  }
}

const secret = new TextEncoder().encode(config.JWT_SECRET)

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const cookieToken = getCookie(c.req.raw)

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookieToken

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' })
  }

  let payload: JWTPayload
  try {
    const result = await jwtVerify(token, secret)
    payload = result.payload
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }

  c.set('userId', payload['sub'] as string)
  c.set('userEmail', payload['email'] as string)
  c.set('userRole', payload['role'] as UserRole)

  await next()
})

function getCookie(request: Request): string | undefined {
  const cookie = request.headers.get('cookie')
  if (!cookie) return undefined
  const match = cookie.match(/dblumi_token=([^;]+)/)
  return match?.[1]
}

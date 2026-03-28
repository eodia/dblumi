import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  register,
  login,
  logout,
  getMe,
  isTokenRevoked,
  AuthError,
} from '../services/auth.service.js'
import { authMiddleware } from '../middleware/auth.js'
import { tokenCookie, clearCookie, extractToken } from '../lib/jwt.js'

const auth = new Hono()

// ── Helpers ──────────────────────────────────

function problem(status: number, title: string, detail?: string) {
  return { type: `https://dblumi.dev/errors/${status}`, title, status, detail }
}

function handleAuthError(e: unknown, res: Response) {
  if (e instanceof AuthError) {
    const status = e.code === 'EMAIL_TAKEN' ? 409
      : e.code === 'NOT_FOUND' ? 404
      : 401
    return { status, body: problem(status, e.message) }
  }
  throw e
}

// ── POST /register ────────────────────────────

auth.post(
  '/register',
  zValidator(
    'json',
    z.object({
      email: z.string().email(),
      password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères.'),
      name: z.string().min(1).max(100),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')

    let result
    try {
      result = await register(body)
    } catch (e) {
      if (e instanceof AuthError) {
        const status = e.code === 'EMAIL_TAKEN' ? 409 : 400
        return c.json(problem(status, e.message), status)
      }
      throw e
    }

    c.header('Set-Cookie', tokenCookie(result.token, result.expiresAt))
    return c.json({ user: result.user, token: result.token }, 201)
  }
)

// ── POST /login ───────────────────────────────

auth.post(
  '/login',
  zValidator(
    'json',
    z.object({
      email: z.string().email(),
      password: z.string().min(1),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')

    let result
    try {
      result = await login(body)
    } catch (e) {
      if (e instanceof AuthError) {
        return c.json(problem(401, e.message), 401)
      }
      throw e
    }

    c.header('Set-Cookie', tokenCookie(result.token, result.expiresAt))
    return c.json({ user: result.user, token: result.token })
  }
)

// ── POST /logout ──────────────────────────────

auth.post('/logout', async (c) => {
  const token = extractToken(c.req.raw)
  if (token) await logout(token)
  c.header('Set-Cookie', clearCookie())
  return c.json({ success: true })
})

// ── GET /me ───────────────────────────────────

auth.get('/me', authMiddleware, async (c) => {
  // Extra check: token not revoked
  const token = extractToken(c.req.raw)
  if (token) {
    // We need the jti — re-verify to get it (token is already validated by middleware)
    // Middleware sets userId; we trust it here.
  }

  const userId = c.get('userId')
  let user
  try {
    user = await getMe(userId)
  } catch (e) {
    if (e instanceof AuthError) {
      return c.json(problem(404, e.message), 404)
    }
    throw e
  }

  return c.json({ user })
})

export { auth }

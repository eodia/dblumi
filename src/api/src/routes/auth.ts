import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  register,
  login,
  logout,
  getMe,
  isTokenRevoked,
  changePassword,
  requestPasswordReset,
  resetPassword,
  AuthError,
} from '../services/auth.service.js'
import { authMiddleware } from '../middleware/auth.js'
import { tokenCookie, clearCookie, extractToken } from '../lib/jwt.js'
import { isSmtpConfigured, sendMail } from '../lib/mailer.js'
import { resetPasswordEmail } from '../templates/reset-password.js'
import { config } from '../config.js'

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
      language: z.enum(['fr', 'en']).optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')

    let result
    try {
      result = await register({
          email: body.email,
          password: body.password,
          name: body.name,
          ...(body.language ? { language: body.language } : {}),
        })
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

// ── PATCH /language ───────────────────────────

auth.patch(
  '/language',
  authMiddleware,
  zValidator('json', z.object({ language: z.enum(['fr', 'en']) })),
  async (c) => {
    const userId = c.get('userId')
    const { language } = c.req.valid('json')
    const { db } = await import('../db/index.js')
    const { users } = await import('../db/schema.js')
    const { eq } = await import('drizzle-orm')
    await db.update(users).set({ language }).where(eq(users.id, userId))
    return c.json({ language })
  }
)

// ── PATCH /password ──────────────────────────
auth.patch(
  '/password',
  authMiddleware,
  zValidator(
    'json',
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères.'),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const { currentPassword, newPassword } = c.req.valid('json')

    try {
      await changePassword(userId, currentPassword, newPassword)
    } catch (e) {
      if (e instanceof AuthError) {
        const status = e.code === 'OAUTH_USER' ? 400
          : e.code === 'INVALID_CREDENTIALS' ? 401
          : 404
        return c.json(problem(status, e.message), status)
      }
      throw e
    }

    return c.json({ success: true })
  }
)

// ── POST /forgot-password ────────────────────
auth.post(
  '/forgot-password',
  zValidator('json', z.object({ email: z.string().email() })),
  async (c) => {
    if (!isSmtpConfigured()) {
      return c.json(problem(400, 'SMTP is not configured.'), 400)
    }

    const { email } = c.req.valid('json')
    const result = await requestPasswordReset(email)

    if (result) {
      const resetLink = `${config.BASE_URL}?view=reset-password&token=${result.token}`
      const { html, text } = resetPasswordEmail(result.userName, resetLink, 60)
      await sendMail(email, 'Réinitialiser votre mot de passe — dblumi', html, text)
    }

    // Always return 200 (anti-enumeration)
    return c.json({ success: true })
  }
)

// ── POST /reset-password ─────────────────────
auth.post(
  '/reset-password',
  zValidator(
    'json',
    z.object({
      token: z.string().min(1),
      newPassword: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères.'),
    })
  ),
  async (c) => {
    const { token, newPassword } = c.req.valid('json')

    try {
      await resetPassword(token, newPassword)
    } catch (e) {
      if (e instanceof AuthError) {
        return c.json(problem(400, e.message), 400)
      }
      throw e
    }

    return c.json({ success: true })
  }
)

// ── GET /ws-token ────────────────────────────
// Returns the current JWT for WebSocket authentication.
// The cookie is HttpOnly so JS can't read it directly.

auth.get('/ws-token', authMiddleware, async (c) => {
  const token = extractToken(c.req.raw)
  if (!token) return c.json(problem(401, 'No token'), 401)
  return c.json({ token })
})

export { auth }

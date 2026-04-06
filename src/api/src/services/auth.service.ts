import { hash, verify } from '@node-rs/argon2'
import { eq, count } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users, revokedTokens, passwordResetTokens } from '../db/schema.js'
import { signToken, verifyToken } from '../lib/jwt.js'
import type { UserRole } from '@dblumi/shared'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type AuthUser = {
  id: string
  email: string
  name: string
  role: UserRole
  avatarUrl: string | null
  language: string
  createdAt: string
  hasPassword: boolean
}

export type AuthResult = {
  token: string
  expiresAt: Date
  user: AuthUser
}

// ──────────────────────────────────────────────
// Register
// ──────────────────────────────────────────────

export async function register(input: {
  email: string
  password: string
  name: string
  language?: string
}): Promise<AuthResult> {
  // Check for existing user
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .get()

  if (existing) {
    throw new AuthError('EMAIL_TAKEN', 'Cette adresse email est déjà utilisée.')
  }

  // First user becomes admin
  const countResult = await db.select({ total: count() }).from(users)
  const total = countResult[0]?.total ?? 0
  const role: UserRole = total === 0 ? 'admin' : 'viewer'

  const id = crypto.randomUUID()
  const passwordHash = await hash(input.password)
  const now = new Date().toISOString()

  const language = input.language ?? 'fr'

  await db.insert(users).values({
    id,
    email: input.email.toLowerCase(),
    name: input.name,
    passwordHash,
    role,
    language,
    createdAt: now,
    updatedAt: now,
  })

  const token = await signToken({ sub: id, email: input.email.toLowerCase(), role })
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  return {
    token,
    expiresAt,
    user: { id, email: input.email.toLowerCase(), name: input.name, role, avatarUrl: null, language, createdAt: now, hasPassword: true },
  }
}

// ──────────────────────────────────────────────
// Login
// ──────────────────────────────────────────────

export async function login(input: {
  email: string
  password: string
}): Promise<AuthResult> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .get()

  if (!user || !user.passwordHash) {
    throw new AuthError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.')
  }

  const valid = await verify(user.passwordHash, input.password)
  if (!valid) {
    throw new AuthError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.')
  }

  const token = await signToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  })
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      language: user.language ?? 'fr',
      createdAt: user.createdAt,
      hasPassword: true,
    },
  }
}

// ──────────────────────────────────────────────
// Logout (revoke JWT)
// ──────────────────────────────────────────────

export async function logout(token: string): Promise<void> {
  let payload: Awaited<ReturnType<typeof verifyToken>>
  try {
    payload = await verifyToken(token)
  } catch {
    return // already invalid — silently succeed
  }

  if (payload.jti && payload.exp) {
    await db
      .insert(revokedTokens)
      .values({
        jti: payload.jti,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
      })
      .onConflictDoNothing()
  }
}

// ──────────────────────────────────────────────
// Get current user
// ──────────────────────────────────────────────

export async function getMe(userId: string): Promise<AuthUser> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (!user) {
    throw new AuthError('NOT_FOUND', 'Utilisateur introuvable.')
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl,
    language: user.language ?? 'fr',
    createdAt: user.createdAt,
    hasPassword: user.passwordHash !== null,
  }
}

// ──────────────────────────────────────────────
// Check if token is revoked
// ──────────────────────────────────────────────

export async function isTokenRevoked(jti: string): Promise<boolean> {
  const row = await db
    .select({ jti: revokedTokens.jti })
    .from(revokedTokens)
    .where(eq(revokedTokens.jti, jti))
    .get()
  return row !== undefined
}

// ──────────────────────────────────────────────
// Change password
// ──────────────────────────────────────────────

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get()

  if (!user) {
    throw new AuthError('NOT_FOUND', 'Utilisateur introuvable.')
  }

  if (!user.passwordHash) {
    throw new AuthError('OAUTH_USER', 'Password managed by external provider.')
  }

  const valid = await verify(user.passwordHash, currentPassword)
  if (!valid) {
    throw new AuthError('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect.')
  }

  const newHash = await hash(newPassword)
  const now = new Date().toISOString()

  await db
    .update(users)
    .set({ passwordHash: newHash, passwordChangedAt: now, updatedAt: now })
    .where(eq(users.id, userId))
}

// ──────────────────────────────────────────────
// Request password reset
// ──────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<{ token: string; userName: string } | null> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get()

  // Return null silently for non-existent users or OAuth-only users (anti-enumeration)
  if (!user || !user.passwordHash) return null

  // Delete any existing tokens for this user
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))

  // Generate token and store hash
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(tokenHashBuffer), (b) => b.toString(16).padStart(2, '0')).join('')

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000) // 1 hour

  await db.insert(passwordResetTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  })

  return { token, userName: user.name }
}

// ──────────────────────────────────────────────
// Reset password (with token)
// ──────────────────────────────────────────────

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<void> {
  // Hash the incoming token
  const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(tokenHashBuffer), (b) => b.toString(16).padStart(2, '0')).join('')

  const resetToken = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .get()

  if (!resetToken) {
    throw new AuthError('INVALID_TOKEN', 'Lien invalide ou expiré.')
  }

  if (resetToken.usedAt) {
    throw new AuthError('INVALID_TOKEN', 'Ce lien a déjà été utilisé.')
  }

  if (new Date(resetToken.expiresAt) < new Date()) {
    throw new AuthError('INVALID_TOKEN', 'Ce lien a expiré.')
  }

  // Update password
  const newHash = await hash(newPassword)
  const now = new Date().toISOString()

  await db
    .update(users)
    .set({ passwordHash: newHash, passwordChangedAt: now, updatedAt: now })
    .where(eq(users.id, resetToken.userId))

  // Mark token as used
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(passwordResetTokens.id, resetToken.id))
}

// ──────────────────────────────────────────────
// Error class
// ──────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

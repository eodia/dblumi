# Password Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password change (authenticated), forgot/reset password (email), and a password strength indicator to dblumi.

**Architecture:** Nodemailer SMTP for email, SHA-256 hashed reset tokens in a new DB table, `passwordChangedAt` column on users for JWT invalidation. Reusable `PasswordStrengthIndicator` component for register + change password forms.

**Tech Stack:** Hono, Drizzle ORM (turso/libsql), Nodemailer, Argon2, jose JWT, React 19, Radix UI Dialog, Tailwind CSS, Zustand, TanStack Query, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-04-06-password-management-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/api/src/lib/mailer.ts` | Nodemailer transporter wrapper + `isSmtpConfigured()` |
| `src/api/src/templates/reset-password.ts` | HTML + text email template for password reset |
| `src/web/src/components/ui/password-strength.tsx` | Reusable password strength indicator bar |
| `src/web/src/components/auth/ChangePasswordDialog.tsx` | Change password modal dialog |

### Modified files
| File | Changes |
|------|---------|
| `src/api/src/config.ts` | Add SMTP env vars to ConfigSchema |
| `src/api/src/db/schema.ts` | Add `passwordResetTokens` table + `passwordChangedAt` on users |
| `src/api/src/middleware/auth.ts` | Add `passwordChangedAt` check vs token `iat` |
| `src/api/src/services/auth.service.ts` | Add `changePassword`, `requestPasswordReset`, `resetPassword`, `hasPassword` on AuthUser |
| `src/api/src/routes/auth.ts` | Add 3 new endpoints |
| `src/api/src/routes/settings.ts` | Add `smtpConfigured` to auth-providers response |
| `src/web/src/api/auth.ts` | Add 3 API methods + `hasPassword` on User type |
| `src/web/src/api/settings.ts` | Add `smtpConfigured` to response type |
| `src/web/src/stores/auth.store.ts` | Add `changePassword` action |
| `src/web/src/pages/LoginPage.tsx` | Add forgot/reset password views |
| `src/web/src/pages/RegisterPage.tsx` | Add PasswordStrengthIndicator |
| `src/web/src/components/layout/AppShell.tsx` | Add change password button in user menu |
| `src/web/src/i18n/fr.ts` | Add all FR translation keys |
| `src/web/src/i18n/en.ts` | Add all EN translation keys |
| `docker-compose.yml` | Add SMTP env vars |
| `docker-compose.dev.yml` | Add SMTP env vars |

---

### Task 1: SMTP Configuration (backend)

**Files:**
- Modify: `src/api/src/config.ts`
- Create: `src/api/src/lib/mailer.ts`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Add SMTP vars to config.ts**

In `src/api/src/config.ts`, add these fields inside the `ConfigSchema` z.object, after the `KEYCLOAK_CLIENT_SECRET` line:

```typescript
  // ── SMTP (optional — required for password reset emails) ──
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
```

- [ ] **Step 2: Create mailer.ts**

Create `src/api/src/lib/mailer.ts`:

```typescript
import { createTransport, type Transporter } from 'nodemailer'
import { config } from '../config.js'

let transporter: Transporter | null = null

export function isSmtpConfigured(): boolean {
  return !!(config.SMTP_HOST && config.SMTP_FROM)
}

function getTransporter(): Transporter {
  if (!transporter) {
    if (!isSmtpConfigured()) {
      throw new Error('SMTP is not configured')
    }
    transporter = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
    })
  }
  return transporter
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<void> {
  await getTransporter().sendMail({
    from: config.SMTP_FROM,
    to,
    subject,
    html,
    text,
  })
}
```

- [ ] **Step 3: Add SMTP vars to docker-compose.yml**

In `docker-compose.yml`, add after the Keycloak SSO block (line 31):

```yaml
      # ── SMTP (password reset) ──
      - SMTP_HOST=${SMTP_HOST:-}
      - SMTP_PORT=${SMTP_PORT:-587}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASS=${SMTP_PASS:-}
      - SMTP_FROM=${SMTP_FROM:-}
```

- [ ] **Step 4: Add SMTP vars to docker-compose.dev.yml**

In `docker-compose.dev.yml`, add after the Keycloak SSO block (line 35):

```yaml
      # ── SMTP (password reset) ──
      - SMTP_HOST=${SMTP_HOST:-}
      - SMTP_PORT=${SMTP_PORT:-587}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASS=${SMTP_PASS:-}
      - SMTP_FROM=${SMTP_FROM:-}
```

- [ ] **Step 5: Install nodemailer**

```bash
cd src/api && npm install nodemailer && npm install -D @types/nodemailer
```

- [ ] **Step 6: Add smtpConfigured to settings endpoint**

In `src/api/src/routes/settings.ts`, modify the file. Add the import at top:

```typescript
import { isSmtpConfigured } from '../lib/mailer.js'
```

The `/auth-providers` endpoint is currently behind `authMiddleware` (applied globally via `settingsRouter.use('*', authMiddleware)`). The login page needs this endpoint to decide whether to show the "Forgot password?" link. Move `authMiddleware` off the global use and apply it per-route instead:

Replace:

```typescript
const settingsRouter = new Hono<AuthVariables>()
settingsRouter.use('*', authMiddleware)

settingsRouter.get('/auth-providers', (c) => {
  return c.json({
    keycloak: !!(config.KEYCLOAK_ISSUER && config.KEYCLOAK_CLIENT_ID && config.KEYCLOAK_CLIENT_SECRET),
    github: !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
    google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  })
})

settingsRouter.get('/copilot-info', (c) => {
```

With:

```typescript
const settingsRouter = new Hono<AuthVariables>()

// Public — needed on login page to show OAuth buttons and forgot-password link
settingsRouter.get('/auth-providers', (c) => {
  return c.json({
    keycloak: !!(config.KEYCLOAK_ISSUER && config.KEYCLOAK_CLIENT_ID && config.KEYCLOAK_CLIENT_SECRET),
    github: !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
    google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
    smtpConfigured: isSmtpConfigured(),
  })
})

// Protected routes
settingsRouter.get('/copilot-info', authMiddleware, (c) => {
```

- [ ] **Step 7: Update frontend settings type**

In `src/web/src/api/settings.ts`, update the `getAuthProviders` return type:

```typescript
getAuthProviders: () => api.get<{ keycloak: boolean; github: boolean; google: boolean; smtpConfigured: boolean }>('/settings/auth-providers'),
```

- [ ] **Step 8: Commit**

```bash
git add src/api/src/config.ts src/api/src/lib/mailer.ts docker-compose.yml docker-compose.dev.yml src/api/package.json src/api/package-lock.json src/api/src/routes/settings.ts src/web/src/api/settings.ts
git commit -m "feat: add SMTP configuration and mailer service"
```

---

### Task 2: Database schema changes

**Files:**
- Modify: `src/api/src/db/schema.ts`

- [ ] **Step 1: Add passwordChangedAt to users and add passwordResetTokens table**

In `src/api/src/db/schema.ts`:

Add `passwordChangedAt` to the `users` table, after the `updatedAt` field:

```typescript
  passwordChangedAt: text('password_changed_at'),
```

Add the new table after the `revokedTokens` table definition:

```typescript
export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})
```

- [ ] **Step 2: Generate Drizzle migration**

```bash
cd src/api && npx drizzle-kit generate
```

This will create `migrations/0010_password_reset.sql` (or similar numbered file). Verify the migration SQL is correct.

- [ ] **Step 3: Commit**

```bash
git add src/api/src/db/schema.ts src/api/migrations/
git commit -m "feat: add password_reset_tokens table and passwordChangedAt column"
```

---

### Task 3: Auth middleware — passwordChangedAt check

**Files:**
- Modify: `src/api/src/middleware/auth.ts`

- [ ] **Step 1: Add passwordChangedAt validation**

Replace the full content of `src/api/src/middleware/auth.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/api/src/middleware/auth.ts
git commit -m "feat: invalidate JWTs issued before password change"
```

---

### Task 4: Auth service — changePassword, requestPasswordReset, resetPassword

**Files:**
- Modify: `src/api/src/services/auth.service.ts`
- Create: `src/api/src/templates/reset-password.ts`

- [ ] **Step 1: Add hasPassword to AuthUser and getMe**

In `src/api/src/services/auth.service.ts`, add `hasPassword` to the `AuthUser` type:

```typescript
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
```

Update the `register` function return to include `hasPassword: true` in the returned user object.

Update the `login` function return to include `hasPassword: true` in the returned user object (the user always has a password if they can log in with one).

Update the `getMe` function to include `hasPassword`:

```typescript
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
```

- [ ] **Step 2: Add changePassword function**

Add to `src/api/src/services/auth.service.ts`:

```typescript
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
```

- [ ] **Step 3: Add requestPasswordReset function**

First, add the import for `passwordResetTokens` at the top of the file:

```typescript
import { users, revokedTokens, passwordResetTokens } from '../db/schema.js'
```

Then add the function:

```typescript
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
```

- [ ] **Step 4: Add resetPassword function**

```typescript
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
```

- [ ] **Step 5: Create email template**

Create `src/api/src/templates/reset-password.ts`:

```typescript
export function resetPasswordEmail(
  userName: string,
  resetLink: string,
  expiresInMinutes: number
): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #262626;border-radius:12px;padding:40px">
        <tr><td>
          <h1 style="color:#e5e5e5;font-size:20px;margin:0 0 8px">dblumi</h1>
          <p style="color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 24px">
            Bonjour ${userName},
          </p>
          <p style="color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 24px">
            Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            <tr><td style="background:#41cd2a;border-radius:8px;padding:12px 24px">
              <a href="${resetLink}" style="color:#0a0a0a;font-size:14px;font-weight:600;text-decoration:none">
                Réinitialiser le mot de passe
              </a>
            </td></tr>
          </table>
          <p style="color:#737373;font-size:12px;line-height:1.5;margin:0 0 16px">
            Ce lien expire dans ${expiresInMinutes} minutes. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
          </p>
          <p style="color:#525252;font-size:11px;line-height:1.5;margin:0;word-break:break-all">
            Si le bouton ne fonctionne pas, copiez ce lien :<br>${resetLink}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `Bonjour ${userName},

Vous avez demandé la réinitialisation de votre mot de passe.

Cliquez sur ce lien pour en choisir un nouveau :
${resetLink}

Ce lien expire dans ${expiresInMinutes} minutes.

Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.

— dblumi`

  return { html, text }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/api/src/services/auth.service.ts src/api/src/templates/reset-password.ts
git commit -m "feat: add changePassword, requestPasswordReset, resetPassword services and email template"
```

---

### Task 5: Auth routes — 3 new endpoints

**Files:**
- Modify: `src/api/src/routes/auth.ts`

- [ ] **Step 1: Add PATCH /password endpoint (change password)**

In `src/api/src/routes/auth.ts`, add the import for `changePassword` at the top:

```typescript
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
```

Add the endpoint after the `/language` route (before `/ws-token`):

```typescript
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
```

- [ ] **Step 2: Add POST /forgot-password endpoint**

Add after the `/password` route. Import the mailer and template at the top of the file:

```typescript
import { isSmtpConfigured, sendMail } from '../lib/mailer.js'
import { resetPasswordEmail } from '../templates/reset-password.js'
import { config } from '../config.js'
```

```typescript
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
```

- [ ] **Step 3: Add POST /reset-password endpoint**

```typescript
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
```

- [ ] **Step 4: Commit**

```bash
git add src/api/src/routes/auth.ts
git commit -m "feat: add change-password, forgot-password, reset-password endpoints"
```

---

### Task 6: i18n translations

**Files:**
- Modify: `src/web/src/i18n/fr.ts`
- Modify: `src/web/src/i18n/en.ts`

- [ ] **Step 1: Add FR translations**

In `src/web/src/i18n/fr.ts`, add after the `'auth.logout'` line:

```typescript
  // ── Password management ──
  'auth.changePassword.title': 'Changer le mot de passe',
  'auth.changePassword.current': 'Mot de passe actuel',
  'auth.changePassword.new': 'Nouveau mot de passe',
  'auth.changePassword.confirm': 'Confirmer le nouveau mot de passe',
  'auth.changePassword.submit': 'Modifier',
  'auth.changePassword.success': 'Mot de passe modifié',
  'auth.changePassword.errorWrong': 'Mot de passe actuel incorrect',
  'auth.changePassword.errorMismatch': 'Les mots de passe ne correspondent pas',
  'auth.changePassword.passwordHint': '8 caractères minimum',
  'auth.forgot.link': 'Mot de passe oublié ?',
  'auth.forgot.title': 'Réinitialiser le mot de passe',
  'auth.forgot.email': 'Email',
  'auth.forgot.submit': 'Envoyer le lien',
  'auth.forgot.success': 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.',
  'auth.forgot.back': 'Retour à la connexion',
  'auth.reset.title': 'Nouveau mot de passe',
  'auth.reset.password': 'Mot de passe',
  'auth.reset.confirm': 'Confirmer le mot de passe',
  'auth.reset.submit': 'Réinitialiser',
  'auth.reset.success': 'Mot de passe réinitialisé. Vous pouvez vous connecter.',
  'auth.reset.expired': 'Ce lien a expiré ou est invalide.',
  'auth.reset.tryAgain': 'Demander un nouveau lien',
  'password.strength.weak': 'Faible',
  'password.strength.fair': 'Correct',
  'password.strength.strong': 'Fort',
```

- [ ] **Step 2: Add EN translations**

In `src/web/src/i18n/en.ts`, add after the `'auth.logout'` line:

```typescript
  // ── Password management ──
  'auth.changePassword.title': 'Change password',
  'auth.changePassword.current': 'Current password',
  'auth.changePassword.new': 'New password',
  'auth.changePassword.confirm': 'Confirm new password',
  'auth.changePassword.submit': 'Update',
  'auth.changePassword.success': 'Password updated',
  'auth.changePassword.errorWrong': 'Current password is incorrect',
  'auth.changePassword.errorMismatch': 'Passwords do not match',
  'auth.changePassword.passwordHint': 'At least 8 characters',
  'auth.forgot.link': 'Forgot password?',
  'auth.forgot.title': 'Reset password',
  'auth.forgot.email': 'Email',
  'auth.forgot.submit': 'Send reset link',
  'auth.forgot.success': 'If an account exists with this email, a reset link has been sent.',
  'auth.forgot.back': 'Back to sign in',
  'auth.reset.title': 'New password',
  'auth.reset.password': 'Password',
  'auth.reset.confirm': 'Confirm password',
  'auth.reset.submit': 'Reset',
  'auth.reset.success': 'Password reset. You can now sign in.',
  'auth.reset.expired': 'This link has expired or is invalid.',
  'auth.reset.tryAgain': 'Request a new link',
  'password.strength.weak': 'Weak',
  'password.strength.fair': 'Fair',
  'password.strength.strong': 'Strong',
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/i18n/fr.ts src/web/src/i18n/en.ts
git commit -m "feat: add i18n translations for password management"
```

---

### Task 7: Password Strength Indicator component

**Files:**
- Create: `src/web/src/components/ui/password-strength.tsx`

- [ ] **Step 1: Create the component**

Create `src/web/src/components/ui/password-strength.tsx`:

```tsx
import { useMemo } from 'react'
import { useI18n } from '@/i18n'

function computeScore(password: string): number {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++
  return score
}

type Level = 'weak' | 'fair' | 'strong'

function getLevel(score: number): Level {
  if (score <= 2) return 'weak'
  if (score <= 4) return 'fair'
  return 'strong'
}

const COLORS: Record<Level, string> = {
  weak: 'bg-red-500',
  fair: 'bg-orange-500',
  strong: 'bg-green-500',
}

const SEGMENTS = 4

export function PasswordStrengthIndicator({ password }: { password: string }) {
  const { t } = useI18n()

  const { level, filledSegments } = useMemo(() => {
    if (!password) return { level: 'weak' as Level, filledSegments: 0 }
    const score = computeScore(password)
    const lvl = getLevel(score)
    const filled = lvl === 'weak' ? 1 : lvl === 'fair' ? 2 : SEGMENTS
    return { level: lvl, filledSegments: filled }
  }, [password])

  if (!password) return null

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex gap-1 flex-1">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < filledSegments ? COLORS[level] : 'bg-muted'
            }`}
          />
        ))}
      </div>
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${
        level === 'weak' ? 'text-red-500'
        : level === 'fair' ? 'text-orange-500'
        : 'text-green-500'
      }`}>
        {t(`password.strength.${level}` as 'password.strength.weak')}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/ui/password-strength.tsx
git commit -m "feat: add PasswordStrengthIndicator component"
```

---

### Task 8: Add PasswordStrengthIndicator to RegisterPage

**Files:**
- Modify: `src/web/src/pages/RegisterPage.tsx`

- [ ] **Step 1: Add the indicator**

In `src/web/src/pages/RegisterPage.tsx`, add the import:

```typescript
import { PasswordStrengthIndicator } from '@/components/ui/password-strength'
```

Then add `<PasswordStrengthIndicator password={password} />` right after the password `<Input>` closing tag, inside the same `<div className="space-y-2">`. The password block should become:

```tsx
            <div className="space-y-2">
              <Label htmlFor="reg-password">{t('auth.register.password')}</Label>
              <Input id="reg-password" type="password" placeholder={t('auth.register.passwordHint')} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              <PasswordStrengthIndicator password={password} />
            </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/pages/RegisterPage.tsx
git commit -m "feat: add password strength indicator to registration form"
```

---

### Task 9: Frontend API client + store updates

**Files:**
- Modify: `src/web/src/api/auth.ts`
- Modify: `src/web/src/stores/auth.store.ts`

- [ ] **Step 1: Update User type and add API methods**

In `src/web/src/api/auth.ts`, add `hasPassword` to the `User` type:

```typescript
export type User = {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  avatarUrl: string | null
  language: string
  createdAt: string
  hasPassword: boolean
}
```

Add the 3 new methods to `authApi`:

```typescript
export const authApi = {
  register: (data: { email: string; password: string; name: string; language?: string }) =>
    api.post<AuthResponse>('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', data),
  logout: () => api.post<void>('/auth/logout'),
  me: () => api.get<{ user: User }>('/auth/me'),
  updateLanguage: (language: string) => api.patch<{ language: string }>('/auth/language', { language }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<{ success: boolean }>('/auth/password', { currentPassword, newPassword }),
  forgotPassword: (email: string) =>
    api.post<{ success: boolean }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    api.post<{ success: boolean }>('/auth/reset-password', { token, newPassword }),
}
```

- [ ] **Step 2: Add changePassword to auth store**

In `src/web/src/stores/auth.store.ts`, add to the type:

```typescript
type AuthState = {
  user: User | null
  hydrated: boolean
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string, language?: string) => Promise<void>
  logout: () => Promise<void>
  setLanguage: (language: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}
```

Add the implementation inside the `create` callback, after `setLanguage`:

```typescript
  changePassword: async (currentPassword, newPassword) => {
    await authApi.changePassword(currentPassword, newPassword)
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/api/auth.ts src/web/src/stores/auth.store.ts
git commit -m "feat: add password management API methods and store action"
```

---

### Task 10: ChangePasswordDialog component

**Files:**
- Create: `src/web/src/components/auth/ChangePasswordDialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `src/web/src/components/auth/ChangePasswordDialog.tsx`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordStrengthIndicator } from '@/components/ui/password-strength'
import { useAuthStore } from '@/stores/auth.store'
import { ApiError } from '@/api/client'
import { useI18n } from '@/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const { t } = useI18n()
  const changePassword = useAuthStore((s) => s.changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const reset = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setLoading(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError(t('auth.changePassword.errorMismatch'))
      return
    }

    setLoading(true)
    try {
      await changePassword(currentPassword, newPassword)
      toast.success(t('auth.changePassword.success'))
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.changePassword.errorWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('auth.changePassword.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">{t('auth.changePassword.current')}</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">{t('auth.changePassword.new')}</Label>
            <Input
              id="new-password"
              type="password"
              placeholder={t('auth.changePassword.passwordHint')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <PasswordStrengthIndicator password={newPassword} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t('auth.changePassword.confirm')}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                </svg>
              ) : (
                t('auth.changePassword.submit')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/auth/ChangePasswordDialog.tsx
git commit -m "feat: add ChangePasswordDialog component"
```

---

### Task 11: Add change password button to user menu

**Files:**
- Modify: `src/web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add imports and state**

In `src/web/src/components/layout/AppShell.tsx`:

Add the `KeyRound` icon to the lucide-react import (alongside the existing icons):

```typescript
import { ..., KeyRound, ... } from 'lucide-react'
```

Add the dialog import near the top:

```typescript
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog'
```

Inside the `AppShell` component function, add state for the dialog:

```typescript
const [changePasswordOpen, setChangePasswordOpen] = useState(false)
```

- [ ] **Step 2: Add the menu item and dialog**

In the `DropdownMenuContent` of the user menu (SidebarFooter section), add the "Change password" item after the language sub-menu and before the admin link. It should only show when the user has a password:

```tsx
                  {user?.hasPassword && (
                    <DropdownMenuItem onClick={() => setChangePasswordOpen(true)} className="gap-2 cursor-pointer">
                      <KeyRound className="h-4 w-4" />
                      {t('auth.changePassword.title')}
                    </DropdownMenuItem>
                  )}
```

Add the `ChangePasswordDialog` right after the `</DropdownMenu>` closing tag (still inside `SidebarMenuItem`):

```tsx
              <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/components/layout/AppShell.tsx
git commit -m "feat: add change password button in user menu"
```

---

### Task 12: Forgot password and Reset password views in LoginPage

**Files:**
- Modify: `src/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Add forgot/reset password views**

In `src/web/src/pages/LoginPage.tsx`:

Add imports:

```typescript
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { authApi } from '@/api/auth'
import { PasswordStrengthIndicator } from '@/components/ui/password-strength'
```

Note: `useQuery` and `settingsApi` are already imported. Just add `authApi` and `PasswordStrengthIndicator`.

Update the `Props` type to include the view state:

```typescript
type AuthView = 'login' | 'forgot' | 'reset'
```

Inside the `LoginPage` component, add state for the views. Check URL params for reset token on mount:

```typescript
  const [authView, setAuthView] = useState<AuthView>(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'reset-password' && params.get('token')) return 'reset'
    return 'login'
  })

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  // Reset password state
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    try {
      await authApi.forgotPassword(forgotEmail)
    } catch {
      // Silently succeed (anti-enumeration)
    }
    setForgotSent(true)
    setForgotLoading(false)
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError('')
    if (resetPassword !== resetConfirm) {
      setResetError(t('auth.changePassword.errorMismatch'))
      return
    }
    setResetLoading(true)
    try {
      await authApi.resetPassword(resetToken, resetPassword)
      setResetSuccess(true)
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : t('auth.reset.expired'))
    } finally {
      setResetLoading(false)
    }
  }

  const backToLogin = () => {
    setAuthView('login')
    setForgotSent(false)
    setForgotEmail('')
    setResetError('')
    setResetSuccess(false)
    window.history.replaceState({}, '', window.location.pathname)
  }
```

- [ ] **Step 2: Replace the return JSX**

Replace the entire `return (...)` block of the component. The outer wrapper (canvas, planet arc) stays the same. The inner card content changes based on `authView`:

```tsx
  // ── Forgot password view ──
  if (authView === 'forgot') {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-background overflow-hidden">
        <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />
        <div
          className="absolute pointer-events-none"
          style={{
            left: '-50%', bottom: '-80vh', width: '200%', height: '100vh',
            borderRadius: '50%', borderTop: '1px solid rgba(65,205,42,0.15)',
            background: 'hsl(var(--background))',
            boxShadow: '0 -60px 120px 20px rgba(65,205,42,0.15), 0 -20px 60px rgba(65,205,42,0.1)',
          }}
        />
        <div className="relative w-full max-w-[380px] mx-4">
          <div className="mb-10 text-center">
            <img src={logoSvg} alt="dblumi" className="h-10 mx-auto" />
            <p className="mt-2 text-sm text-muted-foreground">{t('auth.forgot.title')}</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-2xl shadow-black/40">
            {forgotSent ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('auth.forgot.success')}</p>
                <Button variant="outline" className="w-full" onClick={backToLogin}>
                  {t('auth.forgot.back')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">{t('auth.forgot.email')}</Label>
                  <Input id="forgot-email" type="email" placeholder="dev@company.com" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required autoFocus autoComplete="email" />
                </div>
                <Button type="submit" disabled={forgotLoading} className="w-full">
                  {forgotLoading ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg> : t('auth.forgot.submit')}
                </Button>
              </form>
            )}
          </div>
          <p className="mt-6 text-center text-xs text-text-muted">
            <button onClick={backToLogin} className="text-primary hover:text-dblumi-hover transition-colors font-medium">{t('auth.forgot.back')}</button>
          </p>
        </div>
      </div>
    )
  }

  // ── Reset password view ──
  if (authView === 'reset') {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-background overflow-hidden">
        <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />
        <div
          className="absolute pointer-events-none"
          style={{
            left: '-50%', bottom: '-80vh', width: '200%', height: '100vh',
            borderRadius: '50%', borderTop: '1px solid rgba(65,205,42,0.15)',
            background: 'hsl(var(--background))',
            boxShadow: '0 -60px 120px 20px rgba(65,205,42,0.15), 0 -20px 60px rgba(65,205,42,0.1)',
          }}
        />
        <div className="relative w-full max-w-[380px] mx-4">
          <div className="mb-10 text-center">
            <img src={logoSvg} alt="dblumi" className="h-10 mx-auto" />
            <p className="mt-2 text-sm text-muted-foreground">{t('auth.reset.title')}</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-2xl shadow-black/40">
            {resetSuccess ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('auth.reset.success')}</p>
                <Button className="w-full" onClick={backToLogin}>
                  {t('auth.forgot.back')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-password">{t('auth.reset.password')}</Label>
                  <Input id="reset-password" type="password" placeholder={t('auth.changePassword.passwordHint')} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} required minLength={8} autoFocus autoComplete="new-password" />
                  <PasswordStrengthIndicator password={resetPassword} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-confirm">{t('auth.reset.confirm')}</Label>
                  <Input id="reset-confirm" type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
                </div>
                {resetError && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{resetError}</div>}
                <Button type="submit" disabled={resetLoading} className="w-full">
                  {resetLoading ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg> : t('auth.reset.submit')}
                </Button>
              </form>
            )}
          </div>
          {!resetSuccess && (
            <p className="mt-6 text-center text-xs text-text-muted">
              <button onClick={() => setAuthView('forgot')} className="text-primary hover:text-dblumi-hover transition-colors font-medium">{t('auth.reset.tryAgain')}</button>
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Login view (default) ──
```

The existing login return stays as-is, but add the "Forgot password?" link inside the form, right after the password `<div className="space-y-2">` block and before the `{error && ...}` block:

```tsx
            {authProviders?.smtpConfigured && (
              <div className="text-right">
                <button type="button" onClick={() => setAuthView('forgot')} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                  {t('auth.forgot.link')}
                </button>
              </div>
            )}
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/LoginPage.tsx
git commit -m "feat: add forgot password and reset password views to LoginPage"
```

---

### Task 13: Handle reset-password view in App.tsx

**Files:**
- Modify: `src/web/src/App.tsx`

- [ ] **Step 1: Show LoginPage when URL has reset-password view even if not authenticated**

The current `App.tsx` already shows `LoginPage` when not authenticated, and the `LoginPage` itself reads the URL params to detect `?view=reset-password&token=xxx`. So no changes are needed to `App.tsx` for this — the LoginPage handles it internally.

However, if a logged-in user clicks a reset link, they should be shown the reset view. Add this check: if the URL contains `?view=reset-password`, force showing the login page:

In `src/web/src/App.tsx`, modify the auth flow section. Replace:

```typescript
  // ── Auth flow ──────────────────────────
  if (!user) {
```

With:

```typescript
  // ── Auth flow / Reset password ─────────
  const isResetView = new URLSearchParams(window.location.search).get('view') === 'reset-password'
  if (!user || isResetView) {
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/App.tsx
git commit -m "feat: show reset password view even when authenticated"
```

---

### Task 14: Build verification

- [ ] **Step 1: Build the API**

```bash
cd src/api && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 2: Build the frontend**

```bash
cd src/web && npm run build
```

Expected: no TypeScript errors, successful Vite build.

- [ ] **Step 3: Run Drizzle migration (if local DB available)**

```bash
cd src/api && npx drizzle-kit push
```

- [ ] **Step 4: Final commit if any fixes were needed**

If build errors were found and fixed:

```bash
git add -A
git commit -m "fix: resolve build errors in password management feature"
```

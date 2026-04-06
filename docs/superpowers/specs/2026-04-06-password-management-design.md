# Password Management — Design Spec

## Overview

Add password change (authenticated) and password reset (forgot password via email) to dblumi. Includes a reusable password strength indicator component.

## Section 1 — SMTP Configuration

### Environment Variables

All optional — SMTP is only required for the "forgot password" flow.

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | Sender address (e.g. `noreply@dblumi.dev`) |

### Config (`src/api/src/config.ts`)

Add the 5 SMTP variables as optional strings to `ConfigSchema`. `SMTP_PORT` defaults to 587.

### Docker Compose

Add the 5 SMTP variables to both `docker-compose.yml` and `docker-compose.dev.yml` in the `environment` section, using `${VAR:-}` syntax (optional).

### Mailer Service (`src/api/src/lib/mailer.ts`)

- Creates a Nodemailer transporter from config
- Exports `sendMail(to: string, subject: string, html: string, text: string): Promise<void>`
- Exports `isSmtpConfigured(): boolean` — returns true if `SMTP_HOST` and `SMTP_FROM` are set

### Settings Endpoint

Enrich the existing `GET /api/v1/settings/auth-providers` response to include `smtpConfigured: boolean`. The frontend uses this to conditionally show the "Forgot password?" link.

## Section 2 — Change Password (Authenticated)

### Backend

**Endpoint:** `PATCH /api/v1/auth/password` (protected by `authMiddleware`)

**Request body:**
```json
{
  "currentPassword": "string",
  "newPassword": "string (min 8 chars)"
}
```

**Logic:**
1. Fetch user by `userId` from JWT
2. If `user.oauthProvider` is set and `user.passwordHash` is null → return 400 (password managed by external provider)
3. Verify `currentPassword` against stored hash with Argon2
4. If invalid → return 401
5. Hash `newPassword` with Argon2, update `users.passwordHash` and `users.updatedAt`
6. Return 200 `{ success: true }`

### Auth Service

New function `changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>` in `auth.service.ts`.

### `/auth/me` Response

Add `hasPassword: boolean` field to the `/auth/me` response (and `AuthUser` type). Derived from `passwordHash !== null`. Used by the frontend to hide the "Change password" button for OAuth-only users.

### Frontend

**API client** (`src/web/src/api/auth.ts`):
- Add `authApi.changePassword(currentPassword: string, newPassword: string)`

**Dialog component** (`src/web/src/components/auth/ChangePasswordDialog.tsx`):
- Modal dialog with 3 fields: current password, new password, confirmation
- Client-side validation: min 8 chars, new password === confirmation
- `PasswordStrengthIndicator` on the new password field
- Submit calls `authApi.changePassword`
- Toast (sonner) on success, inline error on failure
- Accessible from the user menu in `AppShell.tsx` sidebar footer

**Visibility:**
- Button hidden if `user.hasPassword === false` (OAuth/Keycloak users)

### i18n Keys

```
auth.changePassword.title        — "Changer le mot de passe" / "Change password"
auth.changePassword.current      — "Mot de passe actuel" / "Current password"
auth.changePassword.new          — "Nouveau mot de passe" / "New password"
auth.changePassword.confirm      — "Confirmer le nouveau mot de passe" / "Confirm new password"
auth.changePassword.submit       — "Modifier" / "Update"
auth.changePassword.success      — "Mot de passe modifié" / "Password updated"
auth.changePassword.errorWrong   — "Mot de passe actuel incorrect" / "Current password is incorrect"
auth.changePassword.errorMismatch — "Les mots de passe ne correspondent pas" / "Passwords do not match"
auth.changePassword.passwordHint — "8 caractères minimum" / "At least 8 characters"
```

## Section 3 — Password Strength Indicator

### Component (`src/web/src/components/ui/password-strength.tsx`)

Reusable component used in both `ChangePasswordDialog` and `RegisterPage`.

**Props:** `{ password: string }`

**Scoring criteria:**
- Length >= 8 → +1
- Length >= 12 → +1
- Has lowercase → +1
- Has uppercase → +1
- Has digits → +1
- Has special characters → +1

**Score mapping:**
- 0-2: Faible / Weak (red)
- 3-4: Correct / Fair (orange)
- 5-6: Fort / Strong (green)

**Visual:**
- 4 horizontal bar segments below the password input
- Segments fill and change color based on score
- Label text displayed to the right: "FAIBLE" / "CORRECT" / "FORT" (i18n)

**i18n keys:**
```
password.strength.weak    — "Faible" / "Weak"
password.strength.fair    — "Correct" / "Fair"
password.strength.strong  — "Fort" / "Strong"
```

### Integration

- `RegisterPage.tsx`: add `PasswordStrengthIndicator` below the password field
- `ChangePasswordDialog.tsx`: add below the new password field

## Section 4 — Forgot Password (Email Reset)

### Database

New table `password_reset_tokens` (Drizzle migration):

| Column | Type | Description |
|--------|------|-------------|
| `id` | text, PK | `crypto.randomUUID()` |
| `userId` | text, FK → users.id (onDelete cascade) | Target user |
| `tokenHash` | text, not null | SHA-256 hash of the token |
| `expiresAt` | text, not null | ISO timestamp, 1 hour from creation |
| `usedAt` | text, nullable | Set when token is consumed |
| `createdAt` | text, not null | ISO timestamp |

### Backend

**Endpoint 1:** `POST /api/v1/auth/forgot-password` (public)

Request body: `{ email: string }`

Logic:
1. If SMTP not configured → return 400
2. Look up user by email (lowercased)
3. If user not found OR user is OAuth-only (no passwordHash) → return 200 anyway (anti-enumeration)
4. Delete any existing reset tokens for this user
5. Generate `crypto.randomBytes(32).toString('hex')` as token
6. Store SHA-256 hash of token in `password_reset_tokens` with 1h expiry
7. Send email with link `{BASE_URL}?view=reset-password&token={token}`
8. Return 200 `{ success: true }`

**Endpoint 2:** `POST /api/v1/auth/reset-password` (public)

Request body: `{ token: string, newPassword: string (min 8 chars) }`

Logic:
1. Compute SHA-256 hash of received token
2. Look up in `password_reset_tokens` by `tokenHash`
3. If not found, expired, or already used → return 400
4. Hash `newPassword` with Argon2, update `users.passwordHash` and `users.updatedAt`
5. Mark token as used (`usedAt = now`)
6. Revoke all existing JWTs for this user (force logout everywhere) — insert into `revokedTokens` for any active sessions
7. Return 200 `{ success: true }`

**JWT invalidation (step 6):** Add a `passwordChangedAt` (text, nullable) column to the `users` table. Set it on every password change or reset. In `authMiddleware`, after verifying the JWT, compare the token's `iat` (issued-at) against `user.passwordChangedAt` — if the token was issued before the password change, reject it (401). This reliably invalidates all pre-existing sessions without needing to enumerate JTIs.

### Email Template (`src/api/src/templates/reset-password.ts`)

Exports a function `resetPasswordEmail(userName: string, resetLink: string, expiresInMinutes: number): { html: string, text: string }`

- HTML: clean, responsive email template with dblumi branding
- Text: plain-text fallback
- Content: greeting, explanation, reset button/link, expiration notice (1h)

### Frontend

**LoginPage.tsx modifications:**
- Add "Mot de passe oublié ?" link below the password field
- Link only visible if `authProviders?.smtpConfigured === true`
- Clicking switches to a "forgot password" view within the same page

**Forgot password view** (inline in LoginPage or separate component):
- Email input + submit button
- On submit → `authApi.forgotPassword(email)`
- Always shows success message: "Si un compte existe avec cet email, un lien de réinitialisation a été envoyé."
- Back link to return to login

**Reset password view:**
- Displayed when URL contains `?view=reset-password&token=xxx`
- Form: new password + confirmation + `PasswordStrengthIndicator`
- On submit → `authApi.resetPassword(token, newPassword)`
- Success → redirect to login with toast
- Error (expired/invalid) → message with link to retry forgot password

**API client additions:**
```typescript
authApi.forgotPassword(email: string)    → POST /auth/forgot-password
authApi.resetPassword(token, newPassword) → POST /auth/reset-password
```

### i18n Keys

```
auth.forgot.link       — "Mot de passe oublié ?" / "Forgot password?"
auth.forgot.title      — "Réinitialiser le mot de passe" / "Reset password"
auth.forgot.email      — "Email" / "Email"
auth.forgot.submit     — "Envoyer le lien" / "Send reset link"
auth.forgot.success    — "Si un compte existe avec cet email, un lien de réinitialisation a été envoyé." / "If an account exists with this email, a reset link has been sent."
auth.forgot.back       — "Retour à la connexion" / "Back to login"
auth.forgot.noSmtp     — "Contactez votre administrateur." / "Contact your administrator."

auth.reset.title       — "Nouveau mot de passe" / "New password"
auth.reset.password    — "Mot de passe" / "Password"
auth.reset.confirm     — "Confirmer le mot de passe" / "Confirm password"
auth.reset.submit      — "Réinitialiser" / "Reset"
auth.reset.success     — "Mot de passe réinitialisé. Vous pouvez vous connecter." / "Password reset. You can now log in."
auth.reset.expired     — "Ce lien a expiré ou est invalide." / "This link has expired or is invalid."
auth.reset.tryAgain    — "Demander un nouveau lien" / "Request a new link"
```

## Files Modified / Created

### New files
- `src/api/src/lib/mailer.ts` — Nodemailer wrapper
- `src/api/src/templates/reset-password.ts` — Email template
- `src/web/src/components/ui/password-strength.tsx` — Strength indicator
- `src/web/src/components/auth/ChangePasswordDialog.tsx` — Change password dialog
- `src/api/migrations/00XX_password_reset_tokens.sql` — Drizzle migration

### Modified files
- `src/api/src/config.ts` — Add SMTP vars
- `src/api/src/db/schema.ts` — Add `passwordResetTokens` table + `passwordChangedAt` column on `users`
- `src/api/src/middleware/auth.ts` — Add `passwordChangedAt` check against token `iat`
- `src/api/src/routes/auth.ts` — Add 3 endpoints (change, forgot, reset)
- `src/api/src/services/auth.service.ts` — Add `changePassword`, `forgotPassword`, `resetPassword` + `AuthUser.hasPassword`
- `src/api/src/routes/settings.ts` — Add `smtpConfigured` to auth-providers response
- `src/web/src/api/auth.ts` — Add 3 API methods + `hasPassword` on User type
- `src/web/src/stores/auth.store.ts` — Add `changePassword` action
- `src/web/src/pages/LoginPage.tsx` — Add forgot/reset password views
- `src/web/src/pages/RegisterPage.tsx` — Add PasswordStrengthIndicator
- `src/web/src/components/layout/AppShell.tsx` — Add change password button in user menu
- `src/web/src/i18n/fr.ts` — Add all FR translations
- `src/web/src/i18n/en.ts` — Add all EN translations
- `docker-compose.yml` — Add SMTP env vars
- `docker-compose.dev.yml` — Add SMTP env vars
- `package.json` (api) — Add `nodemailer` dependency

## Security Considerations

- Reset tokens are hashed (SHA-256) before storage — the raw token only exists in the email
- Tokens expire after 1 hour and are single-use
- Anti-enumeration: forgot-password always returns 200 regardless of email existence
- OAuth users cannot change/reset passwords (enforced server-side)
- Rate limiting on forgot-password should be considered in a future iteration
- `passwordChangedAt` on users table to invalidate all sessions after password reset

import { Hono } from 'hono'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { config } from '../config.js'
import { signToken, tokenCookie } from '../lib/jwt.js'
import { logger } from '../logger.js'

const keycloakRouter = new Hono()

function isEnabled() {
  return !!(config.KEYCLOAK_ISSUER && config.KEYCLOAK_CLIENT_ID && config.KEYCLOAK_CLIENT_SECRET)
}

/** Fetch OIDC discovery document (cached in module scope) */
let discovery: { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string } | null = null

async function getDiscovery() {
  if (discovery) return discovery
  const url = `${config.KEYCLOAK_ISSUER}/.well-known/openid-configuration`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`)
  discovery = await res.json() as typeof discovery
  return discovery!
}

/** GET /keycloak — redirect to Keycloak authorization URL */
keycloakRouter.get('/', async (c) => {
  if (!isEnabled()) return c.json({ error: 'Keycloak not configured' }, 404)

  const disc = await getDiscovery()
  const state = crypto.randomUUID()
  const redirectUri = `${config.BASE_URL}/api/v1/auth/keycloak/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.KEYCLOAK_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
  })

  // Store state in a short-lived cookie for CSRF protection
  c.header('Set-Cookie', `kc_state=${state}; HttpOnly; SameSite=Lax; Path=/api/v1/auth/keycloak; Max-Age=300`)
  return c.redirect(`${disc.authorization_endpoint}?${params}`)
})

/** GET /keycloak/callback — exchange code, upsert user, set cookie */
keycloakRouter.get('/callback', async (c) => {
  if (!isEnabled()) return c.json({ error: 'Keycloak not configured' }, 404)

  const { code, state, error: oidcError } = c.req.query()

  if (oidcError) {
    logger.warn({ oidcError }, 'Keycloak callback error')
    return c.redirect(`${config.BASE_URL}/?error=keycloak_denied`)
  }

  // Validate state
  const cookies = c.req.header('cookie') ?? ''
  const storedState = cookies.match(/kc_state=([^;]+)/)?.[1]
  if (!storedState || storedState !== state) {
    return c.redirect(`${config.BASE_URL}/?error=invalid_state`)
  }

  const disc = await getDiscovery()
  const redirectUri = `${config.BASE_URL}/api/v1/auth/keycloak/callback`

  // Exchange code for tokens
  const tokenRes = await fetch(disc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.KEYCLOAK_CLIENT_ID!,
      client_secret: config.KEYCLOAK_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      code: code ?? '',
    }),
  })

  if (!tokenRes.ok) {
    logger.warn({ status: tokenRes.status }, 'Keycloak token exchange failed')
    return c.redirect(`${config.BASE_URL}/?error=keycloak_token`)
  }

  const { access_token } = await tokenRes.json() as { access_token: string }

  // Fetch userinfo
  const userRes = await fetch(disc.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${access_token}` },
  })

  if (!userRes.ok) {
    logger.warn({ status: userRes.status }, 'Keycloak userinfo failed')
    return c.redirect(`${config.BASE_URL}/?error=keycloak_userinfo`)
  }

  const profile = await userRes.json() as {
    sub: string
    email?: string
    name?: string
    preferred_username?: string
    given_name?: string
    family_name?: string
  }

  if (!profile.sub || !profile.email) {
    return c.redirect(`${config.BASE_URL}/?error=keycloak_missing_claims`)
  }

  const email = profile.email.toLowerCase()
  const name = (profile.name
    ?? `${profile.given_name ?? ''} ${profile.family_name ?? ''}`.trim())
    || profile.preferred_username
    || email.split('@')[0]!

  // Upsert user
  let user = await db
    .select()
    .from(users)
    .where(eq(users.oauthProviderId, profile.sub))
    .get()

  if (!user) {
    // Try matching by email (user may have registered before)
    user = await db.select().from(users).where(eq(users.email, email)).get()
  }

  if (user) {
    // Update OAuth link if not yet set
    if (!user.oauthProvider) {
      await db
        .update(users)
        .set({ oauthProvider: 'keycloak', oauthProviderId: profile.sub, updatedAt: new Date().toISOString() })
        .where(eq(users.id, user.id))
    }
  } else {
    // New user — default role viewer (first user = admin handled by register only)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.insert(users).values({
      id,
      email,
      name,
      role: 'viewer',
      oauthProvider: 'keycloak',
      oauthProviderId: profile.sub,
      language: 'fr',
      createdAt: now,
      updatedAt: now,
    })
    user = await db.select().from(users).where(eq(users.id, id)).get()
  }

  if (!user) {
    return c.redirect(`${config.BASE_URL}/?error=keycloak_upsert`)
  }

  const token = await signToken({ sub: user.id, email: user.email, role: user.role })
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  c.header('Set-Cookie', tokenCookie(token, expiresAt))
  // Clear state cookie (append second Set-Cookie header)
  c.res.headers.append('Set-Cookie', 'kc_state=; HttpOnly; SameSite=Lax; Path=/api/v1/auth/keycloak; Max-Age=0')
  return c.redirect(`${config.BASE_URL}/`)
})

export { keycloakRouter }

import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { config } from '../config.js'
import type { UserRole } from '@dblumi/shared'

const secret = new TextEncoder().encode(config.JWT_SECRET)
const COOKIE_NAME = 'dblumi_token'
const EXPIRY = '7d'

export type TokenPayload = JWTPayload & {
  sub: string
  email: string
  role: UserRole
  jti: string
}

export async function signToken(payload: {
  sub: string
  email: string
  role: UserRole
}): Promise<string> {
  const jti = crypto.randomUUID()
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(secret)
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret)
  return payload as TokenPayload
}

export function tokenCookie(token: string, expires: Date): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}`
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

export function extractToken(req: Request): string | undefined {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const cookies = req.headers.get('cookie') ?? ''
  const match = cookies.match(/dblumi_token=([^;]+)/)
  return match?.[1]
}

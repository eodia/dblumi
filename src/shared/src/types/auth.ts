import { z } from 'zod'

export const UserRoleSchema = z.enum(['admin', 'editor', 'viewer'])
export type UserRole = z.infer<typeof UserRoleSchema>

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: UserRoleSchema,
  avatarUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})
export type Login = z.infer<typeof LoginSchema>

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
})
export type Register = z.infer<typeof RegisterSchema>

export type JwtPayload = {
  sub: string       // user id
  email: string
  role: UserRole
  iat: number
  exp: number
}

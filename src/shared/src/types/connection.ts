import { z } from 'zod'

export const DbDriverSchema = z.enum(['postgresql', 'mysql', 'oracle', 'sqlite'])
export type DbDriver = z.infer<typeof DbDriverSchema>

export const ConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  driver: DbDriverSchema,
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  database: z.string().optional(),
  username: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  // password stored encrypted — never returned to client
  ssl: z.boolean().default(false),
  color: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Connection = z.infer<typeof ConnectionSchema>

export const CreateConnectionSchema = ConnectionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  password: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.driver === 'sqlite') {
    if (!val.filePath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'filePath is required for SQLite', path: ['filePath'] })
    }
  } else {
    if (!val.host) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'host is required', path: ['host'] })
    if (!val.port) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'port is required', path: ['port'] })
    if (!val.username) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'username is required', path: ['username'] })
  }
})
export type CreateConnection = z.infer<typeof CreateConnectionSchema>

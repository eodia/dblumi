import { z } from 'zod'

export const DbDriverSchema = z.enum(['postgresql', 'mysql'])
export type DbDriver = z.infer<typeof DbDriverSchema>

export const ConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  driver: DbDriverSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
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
  password: z.string(),
})
export type CreateConnection = z.infer<typeof CreateConnectionSchema>

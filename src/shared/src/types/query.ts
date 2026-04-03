import { z } from 'zod'

export const ExecuteQuerySchema = z.object({
  connectionId: z.string().uuid(),
  sql: z.string().min(1),
  limit: z.number().int().min(1).max(10000).default(1000),
})
export type ExecuteQuery = z.infer<typeof ExecuteQuerySchema>

export const QueryColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean().optional(),
})
export type QueryColumn = z.infer<typeof QueryColumnSchema>

export const QueryResultSchema = z.object({
  columns: z.array(QueryColumnSchema),
  rows: z.array(z.record(z.unknown())),
  rowCount: z.number().int(),
  durationMs: z.number(),
})
export type QueryResult = z.infer<typeof QueryResultSchema>

export const SavedQuerySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  sql: z.string().min(1),
  connectionId: z.string().uuid().optional(),
  description: z.string().optional(),
  folder: z.string().optional(),
  sortOrder: z.number().int().optional(),
  shared: z.boolean().optional(),
  createdBy: z.string().uuid(),
  createdByName: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type SavedQuery = z.infer<typeof SavedQuerySchema>

export const SavedQueryVersionSchema = z.object({
  id: z.string().uuid(),
  queryId: z.string().uuid(),
  sql: z.string(),
  label: z.string().nullable(),
  editedBy: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  createdAt: z.string().datetime(),
})
export type SavedQueryVersion = z.infer<typeof SavedQueryVersionSchema>

export const VersionsResponseSchema = z.object({
  versions: z.array(SavedQueryVersionSchema),
  nextCursor: z.string().nullable(),
})
export type VersionsResponse = z.infer<typeof VersionsResponseSchema>

import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '../db/index.js'
import { savedQueries } from '../db/schema.js'
import type { SavedQuery } from '@dblumi/shared'

export class SavedQueryError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN'
  ) {
    super(message)
    this.name = 'SavedQueryError'
  }
}

type CreateSavedQuery = {
  name: string
  sql: string
  description?: string | null
  connectionId?: string | null
}

type UpdateSavedQuery = Partial<CreateSavedQuery>

function toView(row: typeof savedQueries.$inferSelect): SavedQuery {
  return {
    id: row.id,
    name: row.name,
    sql: row.sql,
    description: row.description ?? undefined,
    connectionId: row.connectionId ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listSavedQueries(userId: string): Promise<SavedQuery[]> {
  const rows = await db
    .select()
    .from(savedQueries)
    .where(eq(savedQueries.createdBy, userId))
    .orderBy(savedQueries.updatedAt)
  return rows.map(toView)
}

export async function getSavedQuery(id: string, userId: string): Promise<SavedQuery> {
  const rows = await db
    .select()
    .from(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.createdBy, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw new SavedQueryError('Requête sauvegardée introuvable.', 'NOT_FOUND')
  return toView(row)
}

export async function createSavedQuery(
  data: CreateSavedQuery,
  userId: string
): Promise<SavedQuery> {
  const now = new Date().toISOString()
  const id = randomUUID()
  await db.insert(savedQueries).values({
    id,
    name: data.name,
    sql: data.sql,
    description: data.description ?? null,
    connectionId: data.connectionId ?? null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })
  return getSavedQuery(id, userId)
}

export async function updateSavedQuery(
  id: string,
  data: UpdateSavedQuery,
  userId: string
): Promise<SavedQuery> {
  // Verify ownership
  await getSavedQuery(id, userId)

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (data.name !== undefined) updates['name'] = data.name
  if (data.sql !== undefined) updates['sql'] = data.sql
  if ('description' in data) updates['description'] = data.description ?? null
  if ('connectionId' in data) updates['connectionId'] = data.connectionId ?? null

  await db
    .update(savedQueries)
    .set(updates)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.createdBy, userId)))

  return getSavedQuery(id, userId)
}

export async function deleteSavedQuery(id: string, userId: string): Promise<void> {
  await getSavedQuery(id, userId)
  await db
    .delete(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.createdBy, userId)))
}

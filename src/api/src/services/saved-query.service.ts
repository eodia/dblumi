import { eq, and, asc, sql, inArray, or } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '../db/index.js'
import { savedQueries, queryGroups, queryUsers, userGroups, users } from '../db/schema.js'
import type { SavedQuery } from '@dblumi/shared'
import { createVersion } from './saved-query-version.service.js'

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
  folder?: string | null
  sortOrder?: number | null
}

type UpdateSavedQuery = Partial<CreateSavedQuery>

function toView(
  row: typeof savedQueries.$inferSelect,
  shared?: boolean,
  createdByName?: string,
  collaborative?: boolean,
  isCollaborator?: boolean,
): SavedQuery {
  return {
    id: row.id,
    name: row.name,
    sql: row.sql,
    description: row.description ?? undefined,
    connectionId: row.connectionId ?? undefined,
    folder: row.folder ?? undefined,
    sortOrder: row.sortOrder ?? undefined,
    shared: shared ?? undefined,
    collaborative: collaborative ?? undefined,
    isCollaborator: isCollaborator ?? undefined,
    createdBy: row.createdBy,
    createdByName: createdByName ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function checkCollaborator(queryId: string, userId: string): Promise<boolean> {
  const direct = await db
    .select({ queryId: queryUsers.queryId })
    .from(queryUsers)
    .where(and(
      eq(queryUsers.queryId, queryId),
      eq(queryUsers.userId, userId),
      eq(queryUsers.collaborative, true),
    ))
    .limit(1)
  if (direct.length > 0) return true

  const userGroupRows = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId))
  const gIds = userGroupRows.map((r) => r.groupId)
  if (gIds.length === 0) return false

  const viaGroup = await db
    .select({ queryId: queryGroups.queryId })
    .from(queryGroups)
    .where(and(
      eq(queryGroups.queryId, queryId),
      inArray(queryGroups.groupId, gIds),
      eq(queryGroups.collaborative, true),
    ))
    .limit(1)
  return viaGroup.length > 0
}

export async function listSavedQueries(userId: string): Promise<SavedQuery[]> {
  // Own queries
  const ownRows = await db
    .select()
    .from(savedQueries)
    .where(eq(savedQueries.createdBy, userId))
    .orderBy(asc(savedQueries.sortOrder), asc(savedQueries.updatedAt))

  // Queries shared directly with user
  const directSharedRows = await db
    .select({ query: savedQueries })
    .from(queryUsers)
    .innerJoin(savedQueries, eq(queryUsers.queryId, savedQueries.id))
    .where(eq(queryUsers.userId, userId))

  // Queries shared via groups the user belongs to
  const groupRows = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId))
  const groupIds = groupRows.map((r) => r.groupId)

  let groupSharedRows: { query: typeof savedQueries.$inferSelect }[] = []
  if (groupIds.length > 0) {
    groupSharedRows = await db
      .select({ query: savedQueries })
      .from(queryGroups)
      .innerJoin(savedQueries, eq(queryGroups.queryId, savedQueries.id))
      .where(inArray(queryGroups.groupId, groupIds))
  }

  // Deduplicate: own queries take precedence (not marked shared)
  const ownIds = new Set(ownRows.map((r) => r.id))
  const sharedMap = new Map<string, typeof savedQueries.$inferSelect>()
  for (const r of [...directSharedRows, ...groupSharedRows]) {
    if (!ownIds.has(r.query.id) && !sharedMap.has(r.query.id)) {
      sharedMap.set(r.query.id, r.query)
    }
  }

  // Fetch creator names for shared queries
  const sharedRows = Array.from(sharedMap.values())
  const creatorIds = [...new Set(sharedRows.map((r) => r.createdBy))]
  const creatorNames = new Map<string, string>()
  if (creatorIds.length > 0) {
    const creators = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, creatorIds))
    for (const c of creators) creatorNames.set(c.id, c.name)
  }

  // Compute collaborative flags for own queries
  const ownQueryIds = ownRows.map((r) => r.id)
  const collabGroupRows = ownQueryIds.length > 0 ? await db
    .select({ queryId: queryGroups.queryId })
    .from(queryGroups)
    .where(and(inArray(queryGroups.queryId, ownQueryIds), eq(queryGroups.collaborative, true)))
    : []
  const collabUserRows = ownQueryIds.length > 0 ? await db
    .select({ queryId: queryUsers.queryId })
    .from(queryUsers)
    .where(and(inArray(queryUsers.queryId, ownQueryIds), eq(queryUsers.collaborative, true)))
    : []
  const collabQueryIds = new Set([
    ...collabGroupRows.map((r) => r.queryId),
    ...collabUserRows.map((r) => r.queryId),
  ])

  // Compute isCollaborator flags for shared queries
  const sharedQueryIds = sharedRows.map((r) => r.id)
  const userCollabDirect = sharedQueryIds.length > 0 ? await db
    .select({ queryId: queryUsers.queryId })
    .from(queryUsers)
    .where(and(
      inArray(queryUsers.queryId, sharedQueryIds),
      eq(queryUsers.userId, userId),
      eq(queryUsers.collaborative, true),
    ))
    : []
  let userCollabViaGroup: { queryId: string }[] = []
  if (sharedQueryIds.length > 0 && groupIds.length > 0) {
    userCollabViaGroup = await db
      .select({ queryId: queryGroups.queryId })
      .from(queryGroups)
      .where(and(
        inArray(queryGroups.queryId, sharedQueryIds),
        inArray(queryGroups.groupId, groupIds),
        eq(queryGroups.collaborative, true),
      ))
  }
  const userCollabQueryIds = new Set([
    ...userCollabDirect.map((r) => r.queryId),
    ...userCollabViaGroup.map((r) => r.queryId),
  ])

  const own = ownRows.map((r) => toView(r, undefined, undefined, collabQueryIds.has(r.id)))
  const shared = sharedRows.map((r) => toView(
    r, true, creatorNames.get(r.createdBy), undefined, userCollabQueryIds.has(r.id),
  ))
  return [...own, ...shared]
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
    folder: data.folder ?? null,
    sortOrder: data.sortOrder ?? null,
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
  const rows = await db
    .select()
    .from(savedQueries)
    .where(eq(savedQueries.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) throw new SavedQueryError('Requête sauvegardée introuvable.', 'NOT_FOUND')

  const isOwner = row.createdBy === userId
  if (!isOwner) {
    const isCollab = await checkCollaborator(id, userId)
    if (!isCollab) throw new SavedQueryError('Requête sauvegardée introuvable.', 'NOT_FOUND')
  }

  const existing: SavedQuery = toView(row)

  if (data.sql !== undefined && data.sql !== existing.sql) {
    await createVersion(id, existing.sql, userId)
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (data.name !== undefined) updates['name'] = data.name
  if (data.sql !== undefined) updates['sql'] = data.sql
  if ('description' in data) updates['description'] = data.description ?? null
  if ('connectionId' in data) updates['connectionId'] = data.connectionId ?? null
  if ('folder' in data) updates['folder'] = data.folder ?? null
  if ('sortOrder' in data) updates['sortOrder'] = data.sortOrder ?? null

  await db
    .update(savedQueries)
    .set(updates)
    .where(eq(savedQueries.id, id))

  if (isOwner) return getSavedQuery(id, userId)
  const refreshed = await db.select().from(savedQueries).where(eq(savedQueries.id, id)).limit(1)
  return toView(refreshed[0]!, true)
}

export async function deleteSavedQuery(id: string, userId: string): Promise<void> {
  const sq = await getSavedQuery(id, userId)
  if (sq.createdBy !== userId) throw new SavedQueryError('Vous ne pouvez pas supprimer une requête partagée.', 'FORBIDDEN')
  await db
    .delete(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.createdBy, userId)))
}

export async function reorderSavedQueries(
  items: { id: string; sortOrder: number }[],
  userId: string
): Promise<void> {
  await Promise.all(
    items.map(({ id, sortOrder }) =>
      db
        .update(savedQueries)
        .set({ sortOrder })
        .where(and(eq(savedQueries.id, id), eq(savedQueries.createdBy, userId)))
    )
  )
}

import { eq, and, desc, lt } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '../db/index.js'
import { savedQueryVersions, users } from '../db/schema.js'

export async function createVersion(
  queryId: string,
  sqlText: string,
  editedBy: string,
): Promise<void> {
  await db.insert(savedQueryVersions).values({
    id: randomUUID(),
    queryId,
    sql: sqlText,
    editedBy,
    createdAt: new Date().toISOString(),
  })
}

export async function listVersions(
  queryId: string,
  cursor?: string,
  limit = 50,
) {
  const conditions = [eq(savedQueryVersions.queryId, queryId)]
  if (cursor) {
    conditions.push(lt(savedQueryVersions.createdAt, cursor))
  }

  const rows = await db
    .select({
      id: savedQueryVersions.id,
      queryId: savedQueryVersions.queryId,
      sql: savedQueryVersions.sql,
      label: savedQueryVersions.label,
      editedById: savedQueryVersions.editedBy,
      editedByName: users.name,
      createdAt: savedQueryVersions.createdAt,
    })
    .from(savedQueryVersions)
    .innerJoin(users, eq(savedQueryVersions.editedBy, users.id))
    .where(and(...conditions))
    .orderBy(desc(savedQueryVersions.createdAt))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    versions: items.map((r) => ({
      id: r.id,
      queryId: r.queryId,
      sql: r.sql,
      label: r.label,
      editedBy: { id: r.editedById, name: r.editedByName },
      createdAt: r.createdAt,
    })),
    nextCursor: hasMore ? items[items.length - 1]!.createdAt : null,
  }
}

export async function updateVersionLabel(
  versionId: string,
  queryId: string,
  label: string | null,
): Promise<void> {
  await db
    .update(savedQueryVersions)
    .set({ label })
    .where(
      and(
        eq(savedQueryVersions.id, versionId),
        eq(savedQueryVersions.queryId, queryId),
      ),
    )
}

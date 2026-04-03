import { eq, and, desc, lt } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '../db/index.js'
import { collabMessages, users } from '../db/schema.js'

export type ChatMessage = {
  id: string
  userId: string
  userName: string
  avatarUrl: string | null
  content: string
  createdAt: string
}

export async function persistMessage(
  queryId: string,
  userId: string,
  content: string,
): Promise<ChatMessage> {
  const id = randomUUID()
  const createdAt = new Date().toISOString()

  await db.insert(collabMessages).values({
    id,
    queryId,
    userId,
    content,
    createdAt,
  })

  const userRows = await db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const user = userRows[0]

  return {
    id,
    userId,
    userName: user?.name ?? 'Unknown',
    avatarUrl: user?.avatarUrl ?? null,
    content,
    createdAt,
  }
}

export async function listMessages(
  queryId: string,
  before?: string,
  limit = 50,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const conditions = [eq(collabMessages.queryId, queryId)]
  if (before) {
    conditions.push(lt(collabMessages.createdAt, before))
  }

  const rows = await db
    .select({
      id: collabMessages.id,
      userId: collabMessages.userId,
      userName: users.name,
      avatarUrl: users.avatarUrl,
      content: collabMessages.content,
      createdAt: collabMessages.createdAt,
    })
    .from(collabMessages)
    .innerJoin(users, eq(collabMessages.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(collabMessages.createdAt))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return {
    messages: items.reverse().map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      avatarUrl: r.avatarUrl,
      content: r.content,
      createdAt: r.createdAt,
    })),
    hasMore,
  }
}

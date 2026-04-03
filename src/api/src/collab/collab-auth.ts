import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../services/auth.service.js'
import { db } from '../db/index.js'
import { savedQueries, queryUsers, queryGroups, userGroups } from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'

export type CollabUser = {
  userId: string
  name: string
  email: string
}

/**
 * Verify JWT and check that the user is owner or collaborator of the query.
 * Returns user info on success, null on failure.
 */
export async function authenticateCollabUser(
  token: string,
  queryId: string,
): Promise<CollabUser | null> {
  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return null
  }

  if (payload.jti && await isTokenRevoked(payload.jti)) {
    return null
  }

  const userId = payload.sub

  // Check if owner
  const queryRows = await db
    .select({ id: savedQueries.id, createdBy: savedQueries.createdBy })
    .from(savedQueries)
    .where(eq(savedQueries.id, queryId))
    .limit(1)
  if (queryRows.length === 0) return null

  const isOwner = queryRows[0]!.createdBy === userId
  if (isOwner) {
    return { userId, name: payload.email, email: payload.email }
  }

  // Check direct collaborative access
  const directCollab = await db
    .select({ queryId: queryUsers.queryId })
    .from(queryUsers)
    .where(and(
      eq(queryUsers.queryId, queryId),
      eq(queryUsers.userId, userId),
      eq(queryUsers.collaborative, true),
    ))
    .limit(1)
  if (directCollab.length > 0) {
    return { userId, name: payload.email, email: payload.email }
  }

  // Check group collaborative access
  const groupRows = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId))
  const groupIds = groupRows.map((r) => r.groupId)
  if (groupIds.length === 0) return null

  const groupCollab = await db
    .select({ queryId: queryGroups.queryId })
    .from(queryGroups)
    .where(and(
      eq(queryGroups.queryId, queryId),
      inArray(queryGroups.groupId, groupIds),
      eq(queryGroups.collaborative, true),
    ))
    .limit(1)
  if (groupCollab.length > 0) {
    return { userId, name: payload.email, email: payload.email }
  }

  return null
}

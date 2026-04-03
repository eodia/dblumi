# Collaborative Sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collaborative sharing mode that lets designated users/groups edit and save shared queries, with a second ComboboxChips in the share dialog and a UserPlus icon in the sidebar.

**Architecture:** Add a `collaborative` boolean column to `query_groups` and `query_users`. Extend the shares API to accept/return collaborative entries. Modify `updateSavedQuery` to allow collaborators. Extend the share dialog UI with a second ComboboxChips for collaborators with auto-deduplication.

**Tech Stack:** Drizzle ORM (SQLite), Hono, React, Radix Dialog, TanStack React Query, lucide-react

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/api/migrations/0008_collaborative_sharing.sql` | ALTER TABLE migration |

### Modified Files
| File | Change |
|------|--------|
| `src/api/src/db/schema.ts` | Add `collaborative` column to `queryGroups` and `queryUsers` |
| `src/api/migrations/meta/_journal.json` | Add migration entry |
| `src/shared/src/types/query.ts` | Add `collaborative`, `isCollaborator` fields to `SavedQuery` |
| `src/api/src/services/saved-query.service.ts` | Collaborator permission in `updateSavedQuery`, `collaborative`/`isCollaborator` in `listSavedQueries` and `toView` |
| `src/api/src/routes/saved-queries.ts` | Update shares schema, GET/PUT shares with collaborative flag |
| `src/web/src/api/saved-queries.ts` | Update `SavedQuery` type, `setShares` signature, `getShares` return type |
| `src/web/src/components/saved-queries/SavedQueriesPanel.tsx` | Second ComboboxChips, dedup logic, UserPlus icon |
| `src/web/src/i18n/en.ts` | Collaborative keys |
| `src/web/src/i18n/fr.ts` | Collaborative keys |

---

### Task 1: Migration & schema

**Files:**
- Create: `src/api/migrations/0008_collaborative_sharing.sql`
- Modify: `src/api/migrations/meta/_journal.json`
- Modify: `src/api/src/db/schema.ts`

- [ ] **Step 1: Create migration file**

Create `src/api/migrations/0008_collaborative_sharing.sql`:

```sql
ALTER TABLE `query_groups` ADD COLUMN `collaborative` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `query_users` ADD COLUMN `collaborative` integer NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Update migration journal**

Add entry to `src/api/migrations/meta/_journal.json`:

```json
,{
  "idx": 8,
  "version": "6",
  "when": 1774738400000,
  "tag": "0008_collaborative_sharing",
  "breakpoints": true
}
```

- [ ] **Step 3: Update Drizzle schema**

In `src/api/src/db/schema.ts`, add `collaborative` column to both tables.

Replace the `queryGroups` table definition:

```typescript
export const queryGroups = sqliteTable('query_groups', {
  queryId: text('query_id')
    .notNull()
    .references(() => savedQueries.id, { onDelete: 'cascade' }),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  collaborative: integer('collaborative', { mode: 'boolean' }).notNull().default(false),
})
```

Replace the `queryUsers` table definition:

```typescript
export const queryUsers = sqliteTable('query_users', {
  queryId: text('query_id')
    .notNull()
    .references(() => savedQueries.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  collaborative: integer('collaborative', { mode: 'boolean' }).notNull().default(false),
})
```

- [ ] **Step 4: Commit**

```bash
git add src/api/migrations/0008_collaborative_sharing.sql src/api/migrations/meta/_journal.json src/api/src/db/schema.ts
git commit -m "feat: add collaborative column to sharing tables"
```

---

### Task 2: Shared types

**Files:**
- Modify: `src/shared/src/types/query.ts`

- [ ] **Step 1: Add collaborative and isCollaborator to SavedQuerySchema**

In `src/shared/src/types/query.ts`, add two fields to `SavedQuerySchema` before `createdBy`:

```typescript
  collaborative: z.boolean().optional(),
  isCollaborator: z.boolean().optional(),
```

So the schema becomes:

```typescript
export const SavedQuerySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  sql: z.string().min(1),
  connectionId: z.string().uuid().optional(),
  description: z.string().optional(),
  folder: z.string().optional(),
  sortOrder: z.number().int().optional(),
  shared: z.boolean().optional(),
  collaborative: z.boolean().optional(),
  isCollaborator: z.boolean().optional(),
  createdBy: z.string().uuid(),
  createdByName: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/src/types/query.ts
git commit -m "feat: add collaborative fields to SavedQuery type"
```

---

### Task 3: i18n keys

**Files:**
- Modify: `src/web/src/i18n/en.ts`
- Modify: `src/web/src/i18n/fr.ts`

- [ ] **Step 1: Add English keys**

Add after the `'sq.timeline.labelSaved'` line in `en.ts`:

```typescript
  'sq.collaborative': 'Collaborative',
  'sq.collaborativeHint': 'Can edit and save this query',
```

- [ ] **Step 2: Add French keys**

Add after the `'sq.timeline.labelSaved'` line in `fr.ts`:

```typescript
  'sq.collaborative': 'Collaboratif',
  'sq.collaborativeHint': 'Peut modifier et sauvegarder cette requête',
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/i18n/en.ts src/web/src/i18n/fr.ts
git commit -m "feat: add collaborative i18n keys (en + fr)"
```

---

### Task 4: Backend — list queries with collaborative info

**Files:**
- Modify: `src/api/src/services/saved-query.service.ts`

- [ ] **Step 1: Update toView to accept collaborative and isCollaborator**

In `src/api/src/services/saved-query.service.ts`, update the `toView` function signature and body:

```typescript
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
```

- [ ] **Step 2: Update listSavedQueries to compute collaborative flags**

In `listSavedQueries`, we need to:
1. For own queries: check if they have any collaborative share entries (`collaborative = true` in `queryGroups` or `queryUsers`)
2. For shared queries: check if the current user is a collaborator

After the existing `sharedMap` deduplication block (around line 82), add logic to compute collaborative flags.

For own queries — fetch all query IDs that have at least one collaborative share:

```typescript
  // Check which own queries have collaborative shares
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
```

For shared queries — check if the current user has collaborative access (direct or via group):

```typescript
  // Check which shared queries the user can collaborate on
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
```

Then update the return mapping:

```typescript
  const own = ownRows.map((r) => toView(r, undefined, undefined, collabQueryIds.has(r.id)))
  const shared = sharedRows.map((r) => toView(
    r, true, creatorNames.get(r.createdBy), undefined, userCollabQueryIds.has(r.id),
  ))
  return [...own, ...shared]
```

- [ ] **Step 3: Add `eq` import if missing**

Make sure the imports at the top of the file include `and` (it may already be there, check first):

```typescript
import { eq, and, asc, sql, inArray, or } from 'drizzle-orm'
```

And import `queryGroups` and `queryUsers` from the schema if not already imported:

```typescript
import { savedQueries, queryGroups, queryUsers, userGroups, users } from '../db/schema.js'
```

- [ ] **Step 4: Commit**

```bash
git add src/api/src/services/saved-query.service.ts
git commit -m "feat: compute collaborative flags in listSavedQueries"
```

---

### Task 5: Backend — collaborator can update

**Files:**
- Modify: `src/api/src/services/saved-query.service.ts`

- [ ] **Step 1: Add isCollaborator helper function**

Add this function after the `toView` function:

```typescript
async function checkCollaborator(queryId: string, userId: string): Promise<boolean> {
  // Direct collaborative access
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

  // Via group
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
```

- [ ] **Step 2: Modify updateSavedQuery to allow collaborators**

In the `updateSavedQuery` function, replace the existing ownership check:

```typescript
  const existing = await getSavedQuery(id, userId)
```

The problem is `getSavedQuery` throws if the user is not the owner. We need a different approach for collaborators. Replace the beginning of `updateSavedQuery` with:

```typescript
export async function updateSavedQuery(
  id: string,
  data: UpdateSavedQuery,
  userId: string
): Promise<SavedQuery> {
  // Try as owner first
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

  // Snapshot the old SQL before overwriting if it changed
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

  // Return refreshed query — use getSavedQuery for owner, direct fetch for collaborator
  if (isOwner) return getSavedQuery(id, userId)
  const refreshed = await db.select().from(savedQueries).where(eq(savedQueries.id, id)).limit(1)
  return toView(refreshed[0]!, true)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/src/services/saved-query.service.ts
git commit -m "feat: allow collaborators to update saved queries"
```

---

### Task 6: Backend — shares API with collaborative flag

**Files:**
- Modify: `src/api/src/routes/saved-queries.ts`

- [ ] **Step 1: Update SharesSchema**

Replace the existing `SharesSchema`:

```typescript
const SharesSchema = z.object({
  groupIds: z.array(z.string().uuid()),
  userIds: z.array(z.string().uuid()),
  collabGroupIds: z.array(z.string().uuid()).default([]),
  collabUserIds: z.array(z.string().uuid()).default([]),
})
```

- [ ] **Step 2: Update GET /:id/shares**

Replace the GET shares route to include the `collaborative` flag:

```typescript
savedQueriesRouter.get('/:id/shares', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  try {
    await getSavedQuery(id, userId)
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
  const groupRows = await db
    .select({ id: groups.id, name: groups.name, color: groups.color, collaborative: queryGroups.collaborative })
    .from(queryGroups)
    .innerJoin(groups, eq(queryGroups.groupId, groups.id))
    .where(eq(queryGroups.queryId, id))
  const userRows = await db
    .select({ id: users.id, name: users.name, email: users.email, collaborative: queryUsers.collaborative })
    .from(queryUsers)
    .innerJoin(users, eq(queryUsers.userId, users.id))
    .where(eq(queryUsers.queryId, id))
  return c.json({ groups: groupRows, users: userRows })
})
```

- [ ] **Step 3: Update PUT /:id/shares**

Replace the PUT shares route to handle collaborative entries with deduplication:

```typescript
savedQueriesRouter.put('/:id/shares', zValidator('json', SharesSchema), async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  try {
    await getSavedQuery(id, userId)
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
  const { groupIds, userIds, collabGroupIds, collabUserIds } = c.req.valid('json')

  // Deduplicate: collaborative wins over read-only
  const readOnlyGroups = groupIds.filter((gid) => !collabGroupIds.includes(gid))
  const readOnlyUsers = userIds.filter((uid) => !collabUserIds.includes(uid))

  // Replace query groups
  await db.delete(queryGroups).where(eq(queryGroups.queryId, id))
  const groupValues = [
    ...readOnlyGroups.map((groupId) => ({ queryId: id, groupId, collaborative: false })),
    ...collabGroupIds.map((groupId) => ({ queryId: id, groupId, collaborative: true })),
  ]
  if (groupValues.length > 0) {
    await db.insert(queryGroups).values(groupValues)
  }

  // Replace query users
  await db.delete(queryUsers).where(eq(queryUsers.queryId, id))
  const userValues = [
    ...readOnlyUsers.map((uid) => ({ queryId: id, userId: uid, collaborative: false })),
    ...collabUserIds.map((uid) => ({ queryId: id, userId: uid, collaborative: true })),
  ]
  if (userValues.length > 0) {
    await db.insert(queryUsers).values(userValues)
  }

  return c.json({ groupIds: readOnlyGroups, userIds: readOnlyUsers, collabGroupIds, collabUserIds })
})
```

- [ ] **Step 4: Commit**

```bash
git add src/api/src/routes/saved-queries.ts
git commit -m "feat: shares API with collaborative flag"
```

---

### Task 7: Frontend API client update

**Files:**
- Modify: `src/web/src/api/saved-queries.ts`

- [ ] **Step 1: Update SavedQuery type**

Add `collaborative` and `isCollaborator` fields:

```typescript
export type SavedQuery = {
  id: string
  name: string
  sql: string
  description?: string
  connectionId?: string
  folder?: string
  sortOrder?: number
  shared?: boolean
  collaborative?: boolean
  isCollaborator?: boolean
  createdBy: string
  createdByName?: string
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Update setShares to accept collaborative lists**

Replace the `setShares` method:

```typescript
  setShares: (id: string, groupIds: string[], userIds: string[], collabGroupIds: string[], collabUserIds: string[]) =>
    api.put<{ groupIds: string[]; userIds: string[]; collabGroupIds: string[]; collabUserIds: string[] }>(
      `/saved-queries/${id}/shares`, { groupIds, userIds, collabGroupIds, collabUserIds },
    ),
```

- [ ] **Step 3: Update getShares return type**

Replace the `getShares` method:

```typescript
  getShares: (id: string) =>
    api.get<{
      groups: Array<{ id: string; name: string; color: string | null; collaborative: boolean }>
      users: Array<{ id: string; name: string; email: string; collaborative: boolean }>
    }>(`/saved-queries/${id}/shares`),
```

- [ ] **Step 4: Commit**

```bash
git add src/web/src/api/saved-queries.ts
git commit -m "feat: update saved-queries API client for collaborative sharing"
```

---

### Task 8: UI — Share dialog with collaborative ComboboxChips + UserPlus icon

**Files:**
- Modify: `src/web/src/components/saved-queries/SavedQueriesPanel.tsx`

- [ ] **Step 1: Add UserPlus import**

In the lucide-react import line, add `UserPlus`:

```typescript
import { FileCode2, Folder, FolderOpen, GripVertical, Pencil, Trash2, FolderInput, FolderPlus, Search, Copy, Share2, History, UserPlus } from 'lucide-react'
```

- [ ] **Step 2: Add collabIds state**

After the existing `const [shareIds, setShareIds] = useState<string[]>([])` line, add:

```typescript
const [collabIds, setCollabIds] = useState<string[]>([])
```

- [ ] **Step 3: Update share sync logic**

Replace the existing share sync block (around lines 240-244):

```typescript
  if (querySharesData && shareQueryId && sharesSynced !== shareQueryId) {
    setShareIds([
      ...(querySharesData.groups ?? []).filter((g) => !g.collaborative).map((g) => `g:${g.id}`),
      ...(querySharesData.users ?? []).filter((u) => !u.collaborative).map((u) => `u:${u.id}`),
    ])
    setCollabIds([
      ...(querySharesData.groups ?? []).filter((g) => g.collaborative).map((g) => `g:${g.id}`),
      ...(querySharesData.users ?? []).filter((u) => u.collaborative).map((u) => `u:${u.id}`),
    ])
    setSharesSynced(shareQueryId)
  }
```

- [ ] **Step 4: Add dedup helpers**

After the share sync block, add two handler functions that auto-deduplicate between the two lists:

```typescript
  const handleShareChange = (ids: string[]) => {
    setShareIds(ids)
    setCollabIds((prev) => prev.filter((id) => !ids.includes(id)))
  }
  const handleCollabChange = (ids: string[]) => {
    setCollabIds(ids)
    setShareIds((prev) => prev.filter((id) => !ids.includes(id)))
  }
```

- [ ] **Step 5: Update share dialog UI**

In the share dialog, replace the single `ComboboxChips` and the save button's `onClick`:

Replace the `<div className="space-y-3">` block inside the share dialog:

```tsx
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('sq.share')}</Label>
              <ComboboxChips
                options={[
                  ...shareGroups.map((g) => ({ id: `g:${g.id}`, label: g.name, color: g.color ?? undefined })),
                  ...shareUsers.map((u) => ({ id: `u:${u.id}`, label: `${u.name} (${u.email})`, minQuery: 3 })),
                ]}
                selected={shareIds}
                onChange={handleShareChange}
                placeholder={t('admin.addMembers')}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('sq.collaborative')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('sq.collaborativeHint')}</p>
              <ComboboxChips
                options={[
                  ...shareGroups.map((g) => ({ id: `g:${g.id}`, label: g.name, color: g.color ?? undefined })),
                  ...shareUsers.map((u) => ({ id: `u:${u.id}`, label: `${u.name} (${u.email})`, minQuery: 3 })),
                ]}
                selected={collabIds}
                onChange={handleCollabChange}
                placeholder={t('admin.addMembers')}
              />
            </div>
          </div>
```

- [ ] **Step 6: Update save handler**

Replace the save button's `onClick` in the share dialog:

```tsx
            <Button size="sm" onClick={() => {
              if (!shareQueryId) return
              const groupIds = shareIds.filter((id) => id.startsWith('g:')).map((id) => id.slice(2))
              const userIds = shareIds.filter((id) => id.startsWith('u:')).map((id) => id.slice(2))
              const collabGroupIds = collabIds.filter((id) => id.startsWith('g:')).map((id) => id.slice(2))
              const collabUserIds = collabIds.filter((id) => id.startsWith('u:')).map((id) => id.slice(2))
              savedQueriesApi.setShares(shareQueryId, groupIds, userIds, collabGroupIds, collabUserIds).then(() => {
                qc.invalidateQueries({ queryKey: ['saved-queries'] })
                qc.invalidateQueries({ queryKey: ['query-shares'] })
                setShareQueryId(null)
                setSharesSynced(null)
              })
            }}>{t('sheet.save')}</Button>
```

- [ ] **Step 7: Reset collabIds when closing dialog**

Update the dialog's `onOpenChange` and cancel button to also reset `collabIds`:

Dialog `onOpenChange`:
```tsx
<Dialog open={shareQueryId !== null} onOpenChange={(o) => { if (!o) { setShareQueryId(null); setSharesSynced(null); setCollabIds([]) } }}>
```

Cancel button:
```tsx
<Button variant="ghost" size="sm" onClick={() => { setShareQueryId(null); setSharesSynced(null); setCollabIds([]) }}>{t('common.cancel')}</Button>
```

- [ ] **Step 8: Update icons in sidebar**

In the `QueryItem` component, replace the share icon rendering. Find this line:

```tsx
{query.shared && <Share2 className="h-2.5 w-2.5 flex-shrink-0 text-text-muted/40" />}
```

Replace with:

```tsx
{query.collaborative ? (
  <UserPlus className="h-2.5 w-2.5 flex-shrink-0 text-text-muted/40" />
) : query.shared && (
  <Share2 className="h-2.5 w-2.5 flex-shrink-0 text-text-muted/40" />
)}
```

Also update the shared queries section at the bottom of the panel. Find the shared query items rendering (around line 462) and update the icon there too:

```tsx
{q.isCollaborator ? (
  <UserPlus className="h-2.5 w-2.5 flex-shrink-0 text-text-muted/40" />
) : (
  <Share2 className="h-2.5 w-2.5 flex-shrink-0 text-text-muted/40" />
)}
```

- [ ] **Step 9: Commit**

```bash
git add src/web/src/components/saved-queries/SavedQueriesPanel.tsx
git commit -m "feat: collaborative sharing UI with dedup and UserPlus icon"
```

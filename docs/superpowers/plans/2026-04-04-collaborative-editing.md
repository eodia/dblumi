# Collaborative Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real-time collaborative SQL editing on shared queries using Yjs CRDT over WebSocket, with remote cursors and avatar presence in the editor toolbar.

**Architecture:** A WebSocket endpoint on the existing Hono server relays Yjs sync/awareness messages between clients editing the same query. Each client binds CodeMirror to a Yjs Y.Text via y-codemirror.next. Documents are ephemeral in memory; SQLite remains source of truth via explicit save (Ctrl+S).

**Tech Stack:** Yjs, y-websocket, y-codemirror.next, ws (Node.js WebSocket), @hono/node-ws, CodeMirror 6

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/api/src/collab/collab-server.ts` | Yjs document management + WebSocket message relay |
| `src/api/src/collab/collab-auth.ts` | JWT verification + collaborator permission check for WS |
| `src/web/src/collab/collab-provider.ts` | Factory: create Y.Doc + WebsocketProvider + awareness setup |
| `src/web/src/collab/collab-extensions.ts` | CodeMirror extensions for collaborative mode (yCollab, undo) |
| `src/web/src/components/editor/CollabAvatars.tsx` | Presence avatar row component |

### Modified Files
| File | Change |
|------|--------|
| `src/api/src/index.ts` | Attach WebSocket upgrade handler to HTTP server |
| `src/web/src/stores/editor.store.ts` | Add `collaborative` flag to QueryTab, manage collab lifecycle |
| `src/web/src/components/editor/SqlEditor.tsx` | Conditional collab extensions, pass collaborative flag |
| `src/web/src/i18n/en.ts` | Collab i18n keys |
| `src/web/src/i18n/fr.ts` | Collab i18n keys |

---

### Task 1: Install dependencies

**Files:**
- Modify: `src/api/package.json`
- Modify: `src/web/package.json`

- [ ] **Step 1: Install server dependencies**

```bash
cd src/api && pnpm add ws yjs y-protocols lib0
```

- [ ] **Step 2: Install client dependencies**

```bash
cd src/web && pnpm add yjs y-websocket y-codemirror.next y-protocols
```

- [ ] **Step 3: Commit**

```bash
git add src/api/package.json src/web/package.json pnpm-lock.yaml
git commit -m "chore: add Yjs and WebSocket dependencies"
```

---

### Task 2: i18n keys

**Files:**
- Modify: `src/web/src/i18n/en.ts`
- Modify: `src/web/src/i18n/fr.ts`

- [ ] **Step 1: Add English keys**

Add after the `'sq.collaborativeHint'` line in `en.ts`:

```typescript
  'collab.connected': 'Connected',
  'collab.disconnected': 'Disconnected',
  'collab.reconnecting': 'Reconnecting...',
  'collab.participants': '{count} participant(s)',
```

- [ ] **Step 2: Add French keys**

Add after the `'sq.collaborativeHint'` line in `fr.ts`:

```typescript
  'collab.connected': 'Connecté',
  'collab.disconnected': 'Déconnecté',
  'collab.reconnecting': 'Reconnexion...',
  'collab.participants': '{count} participant(s)',
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/i18n/en.ts src/web/src/i18n/fr.ts
git commit -m "feat: add collab i18n keys (en + fr)"
```

---

### Task 3: Collab auth helper (server)

**Files:**
- Create: `src/api/src/collab/collab-auth.ts`

- [ ] **Step 1: Create the auth helper**

Create `src/api/src/collab/collab-auth.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/api/src/collab/collab-auth.ts
git commit -m "feat: collab auth helper for WebSocket connections"
```

---

### Task 4: Collab server (Yjs document relay)

**Files:**
- Create: `src/api/src/collab/collab-server.ts`

- [ ] **Step 1: Create the collab server**

Create `src/api/src/collab/collab-server.ts`:

```typescript
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { WebSocket } from 'ws'
import { db } from '../db/index.js'
import { savedQueries } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { logger } from '../logger.js'

const MSG_SYNC = 0
const MSG_AWARENESS = 1

type CollabDoc = {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  connections: Map<WebSocket, number> // ws -> awareness clientId
}

const docs = new Map<string, CollabDoc>()

async function getOrCreateDoc(queryId: string): Promise<CollabDoc> {
  const existing = docs.get(queryId)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)

  // Load initial SQL from database
  const rows = await db
    .select({ sql: savedQueries.sql })
    .from(savedQueries)
    .where(eq(savedQueries.id, queryId))
    .limit(1)

  if (rows[0]) {
    const ytext = doc.getText('sql')
    ytext.insert(0, rows[0].sql)
  }

  const collabDoc: CollabDoc = { doc, awareness, connections: new Map() }
  docs.set(queryId, collabDoc)

  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = added.concat(updated, removed)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    )
    const msg = encoding.toUint8Array(encoder)
    broadcastToOthers(collabDoc, null, msg)
  })

  logger.info({ queryId }, 'Collab document created')
  return collabDoc
}

function broadcastToOthers(collabDoc: CollabDoc, sender: WebSocket | null, msg: Uint8Array) {
  for (const [ws] of collabDoc.connections) {
    if (ws !== sender && ws.readyState === 1) {
      ws.send(msg)
    }
  }
}

function destroyDocIfEmpty(queryId: string) {
  const collabDoc = docs.get(queryId)
  if (!collabDoc || collabDoc.connections.size > 0) return
  collabDoc.awareness.destroy()
  collabDoc.doc.destroy()
  docs.delete(queryId)
  logger.info({ queryId }, 'Collab document destroyed')
}

export async function handleCollabConnection(
  ws: WebSocket,
  queryId: string,
  clientId: number,
) {
  const collabDoc = await getOrCreateDoc(queryId)
  collabDoc.connections.set(ws, clientId)

  // Send initial sync step 1
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MSG_SYNC)
  syncProtocol.writeSyncStep1(encoder, collabDoc.doc)
  ws.send(encoding.toUint8Array(encoder))

  // Send current awareness state
  const awarenessStates = awarenessProtocol.encodeAwarenessUpdate(
    collabDoc.awareness,
    Array.from(collabDoc.awareness.getStates().keys()),
  )
  const awarenessEncoder = encoding.createEncoder()
  encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS)
  encoding.writeVarUint8Array(awarenessEncoder, awarenessStates)
  ws.send(encoding.toUint8Array(awarenessEncoder))

  ws.on('message', (rawData: ArrayBuffer | Buffer) => {
    const data = new Uint8Array(rawData instanceof ArrayBuffer ? rawData : rawData.buffer)
    const decoder = decoding.createDecoder(data)
    const msgType = decoding.readVarUint(decoder)

    if (msgType === MSG_SYNC) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MSG_SYNC)
      syncProtocol.readSyncMessage(decoder, encoder, collabDoc.doc, null)
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder))
      }
      // Broadcast doc update to others
      const updateEncoder = encoding.createEncoder()
      encoding.writeVarUint(updateEncoder, MSG_SYNC)
      syncProtocol.writeSyncStep2(updateEncoder, collabDoc.doc)
      broadcastToOthers(collabDoc, ws, encoding.toUint8Array(updateEncoder))
    } else if (msgType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder)
      awarenessProtocol.applyAwarenessUpdate(collabDoc.awareness, update, ws)
      // Broadcast awareness to others
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MSG_AWARENESS)
      encoding.writeVarUint8Array(encoder, update)
      broadcastToOthers(collabDoc, ws, encoding.toUint8Array(encoder))
    }
  })

  ws.on('close', () => {
    collabDoc.connections.delete(ws)
    awarenessProtocol.removeAwarenessStates(collabDoc.awareness, [clientId], null)
    destroyDocIfEmpty(queryId)
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/src/collab/collab-server.ts
git commit -m "feat: Yjs collab server with document relay"
```

---

### Task 5: Wire WebSocket into Hono server

**Files:**
- Modify: `src/api/src/index.ts`

- [ ] **Step 1: Add WebSocket upgrade handler**

Replace the entire `src/api/src/index.ts` with:

```typescript
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import { logger } from './logger.js'
import { app } from './app.js'
import { runMigrations } from './db/migrate.js'
import { authenticateCollabUser } from './collab/collab-auth.js'
import { handleCollabConnection } from './collab/collab-server.js'

async function main() {
  await runMigrations()

  const server = serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      logger.info(
        { port: info.port, url: config.BASE_URL },
        `🚀 dblumi API listening on port ${info.port}`
      )
    }
  )

  // WebSocket server for collaborative editing
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`)
    const match = url.pathname.match(/^\/ws\/collab\/([a-f0-9-]+)$/)

    if (!match) {
      socket.destroy()
      return
    }

    const queryId = match[1]!
    const token = url.searchParams.get('token')

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const user = await authenticateCollabUser(token, queryId)
    if (!user) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const clientId = Math.floor(Math.random() * 2147483647)
      logger.info({ queryId, userId: user.userId }, 'Collab WebSocket connected')
      handleCollabConnection(ws, queryId, clientId)
    })
  })
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error')
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add src/api/src/index.ts
git commit -m "feat: wire WebSocket upgrade for collab into Hono server"
```

---

### Task 6: Editor store — collaborative flag on QueryTab

**Files:**
- Modify: `src/web/src/stores/editor.store.ts`

- [ ] **Step 1: Add collaborative field to QueryTab**

In the `QueryTab` type, add after `connectionId`:

```typescript
  collaborative: boolean
```

- [ ] **Step 2: Update makeQueryTab**

Add `collaborative: false` to the `makeQueryTab` function return.

- [ ] **Step 3: Update makeTableTab**

Add `collaborative: false` to the `makeTableTab` function return.

- [ ] **Step 4: Update openQuery to accept collaborative flag**

Find the `openQuery` method. It currently takes `(sql, name, savedQueryId?)`. Add a fourth parameter `collaborative?: boolean`. In the tab creation, set `collaborative: collaborative ?? false`.

Look for the `openQuery` implementation inside the Zustand store `set` call. The new tab creation should include `collaborative: collaborative ?? false`.

- [ ] **Step 5: Commit**

```bash
git add src/web/src/stores/editor.store.ts
git commit -m "feat: add collaborative flag to QueryTab"
```

---

### Task 7: Collab provider (client)

**Files:**
- Create: `src/web/src/collab/collab-provider.ts`

- [ ] **Step 1: Create the collab provider factory**

Create `src/web/src/collab/collab-provider.ts`:

```typescript
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Awareness } from 'y-protocols/awareness'

const COLLAB_COLORS = [
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf',
]

export type CollabInstance = {
  doc: Y.Doc
  provider: WebsocketProvider
  awareness: Awareness
  ytext: Y.Text
  destroy: () => void
}

export function createCollabInstance(
  queryId: string,
  token: string,
  user: { userId: string; name: string; avatarUrl: string | null },
): CollabInstance {
  const doc = new Y.Doc()
  const ytext = doc.getText('sql')

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.host}`

  const provider = new WebsocketProvider(
    wsUrl,
    queryId,
    doc,
    {
      params: { token },
      connect: true,
      WebSocketPolyfill: undefined as unknown as typeof WebSocket,
    },
  )

  // Override the URL to use /ws/collab/ path
  // y-websocket constructs URL as: wsUrl/roomName
  // We need: wsUrl/ws/collab/roomName?token=...
  // So set wsUrl to include /ws/collab prefix
  provider.url = `${wsUrl}/ws/collab/${queryId}?token=${encodeURIComponent(token)}`
  provider.disconnect()
  provider.connect()

  const awareness = provider.awareness

  // Pick a color not yet used by others
  const usedColors = new Set<string>()
  awareness.getStates().forEach((state) => {
    if (state.color) usedColors.add(state.color)
  })
  const color = COLLAB_COLORS.find((c) => !usedColors.has(c)) ?? COLLAB_COLORS[0]!

  // Set local awareness state
  awareness.setLocalStateField('user', {
    userId: user.userId,
    name: user.name,
    avatarUrl: user.avatarUrl,
    color,
  })

  return {
    doc,
    provider,
    awareness,
    ytext,
    destroy: () => {
      provider.disconnect()
      provider.destroy()
      doc.destroy()
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/collab/collab-provider.ts
git commit -m "feat: collab provider factory (Y.Doc + WebSocket + awareness)"
```

---

### Task 8: Collab CodeMirror extensions

**Files:**
- Create: `src/web/src/collab/collab-extensions.ts`

- [ ] **Step 1: Create the extensions module**

Create `src/web/src/collab/collab-extensions.ts`:

```typescript
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { keymap } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { Y } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

/**
 * Returns CodeMirror extensions for collaborative editing.
 * These replace the standard history() and historyKeymap.
 */
export function collabExtensions(
  ytext: Y.Text,
  awareness: Awareness,
): Extension[] {
  return [
    yCollab(ytext, awareness, { undoManager: null }),
    keymap.of(yUndoManagerKeymap),
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/collab/collab-extensions.ts
git commit -m "feat: CodeMirror collab extensions (yCollab + undo keymap)"
```

---

### Task 9: CollabAvatars component

**Files:**
- Create: `src/web/src/components/editor/CollabAvatars.tsx`

- [ ] **Step 1: Create the avatars component**

Create `src/web/src/components/editor/CollabAvatars.tsx`:

```tsx
import { useState, useEffect } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'

type Participant = {
  clientId: number
  userId: string
  name: string
  avatarUrl: string | null
  color: string
}

const MAX_VISIBLE = 5

export function CollabAvatars({
  awareness,
  currentUserId,
}: {
  awareness: Awareness | null
  currentUserId: string
}) {
  const [participants, setParticipants] = useState<Participant[]>([])

  useEffect(() => {
    if (!awareness) return

    const update = () => {
      const states = awareness.getStates()
      const list: Participant[] = []
      states.forEach((state, clientId) => {
        const user = state.user as Participant | undefined
        if (user && user.userId !== currentUserId) {
          list.push({ ...user, clientId })
        }
      })
      setParticipants(list)
    }

    update()
    awareness.on('change', update)
    return () => { awareness.off('change', update) }
  }, [awareness, currentUserId])

  if (participants.length === 0) return null

  const visible = participants.slice(0, MAX_VISIBLE)
  const overflow = participants.length - MAX_VISIBLE

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center -space-x-2">
        {visible.map((p) => (
          <Tooltip key={p.clientId}>
            <TooltipTrigger asChild>
              <div
                className="relative flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold cursor-default"
                style={{
                  border: `2px solid ${p.color}`,
                  backgroundColor: p.avatarUrl ? 'transparent' : p.color + '25',
                  color: p.color,
                }}
              >
                {p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt={p.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  getInitials(p.name)
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{p.name}</p>
            </TooltipContent>
          </Tooltip>
        ))}
        {overflow > 0 && (
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground border-2 border-border">
            +{overflow}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

function getInitials(name: string): string {
  const parts = name.split(/[\s@]+/)
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/editor/CollabAvatars.tsx
git commit -m "feat: CollabAvatars presence component"
```

---

### Task 10: Integrate collab into SqlEditor

**Files:**
- Modify: `src/web/src/components/editor/SqlEditor.tsx`

This is the critical integration task. The SqlEditor must conditionally use Yjs extensions when the active tab is collaborative.

- [ ] **Step 1: Add imports**

Add at the top of `SqlEditor.tsx`:

```typescript
import { useRef as useRefState } from 'react'
import { createCollabInstance, type CollabInstance } from '@/collab/collab-provider'
import { collabExtensions } from '@/collab/collab-extensions'
import { CollabAvatars } from './CollabAvatars'
import { useAuthStore } from '@/stores/auth.store'
```

- [ ] **Step 2: Add collab lifecycle management**

Inside the `SqlEditor` component, after the existing `viewRef` and compartment refs, add:

```typescript
  const collabRef = useRef<CollabInstance | null>(null)
  const collabCompartment = useRef(new Compartment())
  const user = useAuthStore((s) => s.user)
  const isCollaborative = activeTab?.collaborative ?? false
```

Add a `useEffect` that manages the collab lifecycle based on the active tab:

```typescript
  // Manage collab connection lifecycle
  useEffect(() => {
    const view = viewRef.current
    if (!view || !activeTab) return

    if (isCollaborative && activeTab.savedQueryId && user) {
      // Get token from cookie
      const tokenMatch = document.cookie.match(/dblumi_token=([^;]+)/)
      const token = tokenMatch?.[1]
      if (!token) return

      const instance = createCollabInstance(
        activeTab.savedQueryId,
        token,
        { userId: user.id, name: user.name, avatarUrl: user.avatarUrl ?? null },
      )
      collabRef.current = instance

      // Reconfigure editor with collab extensions
      view.dispatch({
        effects: collabCompartment.current.reconfigure(
          collabExtensions(instance.ytext, instance.awareness),
        ),
      })

      // Sync Yjs text changes back to store
      const observer = () => {
        const text = instance.ytext.toString()
        if (text !== useEditorStore.getState().tabs.find(t => t.id === activeTabId)?.sql) {
          setSql(text)
        }
      }
      instance.ytext.observe(observer)

      return () => {
        instance.ytext.unobserve(observer)
        view.dispatch({
          effects: collabCompartment.current.reconfigure([]),
        })
        instance.destroy()
        collabRef.current = null
      }
    } else {
      // Not collaborative — ensure collab extensions are removed
      if (collabRef.current) {
        view.dispatch({
          effects: collabCompartment.current.reconfigure([]),
        })
        collabRef.current.destroy()
        collabRef.current = null
      }
    }
  }, [activeTabId, isCollaborative, activeTab?.savedQueryId, user])
```

- [ ] **Step 3: Add collabCompartment to editor extensions**

In the `EditorState.create` call inside the initial `useEffect`, add the collab compartment. Add this line after the `EditorView.lineWrapping` extension:

```typescript
          // Collab (empty by default, reconfigured when collaborative)
          collabCompartment.current.of([]),
```

- [ ] **Step 4: Conditionally disable history in collab mode**

In the initial `useEffect` editor creation, wrap `history()` and `historyKeymap` in the collab compartment is not the right approach (they're in the base extensions). Instead, use another compartment for history:

Add a new ref:
```typescript
  const historyCompartment = useRef(new Compartment())
```

In the `EditorState.create` extensions array, replace:
```typescript
          history(),
```
with:
```typescript
          historyCompartment.current.of(history()),
```

And replace:
```typescript
            ...historyKeymap,
```
with:
```typescript
            ...(isCollaborative ? [] : historyKeymap),
```

In the collab lifecycle `useEffect`, when enabling collab, also disable history:
```typescript
      view.dispatch({
        effects: [
          collabCompartment.current.reconfigure(
            collabExtensions(instance.ytext, instance.awareness),
          ),
          historyCompartment.current.reconfigure([]),
        ],
      })
```

When disabling collab, re-enable history:
```typescript
      view.dispatch({
        effects: [
          collabCompartment.current.reconfigure([]),
          historyCompartment.current.reconfigure(history()),
        ],
      })
```

- [ ] **Step 5: Render CollabAvatars in the editor toolbar**

The SqlEditor component returns JSX with a context menu wrapping the editor div. Add `CollabAvatars` above the editor. Find the return statement and add the avatars component. The component should be rendered at the top of the editor area, only when collaborative:

```tsx
  return (
    <>
      {isCollaborative && (
        <div className="flex items-center justify-end px-2 py-1 border-b border-border-subtle">
          <CollabAvatars
            awareness={collabRef.current?.awareness ?? null}
            currentUserId={user?.id ?? ''}
          />
        </div>
      )}
      <ContextMenu>
        {/* existing editor JSX */}
      </ContextMenu>
    </>
  )
```

NOTE: Check the current JSX return structure of SqlEditor before placing the avatars. The avatars bar should be above the CodeMirror editor container.

- [ ] **Step 6: Commit**

```bash
git add src/web/src/components/editor/SqlEditor.tsx
git commit -m "feat: integrate Yjs collab into SqlEditor with presence avatars"
```

---

### Task 11: Pass collaborative flag when opening queries

**Files:**
- Modify: `src/web/src/components/saved-queries/SavedQueriesPanel.tsx`

- [ ] **Step 1: Update openQuery calls to pass collaborative flag**

In the `renderItem` function, the `onLoad` callback currently calls:
```typescript
openQuery(q.sql, q.name, q.id)
```

Update it to pass the collaborative flag:
```typescript
openQuery(q.sql, q.name, q.id, q.collaborative || false)
```

Also update the shared queries section where `openQuery` is called for shared queries:
```typescript
openQuery(q.sql, q.name, undefined, q.isCollaborator || false)
```

Note: for shared queries, the `savedQueryId` is not passed (they open read-only or as collaborator). If `isCollaborator` is true, we need to pass the `q.id` so the collab provider can connect:
```typescript
openQuery(q.sql, q.name, q.isCollaborator ? q.id : undefined, q.isCollaborator || false)
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/saved-queries/SavedQueriesPanel.tsx
git commit -m "feat: pass collaborative flag when opening saved queries"
```

---

### Task 12: Manual testing

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test the full flow**

1. Create a saved query, share it with another user as "Collaboratif"
2. Open the query as the owner in browser tab 1
3. Open the query as the collaborator in browser tab 2 (incognito or different browser)
4. Verify both editors sync in real-time
5. Verify cursors are visible with colors
6. Verify avatars appear in the toolbar
7. Verify Ctrl+S saves for both users
8. Verify closing one tab removes the avatar from the other
9. Verify reopening after all close re-initializes from database

- [ ] **Step 3: Fix any issues**

- [ ] **Step 4: Final commit if needed**

```bash
git add -u
git commit -m "fix: collab polish after manual testing"
```

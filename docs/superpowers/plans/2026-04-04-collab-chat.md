# Collab Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent chat panel for collaborative editing sessions, with real-time messages over WebSocket, message history, click-to-cursor on avatars, and unread badges.

**Architecture:** New `collab_messages` table for persistence. Chat messages are sent/received via a custom `MSG_CHAT` type on the existing Yjs WebSocket. The chat panel lives in the right sidebar alongside (mutually exclusive with) the Copilot panel. The editor store tracks unread counts per tab.

**Tech Stack:** Drizzle ORM (SQLite), WebSocket (lib0 encoding), React, Radix, TanStack React Query, Zustand

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/api/migrations/0009_collab_messages.sql` | Migration |
| `src/api/src/services/collab-message.service.ts` | Persist + list messages |
| `src/web/src/api/collab-messages.ts` | Frontend API client for history |
| `src/web/src/components/editor/CollabChat.tsx` | Chat panel component |

### Modified Files
| File | Change |
|------|--------|
| `src/api/src/db/schema.ts` | Add `collabMessages` table |
| `src/api/migrations/meta/_journal.json` | Migration entry |
| `src/api/src/collab/collab-server.ts` | Handle `MSG_CHAT`, store userId per connection, persist + broadcast |
| `src/api/src/routes/saved-queries.ts` | Add GET `/:id/messages` route |
| `src/web/src/collab/collab-provider.ts` | Expose `onChatMessage` callback, `sendChatMessage` method |
| `src/web/src/components/editor/CollabAvatars.tsx` | Add chat button with badge, click avatar → scroll to cursor |
| `src/web/src/stores/editor.store.ts` | Unread count per tab, chat open state |
| `src/web/src/components/layout/AppShell.tsx` | Render CollabChat panel alongside Copilot (mutually exclusive) |
| `src/web/src/i18n/en.ts` | Chat i18n keys |
| `src/web/src/i18n/fr.ts` | Chat i18n keys |

---

### Task 1: Migration & schema

**Files:**
- Create: `src/api/migrations/0009_collab_messages.sql`
- Modify: `src/api/migrations/meta/_journal.json`
- Modify: `src/api/src/db/schema.ts`

- [ ] **Step 1: Create migration**

Create `src/api/migrations/0009_collab_messages.sql`:

```sql
CREATE TABLE `collab_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (`query_id`) REFERENCES `saved_queries`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_collab_msg_query_created` ON `collab_messages` (`query_id`, `created_at` ASC);
```

- [ ] **Step 2: Update migration journal**

Add to `src/api/migrations/meta/_journal.json`:

```json
,{
  "idx": 9,
  "version": "6",
  "when": 1774738500000,
  "tag": "0009_collab_messages",
  "breakpoints": true
}
```

- [ ] **Step 3: Add Drizzle schema**

Add to `src/api/src/db/schema.ts` after the `savedQueryVersions` table:

```typescript
export const collabMessages = sqliteTable('collab_messages', {
  id: text('id').primaryKey(),
  queryId: text('query_id')
    .notNull()
    .references(() => savedQueries.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  content: text('content').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})
```

- [ ] **Step 4: Commit**

```bash
git add src/api/migrations/0009_collab_messages.sql src/api/migrations/meta/_journal.json src/api/src/db/schema.ts
git commit -m "feat: add collab_messages table and migration"
```

---

### Task 2: i18n keys

**Files:**
- Modify: `src/web/src/i18n/en.ts`
- Modify: `src/web/src/i18n/fr.ts`

- [ ] **Step 1: Add English keys**

Add after the `'collab.participants'` line:

```typescript
  'chat.title': 'Chat',
  'chat.placeholder': 'Type a message...',
  'chat.send': 'Send',
  'chat.noMessages': 'No messages yet',
  'chat.scrollToUser': 'Go to cursor',
```

- [ ] **Step 2: Add French keys**

Add after the `'collab.participants'` line:

```typescript
  'chat.title': 'Chat',
  'chat.placeholder': 'Écrire un message...',
  'chat.send': 'Envoyer',
  'chat.noMessages': 'Aucun message',
  'chat.scrollToUser': 'Aller au curseur',
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/i18n/en.ts src/web/src/i18n/fr.ts
git commit -m "feat: add chat i18n keys (en + fr)"
```

---

### Task 3: Message service (backend)

**Files:**
- Create: `src/api/src/services/collab-message.service.ts`

- [ ] **Step 1: Create the service**

Create `src/api/src/services/collab-message.service.ts`:

```typescript
import { eq, and, desc, lt, gt } from 'drizzle-orm'
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

  // Fetch user info for the response
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

  // Reverse to get chronological order (oldest first)
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
```

- [ ] **Step 2: Commit**

```bash
git add src/api/src/services/collab-message.service.ts
git commit -m "feat: collab message service (persist + list)"
```

---

### Task 4: Messages API route

**Files:**
- Modify: `src/api/src/routes/saved-queries.ts`

- [ ] **Step 1: Add messages route**

Add import at top:

```typescript
import { listMessages } from '../services/collab-message.service.js'
```

Add route before the `export { savedQueriesRouter }` line:

```typescript
savedQueriesRouter.get('/:id/messages', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  try {
    await getSavedQuery(id, userId)
  } catch (e) {
    if (e instanceof SavedQueryError) return c.json(problem(404, e.message), 404)
    throw e
  }
  const before = c.req.query('before')
  const limit = Number(c.req.query('limit') ?? '50')
  const result = await listMessages(id, before || undefined, Math.min(limit, 100))
  return c.json(result)
})
```

- [ ] **Step 2: Commit**

```bash
git add src/api/src/routes/saved-queries.ts
git commit -m "feat: add GET messages route for collab chat"
```

---

### Task 5: Collab server — handle MSG_CHAT

**Files:**
- Modify: `src/api/src/collab/collab-server.ts`

- [ ] **Step 1: Add MSG_CHAT handling**

Add import at top:

```typescript
import { persistMessage } from '../services/collab-message.service.js'
import { users } from '../db/schema.js'
```

Add constant after existing ones:

```typescript
const MSG_CHAT = 2
```

Change the `connections` map type in `CollabDoc` to store user info:

```typescript
type CollabConnection = {
  clientId: number
  userId: string
  userName: string
  avatarUrl: string | null
}

type CollabDoc = {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  connections: Map<WebSocket, CollabConnection>
}
```

Update `handleCollabConnection` signature to accept user info:

```typescript
export async function handleCollabConnection(
  ws: WebSocket,
  queryId: string,
  clientId: number,
  userInfo: { userId: string; userName: string; avatarUrl: string | null },
) {
```

Update the connection registration:

```typescript
  collabDoc.connections.set(ws, { clientId, ...userInfo })
```

Add MSG_CHAT handler in the `ws.on('message')` callback, after the MSG_AWARENESS block:

```typescript
    } else if (msgType === MSG_CHAT) {
      const content = decoding.readVarString(decoder)
      const connInfo = collabDoc.connections.get(ws)
      if (!connInfo || !content.trim()) return

      // Persist and broadcast
      const msg = await persistMessage(queryId, connInfo.userId, content.trim())
      const chatEncoder = encoding.createEncoder()
      encoding.writeVarUint(chatEncoder, MSG_CHAT)
      encoding.writeVarString(chatEncoder, JSON.stringify(msg))
      const chatMsg = encoding.toUint8Array(chatEncoder)
      // Broadcast to ALL including sender
      for (const [client] of collabDoc.connections) {
        if (client.readyState === 1) {
          client.send(chatMsg)
        }
      }
    }
```

Update the `ws.on('close')` handler to use the new connection type:

```typescript
  ws.on('close', () => {
    const connInfo = collabDoc.connections.get(ws)
    collabDoc.connections.delete(ws)
    if (connInfo) {
      awarenessProtocol.removeAwarenessStates(collabDoc.awareness, [connInfo.clientId], null)
    }
    destroyDocIfEmpty(queryId)
  })
```

- [ ] **Step 2: Update index.ts to pass user info**

In `src/api/src/index.ts`, update the `handleCollabConnection` call to pass user info. The `authenticateCollabUser` returns `{ userId, name, email }`. We also need the user's `avatarUrl` — fetch it from the database.

Add import:
```typescript
import { db } from './db/index.js'
import { users } from './db/schema.js'
import { eq } from 'drizzle-orm'
```

In the `wss.handleUpgrade` callback, before `handleCollabConnection`:

```typescript
    wss.handleUpgrade(request, socket, head, async (ws) => {
      const clientId = Math.floor(Math.random() * 2147483647)
      // Fetch avatar URL
      const userRows = await db
        .select({ avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, user.userId))
        .limit(1)
      const avatarUrl = userRows[0]?.avatarUrl ?? null
      logger.info({ queryId, userId: user.userId }, 'Collab WebSocket connected')
      handleCollabConnection(ws, queryId, clientId, {
        userId: user.userId,
        userName: user.name,
        avatarUrl,
      })
    })
```

- [ ] **Step 3: Commit**

```bash
git add src/api/src/collab/collab-server.ts src/api/src/index.ts
git commit -m "feat: handle MSG_CHAT in collab server with persist + broadcast"
```

---

### Task 6: Frontend API client for messages

**Files:**
- Create: `src/web/src/api/collab-messages.ts`

- [ ] **Step 1: Create the client**

Create `src/web/src/api/collab-messages.ts`:

```typescript
import { api } from './client'

export type ChatMessage = {
  id: string
  userId: string
  userName: string
  avatarUrl: string | null
  content: string
  createdAt: string
}

export const collabMessagesApi = {
  list: (queryId: string, before?: string, limit = 50) =>
    api.get<{ messages: ChatMessage[]; hasMore: boolean }>(
      `/saved-queries/${queryId}/messages?limit=${limit}${before ? `&before=${before}` : ''}`,
    ),
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/api/collab-messages.ts
git commit -m "feat: collab messages API client"
```

---

### Task 7: Collab provider — chat message support

**Files:**
- Modify: `src/web/src/collab/collab-provider.ts`

- [ ] **Step 1: Add chat message methods**

Add imports at top:

```typescript
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
```

Add constant:

```typescript
const MSG_CHAT = 2
```

Update `CollabInstance` type to include chat methods:

```typescript
export type CollabInstance = {
  doc: Y.Doc
  provider: WebsocketProvider
  ytext: Y.Text
  sendChatMessage: (content: string) => void
  onChatMessage: (handler: (msg: any) => void) => () => void
  destroy: () => void
}
```

Inside `createCollabInstance`, before the return statement, add:

```typescript
  // Chat message handling
  const chatHandlers = new Set<(msg: any) => void>()

  // Listen to raw WebSocket messages for MSG_CHAT
  const originalOnMessage = provider.ws?.onmessage
  const setupWsListener = () => {
    const ws = (provider as any).ws as WebSocket | null
    if (!ws) return
    const prevOnMessage = ws.onmessage
    ws.onmessage = (event: MessageEvent) => {
      // Let y-websocket handle its messages first
      if (prevOnMessage) prevOnMessage.call(ws, event)
      // Then check for chat messages
      try {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const decoder = decoding.createDecoder(data)
        const msgType = decoding.readVarUint(decoder)
        if (msgType === MSG_CHAT) {
          const jsonStr = decoding.readVarString(decoder)
          const msg = JSON.parse(jsonStr)
          chatHandlers.forEach((h) => h(msg))
        }
      } catch {
        // Not a chat message or decode error — ignore
      }
    }
  }

  // y-websocket may reconnect, so listen for status changes
  provider.on('status', ({ status }: { status: string }) => {
    if (status === 'connected') {
      setTimeout(setupWsListener, 50) // slight delay for ws to be ready
    }
  })
  if (provider.wsconnected) {
    setTimeout(setupWsListener, 50)
  }

  const sendChatMessage = (content: string) => {
    const ws = (provider as any).ws as WebSocket | null
    if (!ws || ws.readyState !== 1) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_CHAT)
    encoding.writeVarString(encoder, content)
    ws.send(encoding.toUint8Array(encoder))
  }

  const onChatMessage = (handler: (msg: any) => void) => {
    chatHandlers.add(handler)
    return () => { chatHandlers.delete(handler) }
  }
```

Update the return to include the new methods:

```typescript
  return {
    doc,
    provider,
    ytext,
    sendChatMessage,
    onChatMessage,
    destroy: () => {
      chatHandlers.clear()
      provider.disconnect()
      provider.destroy()
      doc.destroy()
    },
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/collab/collab-provider.ts
git commit -m "feat: add chat message send/receive to collab provider"
```

---

### Task 8: Editor store — unread count + chat state

**Files:**
- Modify: `src/web/src/stores/editor.store.ts`

- [ ] **Step 1: Add chat-related state**

Add to `QueryTab` type:

```typescript
  unreadChat: number
```

Add to `EditorState` type:

```typescript
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  incrementUnread: (tabId: string) => void
  resetUnread: (tabId: string) => void
```

Add `unreadChat: 0` to `makeQueryTab` and `makeTableTab`.

Add implementations in the Zustand `create` callback:

```typescript
  chatOpen: false,
  setChatOpen: (open) => set({ chatOpen: open }),
  incrementUnread: (tabId) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === tabId ? { ...t, unreadChat: t.unreadChat + 1 } : t),
  })),
  resetUnread: (tabId) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === tabId ? { ...t, unreadChat: 0 } : t),
  })),
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/stores/editor.store.ts
git commit -m "feat: add chat state to editor store (unread count, chatOpen)"
```

---

### Task 9: CollabAvatars — chat button + click-to-cursor

**Files:**
- Modify: `src/web/src/components/editor/CollabAvatars.tsx`

- [ ] **Step 1: Add chat button and click-to-cursor**

Add imports:

```typescript
import { MessageSquare } from 'lucide-react'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
```

Update the component props to accept `editorView` and `unreadCount`:

```typescript
export function CollabAvatars({
  awareness,
  currentUserId,
  editorView,
  unreadCount,
  onToggleChat,
}: {
  awareness: Awareness | null
  currentUserId: string
  editorView: any | null
  unreadCount: number
  onToggleChat: () => void
}) {
```

Change the avatar `onClick` to scroll to the user's cursor. Replace `cursor-default` with `cursor-pointer` on the avatar div and add an onClick:

```tsx
              <div
                className="relative flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold cursor-pointer"
                onClick={() => scrollToCursor(p.clientId)}
                style={{
```

Add the `scrollToCursor` function inside the component:

```typescript
  const scrollToCursor = (clientId: number) => {
    if (!awareness || !editorView) return
    const state = awareness.getStates().get(clientId)
    const cursor = state?.cursor
    if (cursor?.anchor != null) {
      editorView.dispatch({
        selection: { anchor: cursor.anchor, head: cursor.head ?? cursor.anchor },
        scrollIntoView: true,
      })
      editorView.focus()
    }
  }
```

Update the tooltip for avatars:

```tsx
            <TooltipContent side="bottom">
              <p className="text-xs">{p.name}</p>
              <p className="text-[10px] text-muted-foreground">{t('chat.scrollToUser')}</p>
            </TooltipContent>
```

Change the condition — render even if no participants (for the chat button). Replace `if (participants.length === 0) return null` with removing that early return entirely, and wrap the avatars in a conditional:

After the overflow badge, add the chat button:

```tsx
        {/* Chat button */}
        <div className="ml-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleChat}
                className="relative flex items-center justify-center w-6 h-6 rounded-full bg-muted hover:bg-accent transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center px-0.5">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('chat.title')}</TooltipContent>
          </Tooltip>
        </div>
```

Return `null` only when not collaborative (the parent already conditionally renders this component).

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/editor/CollabAvatars.tsx
git commit -m "feat: add chat button with badge + click avatar to scroll cursor"
```

---

### Task 10: CollabChat panel component

**Files:**
- Create: `src/web/src/components/editor/CollabChat.tsx`

- [ ] **Step 1: Create the chat panel**

Create `src/web/src/components/editor/CollabChat.tsx`:

```tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { X, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { useEditorStore } from '@/stores/editor.store'
import { useAuthStore } from '@/stores/auth.store'
import { collabMessagesApi, type ChatMessage } from '@/api/collab-messages'
import { cn } from '@/lib/utils'
import type { CollabInstance } from '@/collab/collab-provider'

type Props = {
  queryId: string
  queryName: string
  collabInstance: CollabInstance | null
  onClose: () => void
}

export function CollabChat({ queryId, queryName, collabInstance, onClose }: Props) {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const [input, setInput] = useState('')
  const [realtimeMessages, setRealtimeMessages] = useState<ChatMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Load history
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['collab-messages', queryId],
    queryFn: ({ pageParam }) => collabMessagesApi.list(queryId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.messages.length === 0) return undefined
      return lastPage.messages[0]!.createdAt
    },
    enabled: true,
  })

  const historyMessages = data?.pages.flatMap((p) => p.messages) ?? []
  const allMessages = [...historyMessages, ...realtimeMessages]

  // Deduplicate (history may contain messages also received via WS)
  const seen = new Set<string>()
  const messages = allMessages.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  // Listen for real-time messages
  useEffect(() => {
    if (!collabInstance) return
    const unsub = collabInstance.onChatMessage((msg: ChatMessage) => {
      setRealtimeMessages((prev) => [...prev, msg])
    })
    return unsub
  }, [collabInstance])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, autoScroll])

  // Track scroll position for auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setAutoScroll(atBottom)

    // Load older messages at top
    if (el.scrollTop < 100 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const sendMessage = () => {
    const content = input.trim()
    if (!content || !collabInstance) return
    collabInstance.sendChatMessage(content)
    setInput('')
    setAutoScroll(true)
  }

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  const getInitials = (name: string) => {
    const parts = name.split(/[\s@]+/)
    if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div>
          <h3 className="text-sm font-semibold">{t('chat.title')}</h3>
          <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{queryName}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3"
      >
        {isFetchingNextPage && (
          <p className="text-xs text-muted-foreground text-center py-2">...</p>
        )}

        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">{t('chat.noMessages')}</p>
        )}

        {messages.map((msg) => {
          const isOwn = msg.userId === user?.id
          return (
            <div key={msg.id} className={cn('flex gap-2', isOwn && 'flex-row-reverse')}>
              {!isOwn && (
                <div
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
                  style={{ backgroundColor: '#52525B25', color: '#A1A1AA' }}
                >
                  {msg.avatarUrl ? (
                    <img src={msg.avatarUrl} alt={msg.userName} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    getInitials(msg.userName)
                  )}
                </div>
              )}
              <div className={cn('max-w-[75%]', isOwn && 'text-right')}>
                {!isOwn && (
                  <p className="text-[10px] text-muted-foreground mb-0.5">{msg.userName}</p>
                )}
                <div className={cn(
                  'inline-block px-2.5 py-1.5 rounded-lg text-xs',
                  isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                )}>
                  {msg.content}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{formatTime(msg.createdAt)}</p>
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-border-subtle">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={t('chat.placeholder')}
            className="flex-1 min-h-[32px] max-h-[80px] px-2 py-1.5 text-xs bg-background border border-border-subtle rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            rows={1}
          />
          <Button
            size="sm"
            className="h-8 w-8 p-0 flex-shrink-0"
            onClick={sendMessage}
            disabled={!input.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/editor/CollabChat.tsx
git commit -m "feat: CollabChat panel component"
```

---

### Task 11: Wire chat into AppShell + SqlEditor

**Files:**
- Modify: `src/web/src/components/layout/AppShell.tsx`
- Modify: `src/web/src/components/editor/SqlEditor.tsx`

- [ ] **Step 1: Update AppShell to render CollabChat**

In `AppShell.tsx`, add import:

```typescript
import { CollabChat } from '@/components/editor/CollabChat'
```

Find the right sidebar area where the CopilotPanel is rendered (inside the `{copilotOpen && ( ... )}` block). The chat needs to be mutually exclusive with the Copilot.

Add `chatOpen` state from editor store. In the component where `copilotOpen` is managed, add:

```typescript
const { chatOpen, setChatOpen } = useEditorStore()
```

Update the Copilot toggle to close chat:

```typescript
onToggleCopilot={() => { setCopilotOpen((o) => !o); if (!copilotOpen) setChatOpen(false) }}
```

In the right sidebar ResizablePanel area, update to show either Copilot or Chat:

```tsx
{(copilotOpen || chatOpen) && (
  <>
    <ResizableHandle withHandle />
    <ResizablePanel defaultSize={30} minSize={20} maxSize={50} id="right-panel">
      {copilotOpen && <CopilotPanel onClose={() => setCopilotOpen(false)} />}
      {chatOpen && !copilotOpen && (
        <CollabChat
          queryId={activeTab?.savedQueryId ?? ''}
          queryName={activeTab?.name ?? ''}
          collabInstance={null}
          onClose={() => setChatOpen(false)}
        />
      )}
    </ResizablePanel>
  </>
)}
```

Note: The `collabInstance` needs to be passed from SqlEditor. For now pass `null` — Task 12 will wire it via a ref or context. Actually, we should store the collabInstance ref on the editor store or pass it differently.

A simpler approach: store the collab instance in a module-level variable accessible from both SqlEditor and CollabChat. Add to `collab-provider.ts`:

```typescript
let activeCollabInstance: CollabInstance | null = null
export function getActiveCollabInstance() { return activeCollabInstance }
export function setActiveCollabInstance(instance: CollabInstance | null) { activeCollabInstance = instance }
```

Then in SqlEditor, call `setActiveCollabInstance(instance)` when connecting and `setActiveCollabInstance(null)` on cleanup.

In CollabChat, import and use `getActiveCollabInstance()`.

- [ ] **Step 2: Update SqlEditor to expose collab instance and wire chat button**

In `SqlEditor.tsx`, import:

```typescript
import { setActiveCollabInstance } from '@/collab/collab-provider'
```

In the collab lifecycle useEffect, after `collabRef.current = instance`:

```typescript
      setActiveCollabInstance(instance)
```

In the cleanup:

```typescript
      setActiveCollabInstance(null)
```

Update `CollabAvatars` props to pass the editor view ref and unread count:

```tsx
          <CollabAvatars
            awareness={collabRef.current?.provider.awareness ?? null}
            currentUserId={user?.id ?? ''}
            editorView={viewRef.current}
            unreadCount={activeTab?.unreadChat ?? 0}
            onToggleChat={() => {
              const store = useEditorStore.getState()
              store.setChatOpen(!store.chatOpen)
              if (!store.chatOpen) {
                setCopilotOpen?.(false) // close copilot when opening chat
              }
              store.resetUnread(activeTabId)
            }}
          />
```

Note: The `setCopilotOpen` is not directly available in SqlEditor. The simpler approach is to just toggle `chatOpen` in the store and let AppShell handle mutual exclusivity.

Simplify the onToggleChat:

```tsx
            onToggleChat={() => {
              const store = useEditorStore.getState()
              const opening = !store.chatOpen
              store.setChatOpen(opening)
              if (opening) store.resetUnread(activeTabId)
            }}
```

- [ ] **Step 3: Update AppShell to handle mutual exclusivity**

When `chatOpen` becomes true, close copilot. Use an effect or handle in the toggle:

In the EditorArea component of AppShell, add:

```typescript
const chatOpen = useEditorStore((s) => s.chatOpen)
```

Update the right panel condition:

```tsx
{(copilotOpen || chatOpen) && (
```

When opening copilot, close chat:

```typescript
onToggleCopilot={() => {
  setCopilotOpen((o) => {
    if (!o) useEditorStore.getState().setChatOpen(false)
    return !o
  })
}}
```

When chat opens, close copilot:

```typescript
useEffect(() => {
  if (chatOpen) setCopilotOpen(false)
}, [chatOpen])
```

- [ ] **Step 4: Update CollabChat to use getActiveCollabInstance**

In `CollabChat.tsx`, replace the `collabInstance` prop approach. Import and use:

```typescript
import { getActiveCollabInstance } from '@/collab/collab-provider'
```

Change props to not require `collabInstance`:

```typescript
type Props = {
  queryId: string
  queryName: string
  onClose: () => void
}
```

Inside the component, get the instance:

```typescript
const collabInstance = getActiveCollabInstance()
```

- [ ] **Step 5: Wire unread incrementing**

In `SqlEditor.tsx`, in the collab lifecycle useEffect, after setting up the Yjs observer, add a chat message listener that increments unread when the chat panel is not open:

```typescript
      const unsubChat = instance.onChatMessage(() => {
        const store = useEditorStore.getState()
        if (!store.chatOpen) {
          store.incrementUnread(activeTabId)
        }
      })
```

In the cleanup:

```typescript
      unsubChat()
```

- [ ] **Step 6: Commit**

```bash
git add src/web/src/collab/collab-provider.ts src/web/src/components/editor/SqlEditor.tsx src/web/src/components/editor/CollabChat.tsx src/web/src/components/layout/AppShell.tsx
git commit -m "feat: wire collab chat into AppShell and SqlEditor"
```

---

### Task 12: Unread badge on tabs

**Files:**
- Modify: `src/web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add unread dot to tab**

In the `UnifiedTabBar` component, find where tab names are rendered. For each tab, if `tab.unreadChat > 0` and the chat panel is not open (or the tab is not the active one), show a red dot:

After the tab name span, add:

```tsx
{tab.unreadChat > 0 && (
  <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/layout/AppShell.tsx
git commit -m "feat: show unread chat dot on tabs"
```

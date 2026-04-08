# Explain Error with Copilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Explain with Copilot" button on query errors that opens the copilot panel and auto-streams an AI explanation.

**Architecture:** Store-driven approach using Zustand. A new `pendingExplain` transient field in the copilot store triggers auto-streaming in `CopilotPanel`. The `ResultsTable` calls the store directly (it already has `activeConnectionId`), then opens the copilot via a new callback prop.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS v4, lucide-react

---

### Task 1: Add i18n keys

**Files:**
- Modify: `src/web/src/i18n/fr.ts`
- Modify: `src/web/src/i18n/en.ts`

- [ ] **Step 1: Add French keys**

In `src/web/src/i18n/fr.ts`, after the `'copilot.clear'` key (line 300), add:

```typescript
  'copilot.explainError.button': 'Expliquer avec Copilot',
  'copilot.explainError.prompt': 'J\'ai exécuté cette requête SQL et j\'obtiens une erreur. Aide-moi à comprendre et corriger.\n\n**Requête :**\n```sql\n{sql}\n```\n\n**Erreur :**\n{error}',
```

- [ ] **Step 2: Add English keys**

In `src/web/src/i18n/en.ts`, after the `'copilot.clear'` key (line 300), add:

```typescript
  'copilot.explainError.button': 'Explain with Copilot',
  'copilot.explainError.prompt': 'I ran this SQL query and got an error. Help me understand and fix it.\n\n**Query:**\n```sql\n{sql}\n```\n\n**Error:**\n{error}',
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: No new errors (both files must have matching keys).

- [ ] **Step 4: Commit**

```bash
git add src/web/src/i18n/fr.ts src/web/src/i18n/en.ts
git commit -m "feat: add i18n keys for explain error with copilot"
```

---

### Task 2: Extend copilot store with `pendingExplain`

**Files:**
- Modify: `src/web/src/stores/copilot.store.ts`

- [ ] **Step 1: Add `pendingExplain` state and actions**

Replace the full content of `src/web/src/stores/copilot.store.ts` with:

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CopilotMessage = { role: 'user' | 'assistant'; content: string }

type CopilotState = {
  conversations: Record<string, CopilotMessage[]>
  pendingExplain: string | null
}

export const useCopilotStore = create<CopilotState>()(
  persist(
    () => ({
      conversations: {} as Record<string, CopilotMessage[]>,
      pendingExplain: null as string | null,
    }),
    {
      name: 'dblumi-copilot',
      version: 1,
      partialize: (state) => ({ conversations: state.conversations }),
    },
  ),
)

export function setCopilotMessages(connectionId: string, messages: CopilotMessage[]) {
  useCopilotStore.setState((s) => ({
    conversations: { ...s.conversations, [connectionId]: messages },
  }))
}

export function clearCopilotConversation(connectionId: string) {
  useCopilotStore.setState((s) => {
    const { [connectionId]: _, ...rest } = s.conversations
    return { conversations: rest }
  })
}

export function explainError(connectionId: string, message: string) {
  useCopilotStore.setState((s) => {
    const prev = s.conversations[connectionId] ?? []
    return {
      conversations: { ...s.conversations, [connectionId]: [...prev, { role: 'user' as const, content: message }] },
      pendingExplain: message,
    }
  })
}

export function clearPendingExplain() {
  useCopilotStore.setState({ pendingExplain: null })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/stores/copilot.store.ts
git commit -m "feat: add pendingExplain state and explainError action to copilot store"
```

---

### Task 3: Add "Explain with Copilot" button in ResultsTable

**Files:**
- Modify: `src/web/src/components/results/ResultsTable.tsx`

- [ ] **Step 1: Add Sparkles import**

In the lucide-react import at the top of `ResultsTable.tsx` (line 22), add `Sparkles` to the import list:

```typescript
import {
  Loader2, AlertCircle, CheckCircle2, TableIcon,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, GripVertical,
  Filter, ArrowDownUp, Plus, Trash2, Copy, Download, X,
  ChevronDown, Pencil, ClipboardCopy, CalendarIcon, ListPlus,
  Upload, ScanSearch, Pin, PinOff, EyeOff, Eye, ArrowLeftRight, RefreshCcw,
  Sparkles,
} from 'lucide-react'
```

- [ ] **Step 2: Add import for copilot store actions**

Add this import near the top of the file (after other store imports):

```typescript
import { explainError } from '@/stores/copilot.store'
```

- [ ] **Step 3: Add `onOpenCopilot` prop**

Change the component signature from:

```typescript
export function ResultsTable() {
```

to:

```typescript
export function ResultsTable({ onOpenCopilot }: { onOpenCopilot?: () => void }) {
```

- [ ] **Step 4: Replace the error display block**

Replace the error block (lines 1225-1227):

```typescript
  if (status === 'error') {
    return (<div className="flex items-center justify-center h-full gap-2 px-6 bg-background"><AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" /><span className="text-xs text-destructive">{error ?? t('results.error')}</span></div>)
  }
```

with:

```typescript
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 bg-background">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
          <span className="text-xs text-destructive">{error ?? t('results.error')}</span>
        </div>
        {activeConnectionId && error && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-primary hover:bg-primary/10 transition-colors border border-primary/20"
            onClick={() => {
              const sql = result?.executedSql ?? tab?.sql ?? ''
              const message = t('copilot.explainError.prompt', { sql, error })
              explainError(activeConnectionId, message)
              onOpenCopilot?.()
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('copilot.explainError.button')}
          </button>
        )}
      </div>
    )
  }
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (may warn about unused prop in AppShell — that's expected, we wire it next task).

- [ ] **Step 6: Commit**

```bash
git add src/web/src/components/results/ResultsTable.tsx
git commit -m "feat: add explain with copilot button on query errors"
```

---

### Task 4: Wire `onOpenCopilot` in AppShell

**Files:**
- Modify: `src/web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Pass `onOpenCopilot` to all ResultsTable instances**

In `AppShell.tsx`, find every `<ResultsTable />` occurrence (lines 947, 953, 963) and replace each with:

```tsx
<ResultsTable onOpenCopilot={() => { setCopilotOpen(true); setChatOpen(false) }} />
```

There are 3 instances:
1. Line 947 — inside the query tab layout
2. Line 953 — inside the table tab layout
3. Line 963 — inside the function tab layout

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/components/layout/AppShell.tsx
git commit -m "feat: wire onOpenCopilot callback from AppShell to ResultsTable"
```

---

### Task 5: Auto-stream on `pendingExplain` in CopilotPanel

**Files:**
- Modify: `src/web/src/components/copilot/CopilotPanel.tsx`

- [ ] **Step 1: Add import for `clearPendingExplain`**

Update the copilot store import (line 8) from:

```typescript
import { useCopilotStore, setCopilotMessages, clearCopilotConversation } from '@/stores/copilot.store'
```

to:

```typescript
import { useCopilotStore, setCopilotMessages, clearCopilotConversation, clearPendingExplain } from '@/stores/copilot.store'
```

- [ ] **Step 2: Subscribe to `pendingExplain`**

After the `connId` / `messages` declarations (around line 134), add:

```typescript
  const pendingExplain = useCopilotStore((s) => s.pendingExplain)
```

- [ ] **Step 3: Add the auto-stream useEffect**

After the existing `useEffect` that focuses the input (line 155), add:

```typescript
  useEffect(() => {
    if (!pendingExplain || isStreaming || !activeConnectionId) return
    clearPendingExplain()
    const msgs = useCopilotStore.getState().conversations[activeConnectionId] ?? []
    streamResponse(msgs)
  }, [pendingExplain, isStreaming, activeConnectionId, streamResponse])
```

This effect:
- Fires when `pendingExplain` changes to non-null
- Guards against streaming if already in progress
- Reads the latest messages from the store (which already includes the user message added by `explainError`)
- Clears the flag immediately to prevent re-triggers
- Calls `streamResponse` to start the AI response

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 5: Commit**

```bash
git add src/web/src/components/copilot/CopilotPanel.tsx
git commit -m "feat: auto-stream copilot response on pendingExplain"
```

---

### Task 6: Manual testing

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: Test the happy path**

1. Open the app, connect to a database
2. Write an invalid SQL query (e.g., `SELECT * FORM users` — typo on FROM)
3. Execute with Ctrl+Enter
4. Verify the error appears with the "Explain with Copilot" button (Sparkles icon)
5. Click the button
6. Verify the copilot panel opens
7. Verify a user message appears in the chat with the SQL and error
8. Verify the AI starts streaming a response

- [ ] **Step 3: Test edge cases**

1. **Copilot already open:** Execute a bad query while copilot is open — button should still work, message appended
2. **No connection selected:** Verify the button does not appear
3. **Streaming in progress:** Click the button while copilot is already answering — should not crash (the `isStreaming` guard skips the effect)
4. **Table tab error:** Switch to a table tab that errors — verify the button works there too

- [ ] **Step 4: Test i18n**

1. Switch the app language to English
2. Verify the button label and the prompt message are in English
3. Switch back to French, verify French text

- [ ] **Step 5: Final commit (if any fix needed)**

If fixes were needed during testing, commit them:

```bash
git add -u
git commit -m "fix: address issues found during manual testing of explain error feature"
```

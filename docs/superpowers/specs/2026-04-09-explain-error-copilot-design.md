# Explain Error with Copilot

**Date:** 2026-04-09
**Status:** Approved

## Summary

Add an "Explain with Copilot" button to query error displays. Clicking it opens the copilot panel and automatically sends a pre-formatted message containing the executed SQL and the full error message, triggering an immediate streaming response from the AI assistant.

## Approach

Store-driven (Zustand) with a `pendingExplain` flag in the copilot store. The `CopilotPanel` reacts to this flag to auto-trigger streaming.

## Components Modified

### 1. ResultsTable — Error UI Button

**File:** `src/web/src/components/results/ResultsTable.tsx`

When `status === 'error'`, add a button "Explain with Copilot" (Sparkles icon) next to the existing error message. The button calls an `onExplainWithCopilot()` callback prop.

Layout: existing error icon + message + new button on the right. Button style: ghost, small size, consistent with existing action buttons.

### 2. Copilot Store — `explainError` action

**File:** `src/web/src/stores/copilot.store.ts`

Add:
- `pendingExplain: string | null` — the pre-formatted message to stream. **Not persisted** (excluded from persist middleware).
- `explainError(connectionId: string, message: string)` — sets `pendingExplain` and appends a `{ role: 'user', content: message }` to the conversation for that `connectionId`.
- `clearPendingExplain()` — resets `pendingExplain` to `null`.

The store stays i18n-agnostic — it receives the already-formatted message string.

### 3. AppShell — Wiring

**File:** `src/web/src/components/layout/AppShell.tsx`

Pass `onExplainWithCopilot(sql: string, error: string)` callback to `ResultsTable`. The callback:
1. Builds the user message via `t('copilot.explainError.prompt', { sql, error })`
2. Calls `useCopilotStore.getState().explainError(connectionId, formattedMessage)`
3. Calls `setCopilotOpen(true)` to open the panel

### 4. CopilotPanel — Auto-stream on pendingExplain

**File:** `src/web/src/components/copilot/CopilotPanel.tsx`

Add a `useEffect` watching `pendingExplain` from the store:
- When non-null: call `streamResponse()` with the current messages, then call `clearPendingExplain()`.
- The user message is already in the conversation (added by the store action), so it appears naturally in the chat history.

### 5. i18n — New translation keys

**Files:** `src/web/src/i18n/fr.ts`, `src/web/src/i18n/en.ts`

New keys:
- `copilot.explainError.button` — Button label ("Expliquer avec Copilot" / "Explain with Copilot")
- `copilot.explainError.prompt` — Message template with `{sql}` and `{error}` placeholders

**French:**
```
"copilot.explainError.button": "Expliquer avec Copilot"
"copilot.explainError.prompt": "J'ai exécuté cette requête SQL et j'obtiens une erreur. Aide-moi à comprendre et corriger.\n\n**Requête :**\n```sql\n{sql}\n```\n\n**Erreur :**\n{error}"
```

**English:**
```
"copilot.explainError.button": "Explain with Copilot"
"copilot.explainError.prompt": "I ran this SQL query and got an error. Help me understand and fix it.\n\n**Query:**\n```sql\n{sql}\n```\n\n**Error:**\n{error}"
```

## Data Flow

```
User executes query → error occurs
  ↓
ResultsTable renders error + "Explain with Copilot" button
  ↓
User clicks button → onExplainWithCopilot(sql, error)
  ↓
AppShell callback:
  1. t('copilot.explainError.prompt', { sql, error }) → formatted message
  2. copilotStore.explainError(connectionId, message)
  3. setCopilotOpen(true)
  ↓
Copilot store:
  1. Appends user message to conversation
  2. Sets pendingExplain = message
  ↓
CopilotPanel useEffect detects pendingExplain:
  1. Calls streamResponse() → AI starts streaming
  2. Calls clearPendingExplain()
  ↓
User sees copilot panel with their question + streaming AI response
```

## Edge Cases

- **Copilot already open:** Still works — message is appended to existing conversation, streaming starts.
- **No active connection:** Button should not appear if there's no `connectionId` (required for copilot API).
- **Streaming already in progress:** If copilot is already streaming a response, the `pendingExplain` effect should wait or skip. Use the existing `isStreaming` state to guard.

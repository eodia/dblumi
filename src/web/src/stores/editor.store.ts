import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from 'sonner'
import { api, readSSE } from '@/api/client'
import type { DbDriver } from '@/api/connections'
import { splitStatementsFor, tableQuery } from '@/lib/query-dialect'

export type QueryStatus = 'idle' | 'running' | 'done' | 'error'

function showSqlErrorToast(message: string, detail?: string) {
  const full = detail ? `${message}\n${detail}` : message
  toast.error(message, {
    description: detail,
    duration: Infinity,
    action: {
      label: 'Copy',
      onClick: () => navigator.clipboard.writeText(full),
    },
  })
}

export type GuardrailInfo = {
  level: 1 | 2 | 3 | 4
  message: string
  details: string
}

export type QueryColumn = { name: string; dataType: string; nullable?: boolean }

export type SortEntry = { column: string; direction: 'asc' | 'desc' }
export type SortBy = SortEntry | null

export type TabResult = {
  status: QueryStatus
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  totalCount: number | null
  page: number
  pageSize: number
  durationMs: number
  error: string | null
  guardrail: GuardrailInfo | null
  sortBy: SortBy
  sortMulti: SortEntry[]
  /** The SQL that was actually executed (may differ from tab.sql when running a selection) */
  executedSql: string | null
}

export type TabKind = 'query' | 'table' | 'function'

export type FunctionParam = { name: string; type: string; value: string }

export type FilterRow = { column: string; operator: string; value: string }

export type PendingClose = { tabId: string; remainingIds?: string[] | undefined } | null

export type QueryTab = {
  id: string
  name: string
  kind: TabKind
  sql: string
  originalSql: string
  result: TabResult
  /**
   * Per-statement results when the executed SQL contains more than one
   * statement. Empty (`[]`) for single-statement runs — the regular
   * `result` field is then the only source of truth.
   * When non-empty, `result` mirrors `panels[activePanelIndex]`.
   */
  panels: TabResult[]
  activePanelIndex: number
  savedQueryId: string | null
  functionParams: FunctionParam[]
  connectionId: string | null
  collaborative: boolean
  unreadChat: number
  filters: FilterRow[]
}

const DEFAULT_PAGE_SIZE = 100

const emptyResult = (): TabResult => ({
  status: 'idle',
  columns: [],
  rows: [],
  rowCount: 0,
  totalCount: null,
  page: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  durationMs: 0,
  error: null,
  guardrail: null,
  sortBy: null,
  sortMulti: [],
  executedSql: null,
})

type ExecuteOptions = {
  /** Skip the guardrail (the user already confirmed). */
  force?: boolean
  /** Run the text as one statement — e.g. a function body full of `;`. */
  split?: boolean
}

type EditorState = {
  tabs: QueryTab[]
  activeTabId: string
  activeConnectionId: string | null
  selection: string
  /** Driver of every known connection, synced from the connection list. */
  connectionDrivers: Record<string, DbDriver>

  setActiveConnection: (id: string | null) => void
  setConnectionDrivers: (drivers: Record<string, DbDriver>) => void
  setActiveTab: (id: string) => void
  addTab: () => void
  closeTab: (id: string) => void
  setSql: (sql: string) => void
  setSelection: (text: string) => void
  setSavedQueryId: (id: string | null) => void
  loadQuery: (sql: string, name: string) => void
  openQuery: (sql: string, name: string, savedQueryId?: string, collaborative?: boolean) => void
  openTable: (tableName: string) => Promise<void>
  openFunction: (name: string, source: string, params: Array<{ name: string; type: string }>) => void
  setFunctionParams: (params: FunctionParam[]) => void
  reorderTabs: (fromId: string, toId: string) => void
  closeOthers: (id: string) => void
  closeToLeft: (id: string) => void
  closeToRight: (id: string) => void
  closeAll: () => void

  pendingCsvImport: string | null
  setPendingCsvImport: (table: string | null) => void

  executeQuery: (force?: boolean) => Promise<void>
  executeSelection: () => Promise<void>
  /** Runs `sql` in the active tab; resolves to true when it succeeded. */
  executeSql: (sql: string, options?: ExecuteOptions) => Promise<boolean>
  reloadTab: () => Promise<void>
  goToPage: (page: number) => Promise<void>
  setResultPageSize: (size: number) => Promise<void>
  sortByColumn: (column: string, additive?: boolean) => Promise<void>
  sortByMulti: (sorts: SortEntry[]) => Promise<void>
  clearGuardrail: () => void
  /** Runs, confirmed, exactly the statement the guardrail stopped. */
  confirmGuardrail: () => Promise<void>
  clearResults: () => void
  setTabFilters: (filters: FilterRow[]) => void
  markSaved: () => void

  pendingClose: PendingClose
  confirmClose: (action: 'save' | 'discard' | 'cancel') => void
  requestBulkClose: (tabIds: string[]) => void

  setActivePanel: (idx: number) => void

  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  incrementUnread: (tabId: string) => void
  resetUnread: (tabId: string) => void
}

function makeQueryTab(n: number, connectionId: string | null = null): QueryTab {
  return { id: crypto.randomUUID(), name: `Query ${n}`, kind: 'query', sql: '', originalSql: '', result: emptyResult(), panels: [], activePanelIndex: 0, savedQueryId: null, functionParams: [], connectionId, collaborative: false, unreadChat: 0, filters: [] }
}

function makeTableTab(tableName: string, connectionId: string | null, driver: DbDriver | undefined): QueryTab {
  const sql = tableQuery(driver, tableName)
  return {
    id: crypto.randomUUID(),
    name: tableName,
    kind: 'table',
    sql,
    originalSql: sql,
    savedQueryId: null,
    functionParams: [],
    connectionId,
    collaborative: false,
    unreadChat: 0,
    filters: [],
    result: emptyResult(),
    panels: [],
    activePanelIndex: 0,
  }
}

function patchResult(
  tabs: QueryTab[],
  id: string,
  patch: Partial<TabResult> | ((r: TabResult) => Partial<TabResult>),
): QueryTab[] {
  return tabs.map((t) => {
    if (t.id !== id) return t
    const p = typeof patch === 'function' ? patch(t.result) : patch
    return { ...t, result: { ...t.result, ...p } }
  })
}

// ── localStorage helpers ──────────────────────────────
export type QueryHistoryEntry = {
  sql: string
  connectionId: string
  executedAt: string
  durationMs: number
}

export type TableVisitEntry = {
  tableName: string
  connectionId: string
  visitCount: number
  lastVisited: string
}

export function saveQueryHistory(sql: string, connectionId: string, durationMs: number) {
  try {
    const key = 'dblumi:qhistory'
    const existing: QueryHistoryEntry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const entry: QueryHistoryEntry = { sql: sql.trim(), connectionId, executedAt: new Date().toISOString(), durationMs }
    localStorage.setItem(key, JSON.stringify([entry, ...existing].slice(0, 50)))
  } catch { /* localStorage may be unavailable */ }
}

export function recordTableVisit(tableName: string, connectionId: string) {
  try {
    const key = 'dblumi:tvisits'
    const existing: TableVisitEntry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const idx = existing.findIndex((e) => e.tableName === tableName && e.connectionId === connectionId)
    if (idx >= 0) {
      existing[idx]!.visitCount += 1
      existing[idx]!.lastVisited = new Date().toISOString()
    } else {
      existing.push({ tableName, connectionId, visitCount: 1, lastVisited: new Date().toISOString() })
    }
    localStorage.setItem(key, JSON.stringify(existing))
  } catch { /* localStorage may be unavailable */ }
}

// ── Run control ─────────────────────────────────

/**
 * One live run per key (a tab, or a tab's row count). Starting a new run aborts
 * the previous one and silences its late events: two streams writing into the
 * same tab used to interleave their rows (page size change, double Ctrl+Enter…).
 */
type Run = { signal: AbortSignal; isCurrent: () => boolean }
const runTokens = new Map<string, number>()
const runControllers = new Map<string, AbortController>()

function beginRun(key: string): Run {
  runControllers.get(key)?.abort()
  const controller = new AbortController()
  runControllers.set(key, controller)
  const token = (runTokens.get(key) ?? 0) + 1
  runTokens.set(key, token)
  return { signal: controller.signal, isCurrent: () => runTokens.get(key) === token }
}

const countKey = (tabId: string) => `${tabId}:count`

/** Batches stopped by the guardrail (nothing ran yet), replayed as a whole on confirmation. */
const blockedRuns = new Map<string, { connectionId: string; statements: string[]; pageSize: number }>()

type HttpError = { status: number; body: Record<string, unknown> }

function guardrailOf(resp: HttpError): GuardrailInfo | null {
  const b = resp.body
  if (resp.status !== 422 || b['type'] !== 'guardrail') return null
  return { level: b['level'] as 1 | 2 | 3 | 4, message: b['message'] as string, details: b['details'] as string }
}

/**
 * Streams one statement into `patch` (the tab result, or a panel). Never leaves
 * the target in `running`: a stream cut without `done`/`error` becomes an error.
 * Returns what ended the run.
 */
async function streamQuery(
  body: { connectionId: string; sql: string; limit: number; offset: number; force: boolean; sort?: SortEntry[] },
  run: Run,
  patch: (p: Partial<TabResult> | ((r: TabResult) => Partial<TabResult>)) => void,
  options: { keepColumns?: boolean } = {},
): Promise<'done' | 'error' | 'guardrail' | 'aborted'> {
  const apply: typeof patch = (p) => { if (run.isCurrent()) patch(p) }
  apply(options.keepColumns
    ? { status: 'running', rows: [] }
    : { status: 'running', error: null, guardrail: null, columns: [], rows: [] })
  let outcome: 'done' | 'error' | 'guardrail' | null = null
  try {
    const payload = body.sort && body.sort.length > 0 ? body : { ...body, sort: undefined }
    for await (const { event, data } of readSSE('/query', payload, run.signal)) {
      if (!run.isCurrent()) return 'aborted'
      if (event === '__http') {
        const resp = data as HttpError
        const guardrail = guardrailOf(resp)
        if (guardrail) {
          apply({ status: 'idle', guardrail })
          return (outcome = 'guardrail')
        }
        const msg = (resp.body['message'] ?? resp.body['title'] ?? 'Unknown error') as string
        apply({ status: 'error', error: msg })
        showSqlErrorToast(msg)
        return (outcome = 'error')
      }
      if (event === 'columns') {
        if (!options.keepColumns) apply({ columns: data as QueryColumn[] })
      } else if (event === 'rows') {
        apply((r) => ({ rows: [...r.rows, ...(data as Record<string, unknown>[])] }))
      } else if (event === 'done') {
        const d = data as { rowCount: number; durationMs: number; total?: number }
        // Snowflake and Redis send the total with the result: no separate count.
        const total = d.total !== undefined ? { totalCount: d.total } : {}
        apply(options.keepColumns
          ? { status: 'done', durationMs: d.durationMs, ...total }
          : { status: 'done', rowCount: d.rowCount, durationMs: d.durationMs, ...total })
        outcome = 'done'
      } else if (event === 'error') {
        const d = data as { message: string; detail?: string }
        const msg = d.message || 'Query execution failed'
        apply({ status: 'error', error: msg })
        showSqlErrorToast(msg, d.detail)
        outcome = 'error'
      }
    }
  } catch (err) {
    if (run.signal.aborted) return 'aborted'
    const msg = err instanceof Error ? err.message : String(err)
    apply({ status: 'error', error: msg })
    showSqlErrorToast(msg)
    return (outcome = 'error')
  } finally {
    if (outcome === null && run.isCurrent()) {
      apply({ status: 'error', error: 'La connexion au serveur a été interrompue.' })
    }
  }
  return outcome ?? 'error'
}

/** Total row count of a read, computed server-side for every dialect (optional). */
async function fetchTotalCount(
  connectionId: string,
  sql: string,
  tabId: string,
  getState: () => { tabs: QueryTab[] },
  setState: (s: { tabs: QueryTab[] }) => void,
) {
  const run = beginRun(countKey(tabId))
  try {
    const { total } = await api.post<{ total: number | null }>('/query/count', { connectionId, sql })
    if (run.isCurrent() && total !== null) {
      setState({ tabs: patchResult(getState().tabs, tabId, { totalCount: total }) })
    }
  } catch { /* count is optional */ }
}

function isTabDirty(tab: QueryTab): boolean {
  return tab.kind !== 'table' && tab.sql !== tab.originalSql
}

function forceCloseTab(tabs: QueryTab[], activeTabId: string, id: string): { tabs: QueryTab[]; activeTabId: string } {
  const idx = tabs.findIndex((t) => t.id === id)
  const next = tabs.filter((t) => t.id !== id)
  // A closed tab must not keep streaming into nothing.
  runControllers.get(id)?.abort()
  runControllers.get(countKey(id))?.abort()
  blockedRuns.delete(id)
  if (next.length === 0) {
    const fresh = makeQueryTab(1)
    return { tabs: [fresh], activeTabId: fresh.id }
  }
  const newActiveId = activeTabId === id
    ? (next[Math.max(0, idx - 1)] ?? next[0])!.id
    : activeTabId
  return { tabs: next, activeTabId: newActiveId }
}

// ── Store ───────────────────────────────────────

type PersistedState = {
  tabs: QueryTab[]
  activeTabId: string
}

function partialize(state: EditorState): PersistedState {
  return {
    tabs: state.tabs.map((t) => ({
      ...t,
      result: { ...emptyResult(), sortBy: t.result.sortBy, sortMulti: t.result.sortMulti },
      panels: [],
      activePanelIndex: 0,
      unreadChat: 0,
      collaborative: false,
    })),
    activeTabId: state.activeTabId,
  }
}

const fallbackTab = makeQueryTab(1)

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => {
      const setTabs = (tabs: QueryTab[]) => set({ tabs })
      const patchTab = (tabId: string) => (p: Parameters<typeof patchResult>[2]) =>
        set({ tabs: patchResult(get().tabs, tabId, p) })

      /** Full run of one statement in a tab: result + total count. */
      const runSingle = async (connectionId: string, tabId: string, sql: string, force: boolean, sorts: SortEntry[] = []) => {
        const tab = get().tabs.find((t) => t.id === tabId)
        if (!tab) return 'aborted' as const
        const run = beginRun(tabId)
        const [outcome] = await Promise.all([
          streamQuery({ connectionId, sql, limit: tab.result.pageSize, offset: 0, force, sort: sorts }, run, patchTab(tabId)),
          fetchTotalCount(connectionId, sql, tabId, get, set),
        ])
        return outcome
      }

      /** Next page of the current result (columns kept). */
      const runPage = async (connectionId: string, tabId: string, sql: string, pageSize: number, offset: number, sorts: SortEntry[]) => {
        const run = beginRun(tabId)
        // Pagination re-runs a statement the user already ran (and confirmed): force.
        await streamQuery({ connectionId, sql, limit: pageSize, offset, force: true, sort: sorts }, run, patchTab(tabId), { keepColumns: true })
      }

      /**
       * Runs several statements as ONE server batch (one connection: `SET …; DELETE …`
       * and `BEGIN; …; ROLLBACK` behave as written), one panel per statement.
       * The guardrail judges the whole batch before anything runs, so a
       * confirmation replays the batch without running anything twice.
       */
      const runMulti = async (
        connectionId: string,
        statements: string[],
        tabId: string,
        pageSize: number,
        force: boolean,
      ) => {
        const run = beginRun(tabId)
        blockedRuns.delete(tabId)
        const initialPanels = statements.map((sql) => ({ ...emptyResult(), pageSize, executedSql: sql }))
        setTabs(get().tabs.map((t) =>
          t.id === tabId
            ? { ...t, panels: initialPanels, activePanelIndex: 0, result: initialPanels[0]! }
            : t,
        ))

        const patchPanel = (i: number) => (patch: Partial<TabResult> | ((r: TabResult) => Partial<TabResult>)) => {
          if (!run.isCurrent()) return
          setTabs(get().tabs.map((t) => {
            if (t.id !== tabId) return t
            const target = t.panels[i] ?? emptyResult()
            const p = typeof patch === 'function' ? patch(target) : patch
            const updatedPanel = { ...target, ...p }
            const newPanels = t.panels.map((pn, idx) => (idx === i ? updatedPanel : pn))
            // Mirror to the visible result only if this panel is currently active
            const newResult = t.activePanelIndex === i ? updatedPanel : t.result
            return { ...t, panels: newPanels, result: newResult }
          }))
        }
        /** Shows panel `i`, saving the one being left (keeps any user sort/page state). */
        const showPanel = (i: number) => {
          if (!run.isCurrent()) return
          setTabs(get().tabs.map((t) => {
            if (t.id !== tabId) return t
            const savedPanels = t.panels.map((pn, idx) => (idx === t.activePanelIndex ? t.result : pn))
            return { ...t, panels: savedPanels, activePanelIndex: i, result: savedPanels[i] ?? emptyResult() }
          }))
        }

        let current = -1
        try {
          for await (const { event, data } of readSSE('/query/batch', { connectionId, statements, limit: pageSize, force }, run.signal)) {
            if (!run.isCurrent()) return
            if (event === '__http') {
              const resp = data as HttpError
              const index = typeof resp.body['index'] === 'number' ? resp.body['index'] : 0
              showPanel(index)
              const guardrail = guardrailOf(resp)
              if (guardrail) {
                patchPanel(index)({ status: 'idle', guardrail })
                blockedRuns.set(tabId, { connectionId, statements, pageSize })
              } else {
                const msg = (resp.body['message'] ?? resp.body['title'] ?? 'Unknown error') as string
                patchPanel(index)({ status: 'error', error: msg })
                showSqlErrorToast(msg)
              }
              return
            }
            if (event === 'statement') {
              current = (data as { index: number }).index
              showPanel(current)
              patchPanel(current)({ status: 'running', error: null, guardrail: null, columns: [], rows: [] })
            } else if (event === 'columns') {
              patchPanel(current)({ columns: data as QueryColumn[] })
            } else if (event === 'rows') {
              patchPanel(current)((r) => ({ rows: [...r.rows, ...(data as Record<string, unknown>[])] }))
            } else if (event === 'done') {
              const d = data as { rowCount: number; durationMs: number; total?: number }
              patchPanel(current)({
                status: 'done',
                rowCount: d.rowCount,
                durationMs: d.durationMs,
                ...(d.total !== undefined ? { totalCount: d.total } : {}),
              })
              saveQueryHistory(statements[current] ?? '', connectionId, d.durationMs)
            } else if (event === 'error') {
              const d = data as { message: string; detail?: string }
              const msg = d.message || 'Query execution failed'
              patchPanel(Math.max(0, current))({ status: 'error', error: msg })
              showSqlErrorToast(msg, d.detail)
            }
          }
        } catch (err) {
          if (run.signal.aborted) return
          const msg = err instanceof Error ? err.message : String(err)
          patchPanel(Math.max(0, current))({ status: 'error', error: msg })
          showSqlErrorToast(msg)
        } finally {
          // A cut stream must not leave a panel spinning.
          if (run.isCurrent() && current >= 0 && get().tabs.find((t) => t.id === tabId)?.panels[current]?.status === 'running') {
            patchPanel(current)({ status: 'error', error: 'La connexion au serveur a été interrompue.' })
          }
        }
      }

      /** Runs `text` in the active tab: several statements → panels, one → a plain result. */
      const execute = async (text: string, { force = false, split = true }: ExecuteOptions = {}): Promise<boolean> => {
        const { activeConnectionId, activeTabId, connectionDrivers } = get()
        const tab = get().tabs.find((t) => t.id === activeTabId)
        if (!activeConnectionId || !tab || !text.trim()) return false
        const statements = split ? splitStatementsFor(connectionDrivers[activeConnectionId], text) : [text.trim()]

        if (statements.length > 1) {
          await runMulti(activeConnectionId, statements, activeTabId, tab.result.pageSize, force)
          const final = get().tabs.find((t) => t.id === activeTabId)
          return !!final && final.panels.length > 0 && final.panels.every((p) => p.status === 'done')
        }

        const singleSql = statements[0] ?? text.trim()
        // Single-statement run: clear any leftover panels from a previous multi-run
        blockedRuns.delete(activeTabId)
        setTabs(get().tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, panels: [], activePanelIndex: 0, result: { ...t.result, page: 0, totalCount: null, sortBy: null, sortMulti: [], executedSql: singleSql } }
            : t,
        ))
        const outcome = await runSingle(activeConnectionId, activeTabId, singleSql, force)
        const done = get().tabs.find((t) => t.id === activeTabId)
        if (outcome === 'done' && done) saveQueryHistory(singleSql, activeConnectionId, done.result.durationMs)
        return outcome === 'done'
      }

      /** Re-runs the current result with a new sort (count is unaffected by the sort). */
      const resort = async (sorts: SortEntry[]) => {
        const { activeConnectionId, tabs, activeTabId } = get()
        const tab = tabs.find((t) => t.id === activeTabId)
        if (!activeConnectionId || !tab?.sql.trim() || batchRunning(tab)) return
        const baseSql = tab.result.executedSql ?? tab.sql
        set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, sortBy: sorts[0] ?? null, sortMulti: sorts, totalCount: null }) })
        await runSingle(activeConnectionId, activeTabId, baseSql, true, sorts)
      }

      const currentSorts = (r: TabResult): SortEntry[] => (r.sortMulti.length > 0 ? r.sortMulti : r.sortBy ? [r.sortBy] : [])

      /**
       * Sorting, paging or reloading a panel restarts the tab's run: while its
       * batch is still running that would cut the batch (and leave a panel spinning).
       */
      const batchRunning = (tab: QueryTab | undefined) => !!tab && tab.panels.some((p) => p.status === 'running')

      return {
        tabs: [fallbackTab],
        activeTabId: fallbackTab.id,
        activeConnectionId: null,
        selection: '',
        connectionDrivers: {},
        pendingCsvImport: null,
        setPendingCsvImport: (table) => set({ pendingCsvImport: table }),

        setActiveConnection: (id) => set({ activeConnectionId: id }),
        setConnectionDrivers: (drivers) => {
          // No-op when nothing changed: callers sync on every render of the connection
          // list, and a new object each time would re-render every subscriber forever.
          const current = get().connectionDrivers
          const keys = Object.keys(drivers)
          if (keys.length === Object.keys(current).length && keys.every((k) => current[k] === drivers[k])) return
          set({ connectionDrivers: drivers })
        },
        setActiveTab: (id) => {
          const tab = get().tabs.find((t) => t.id === id)
          const updates: Partial<{ activeTabId: string; activeConnectionId: string | null }> = { activeTabId: id }
          // Auto-switch connection if the tab has a different one
          if (tab?.connectionId && tab.connectionId !== get().activeConnectionId) {
            updates.activeConnectionId = tab.connectionId
          }
          set(updates)
          // Auto-run table tabs that have no results yet (e.g. restored from localStorage)
          if (tab?.kind === 'table' && tab.result.status === 'idle' && tab.result.rows.length === 0 && tab.connectionId) {
            void runSingle(tab.connectionId, tab.id, tab.sql, false, currentSorts(tab.result))
          }
        },
        setSelection: (text) => set({ selection: text }),
        setSavedQueryId: (id) => {
          const { tabs, activeTabId } = get()
          set({ tabs: tabs.map((t) => t.id === activeTabId ? { ...t, savedQueryId: id } : t) })
        },

        addTab: () => {
          const { tabs, activeConnectionId } = get()
          const tab = makeQueryTab(tabs.filter((t) => t.kind === 'query').length + 1, activeConnectionId)
          set({ tabs: [...tabs, tab], activeTabId: tab.id })
        },

        closeTab: (id) => {
          const { tabs } = get()
          const tab = tabs.find((t) => t.id === id)
          if (tab && isTabDirty(tab)) {
            set({ pendingClose: { tabId: id } })
            return
          }
          const result = forceCloseTab(tabs, get().activeTabId, id)
          set(result)
        },

        setSql: (sql) => {
          const { tabs, activeTabId } = get()
          set({ tabs: tabs.map((t) => t.id === activeTabId ? { ...t, sql } : t) })
        },

        loadQuery: (sql, name) => {
          const { tabs, activeTabId } = get()
          const displayName = name.length > 20 ? name.slice(0, 20) + '…' : name
          set({
            tabs: tabs.map((t) =>
              t.id === activeTabId ? { ...t, sql, name: displayName } : t
            ),
          })
        },

        openQuery: (sql, name, savedQueryId, collaborative) => {
          const { tabs, activeConnectionId } = get()
          const displayName = name.length > 20 ? name.slice(0, 20) + '…' : name
          // A saved query is identified by its id: two long names may share the same 20 first characters.
          const existing = savedQueryId
            ? tabs.find((t) => t.savedQueryId === savedQueryId)
            : tabs.find((t) => t.kind === 'query' && !t.savedQueryId && t.name === displayName)
          if (existing) {
            set({ activeTabId: existing.id })
            return
          }
          const tab: QueryTab = {
            ...makeQueryTab(tabs.filter((t) => t.kind === 'query').length + 1, activeConnectionId),
            sql,
            originalSql: sql,
            name: displayName,
            savedQueryId: savedQueryId ?? null,
            collaborative: collaborative ?? false,
            panels: [],
            activePanelIndex: 0,
          }
          set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
        },

        openTable: async (tableName) => {
          const { tabs, activeConnectionId, connectionDrivers } = get()
          if (activeConnectionId) recordTableVisit(tableName, activeConnectionId)
          const existing = tabs.find((t) => t.kind === 'table' && t.name === tableName && t.connectionId === activeConnectionId)
          if (existing) {
            set({ activeTabId: existing.id })
            return
          }
          const driver = activeConnectionId ? connectionDrivers[activeConnectionId] : undefined
          const tab = makeTableTab(tableName, activeConnectionId, driver)
          set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
          if (activeConnectionId) {
            await runSingle(activeConnectionId, tab.id, tab.sql, false)
          }
        },

        openFunction: (name, source, params) => {
          const { tabs, activeConnectionId } = get()
          const existing = tabs.find((t) => t.kind === 'function' && t.name === name && t.connectionId === activeConnectionId)
          if (existing) {
            set({ activeTabId: existing.id })
            return
          }
          const tab: QueryTab = {
            id: crypto.randomUUID(),
            name,
            kind: 'function',
            sql: source,
            result: emptyResult(),
            panels: [],
            activePanelIndex: 0,
            savedQueryId: null,
            functionParams: params.map((p) => ({ ...p, value: '' })),
            connectionId: activeConnectionId,
            collaborative: false,
            unreadChat: 0,
            filters: [],
            originalSql: source,
          }
          set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
        },

        setFunctionParams: (params) => {
          const { tabs, activeTabId } = get()
          set({ tabs: tabs.map((t) => t.id === activeTabId ? { ...t, functionParams: params } : t) })
        },

        closeOthers: (id) => {
          const { tabs } = get()
          const toClose = tabs.filter((t) => t.id !== id).map((t) => t.id)
          get().requestBulkClose(toClose)
        },

        closeToLeft: (id) => {
          const { tabs } = get()
          const idx = tabs.findIndex((t) => t.id === id)
          if (idx <= 0) return
          const toClose = tabs.slice(0, idx).map((t) => t.id)
          get().requestBulkClose(toClose)
        },

        closeToRight: (id) => {
          const { tabs } = get()
          const idx = tabs.findIndex((t) => t.id === id)
          if (idx === -1 || idx === tabs.length - 1) return
          const toClose = tabs.slice(idx + 1).map((t) => t.id)
          get().requestBulkClose(toClose)
        },

        closeAll: () => {
          const { tabs } = get()
          get().requestBulkClose(tabs.map((t) => t.id))
        },

        reorderTabs: (fromId, toId) => {
          const { tabs } = get()
          const from = tabs.findIndex((t) => t.id === fromId)
          const to = tabs.findIndex((t) => t.id === toId)
          if (from === -1 || to === -1 || from === to) return
          const next = [...tabs]
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved!)
          set({ tabs: next })
        },

        reloadTab: async () => {
          const { activeConnectionId, tabs, activeTabId } = get()
          const tab = tabs.find((t) => t.id === activeTabId)
          if (!activeConnectionId || !tab?.sql.trim() || batchRunning(tab)) return
          const baseSql = tab.result.executedSql ?? tab.sql
          set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, totalCount: null }) })
          await runSingle(activeConnectionId, activeTabId, baseSql, true, currentSorts(tab.result))
        },

        executeQuery: async (force = false) => {
          const tab = get().tabs.find((t) => t.id === get().activeTabId)
          if (!tab) return
          await execute(tab.sql, { force })
        },

        executeSelection: async () => {
          // Not forced: a selected `DROP TABLE` gets the same confirmation as a typed one.
          await execute(get().selection)
        },

        executeSql: (sql, { force = true, split = true } = {}) => execute(sql, { force, split }),

        goToPage: async (page: number) => {
          const { activeConnectionId, tabs, activeTabId } = get()
          const tab = tabs.find((t) => t.id === activeTabId)
          if (!activeConnectionId || !tab || batchRunning(tab)) return
          const baseSql = tab.result.executedSql ?? tab.sql
          if (!baseSql.trim()) return
          set({ tabs: patchResult(get().tabs, activeTabId, { page }) })
          await runPage(activeConnectionId, activeTabId, baseSql, tab.result.pageSize, page * tab.result.pageSize, currentSorts(tab.result))
        },

        setResultPageSize: async (size: number) => {
          const { activeConnectionId, tabs, activeTabId } = get()
          const tab = tabs.find((t) => t.id === activeTabId)
          if (!activeConnectionId || !tab || batchRunning(tab)) return
          const baseSql = tab.result.executedSql ?? tab.sql
          if (!baseSql.trim()) return
          set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, pageSize: size }) })
          await runPage(activeConnectionId, activeTabId, baseSql, size, 0, currentSorts(tab.result))
        },

        sortByColumn: async (column: string, additive = false) => {
          const tab = get().tabs.find((t) => t.id === get().activeTabId)
          if (!tab) return
          const { sortMulti } = tab.result
          let sorts: SortEntry[]

          if (additive) {
            // Shift+click: add/toggle column in multi-sort
            const existing = sortMulti.find((s) => s.column === column)
            if (!existing) {
              sorts = [...sortMulti, { column, direction: 'asc' }]
            } else if (existing.direction === 'asc') {
              sorts = sortMulti.map((s) => s.column === column ? { ...s, direction: 'desc' as const } : s)
            } else {
              sorts = sortMulti.filter((s) => s.column !== column)
            }
          } else {
            // Normal click: single sort (replaces all)
            const current = sortMulti.length === 1 ? sortMulti[0] : null
            if (current?.column !== column) {
              sorts = [{ column, direction: 'asc' }]
            } else if (current.direction === 'asc') {
              sorts = [{ column, direction: 'desc' }]
            } else {
              sorts = []
            }
          }
          await resort(sorts)
        },

        sortByMulti: (sorts: SortEntry[]) => resort(sorts),

        clearGuardrail: () => {
          const { tabs, activeTabId } = get()
          blockedRuns.delete(activeTabId)
          set({ tabs: patchResult(tabs, activeTabId, { guardrail: null }) })
        },

        confirmGuardrail: async () => {
          const { tabs, activeTabId } = get()
          const tab = tabs.find((t) => t.id === activeTabId)
          if (!tab) return
          const blocked = blockedRuns.get(activeTabId)
          set({ tabs: patchResult(get().tabs, activeTabId, { guardrail: null }) })
          if (blocked) {
            await runMulti(blocked.connectionId, blocked.statements, activeTabId, blocked.pageSize, true)
            return
          }
          // The statement that was stopped — a selection, not necessarily the whole tab.
          const sql = tab.result.executedSql ?? tab.sql
          if (!get().activeConnectionId || !sql.trim()) return
          setTabs(get().tabs.map((t) =>
            t.id === activeTabId ? { ...t, result: { ...t.result, page: 0, totalCount: null } } : t,
          ))
          const outcome = await runSingle(get().activeConnectionId!, activeTabId, sql, true, currentSorts(tab.result))
          const done = get().tabs.find((t) => t.id === activeTabId)
          if (outcome === 'done' && done) saveQueryHistory(sql, get().activeConnectionId!, done.result.durationMs)
        },

        clearResults: () => {
          const { tabs, activeTabId } = get()
          set({
            tabs: tabs.map((t) =>
              t.id === activeTabId
                ? { ...t, result: emptyResult(), panels: [], activePanelIndex: 0 }
                : t,
            ),
          })
        },

        setActivePanel: (idx) => {
          const { tabs, activeTabId } = get()
          const tab = tabs.find((t) => t.id === activeTabId)
          if (!tab || tab.panels.length === 0 || idx < 0 || idx >= tab.panels.length || idx === tab.activePanelIndex) return
          set({
            tabs: tabs.map((t) => {
              if (t.id !== activeTabId) return t
              // Save the current visible result back into the slot we are leaving,
              // so that user-driven sort/page state is preserved on switch-back.
              const savedPanels = t.panels.map((p, i) => (i === t.activePanelIndex ? t.result : p))
              return {
                ...t,
                panels: savedPanels,
                activePanelIndex: idx,
                result: savedPanels[idx]!,
              }
            }),
          })
        },

        setTabFilters: (filters) => {
          const { tabs, activeTabId } = get()
          set({ tabs: tabs.map((t) => t.id === activeTabId ? { ...t, filters } : t) })
        },

        markSaved: () => {
          const { tabs, activeTabId } = get()
          set({ tabs: tabs.map((t) => t.id === activeTabId ? { ...t, originalSql: t.sql } : t) })
        },

        pendingClose: null,

        requestBulkClose: (tabIds) => {
          const { tabs } = get()
          const dirty: string[] = []
          const clean: string[] = []
          for (const id of tabIds) {
            const tab = tabs.find((t) => t.id === id)
            if (tab && isTabDirty(tab)) dirty.push(id)
            else clean.push(id)
          }
          let state = get()
          for (const id of clean) {
            const result = forceCloseTab(state.tabs, state.activeTabId, id)
            state = { ...state, ...result }
          }
          set({ tabs: state.tabs, activeTabId: state.activeTabId })
          if (dirty.length > 0) {
            const [first, ...rest] = dirty
            set({ pendingClose: { tabId: first!, remainingIds: rest.length > 0 ? rest : undefined } })
          }
        },

        confirmClose: (action) => {
          const { pendingClose } = get()
          if (!pendingClose) return
          if (action === 'cancel') {
            set({ pendingClose: null })
            return
          }
          if (action === 'discard') {
            const result = forceCloseTab(get().tabs, get().activeTabId, pendingClose.tabId)
            const remaining = pendingClose.remainingIds
            if (remaining && remaining.length > 0) {
              const [next, ...rest] = remaining
              set({ ...result, pendingClose: { tabId: next!, remainingIds: rest.length > 0 ? rest : undefined } })
            } else {
              set({ ...result, pendingClose: null })
            }
          }
        },

        chatOpen: false,
        setChatOpen: (open) => set({ chatOpen: open }),
        incrementUnread: (tabId) => set((s) => ({
          tabs: s.tabs.map((t) => t.id === tabId ? { ...t, unreadChat: t.unreadChat + 1 } : t),
        })),
        resetUnread: (tabId) => set((s) => ({
          tabs: s.tabs.map((t) => t.id === tabId ? { ...t, unreadChat: 0 } : t),
        })),
      }
    },
    {
      name: 'dblumi:editor-tabs',
      version: 2,
      partialize,
      migrate: (persisted, _fromVersion) => {
        const p = persisted as Partial<PersistedState> | null | undefined
        const tabs = (p?.tabs ?? [fallbackTab]).map((t) => ({
          ...t,
          panels: [],
          activePanelIndex: 0,
        }))
        return {
          tabs,
          activeTabId: p?.activeTabId ?? tabs[0]!.id,
        }
      },
    },
  ),
)

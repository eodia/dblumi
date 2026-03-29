import { create } from 'zustand'
import { readSSE } from '../api/client'

export type QueryStatus = 'idle' | 'running' | 'done' | 'error'

export type GuardrailInfo = {
  level: 1 | 2 | 3 | 4
  message: string
  details: string
}

export type QueryColumn = { name: string; dataType: string; nullable?: boolean }

export type SortBy = { column: string; direction: 'asc' | 'desc' } | null

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
}

export type TabKind = 'query' | 'table'

export type QueryTab = {
  id: string
  name: string
  kind: TabKind
  sql: string
  result: TabResult
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
})

type EditorState = {
  tabs: QueryTab[]
  activeTabId: string
  activeConnectionId: string | null

  setActiveConnection: (id: string | null) => void
  setActiveTab: (id: string) => void
  addTab: () => void
  closeTab: (id: string) => void
  setSql: (sql: string) => void
  loadQuery: (sql: string, name: string) => void
  openQuery: (sql: string, name: string) => void
  openTable: (tableName: string) => Promise<void>
  reorderTabs: (fromId: string, toId: string) => void
  closeOthers: (id: string) => void
  closeToLeft: (id: string) => void
  closeToRight: (id: string) => void
  closeAll: () => void

  executeQuery: (force?: boolean) => Promise<void>
  reloadTab: () => Promise<void>
  goToPage: (page: number) => Promise<void>
  setResultPageSize: (size: number) => Promise<void>
  sortByColumn: (column: string) => Promise<void>
  clearGuardrail: () => void
  clearResults: () => void
}

function makeQueryTab(n: number): QueryTab {
  return { id: crypto.randomUUID(), name: `Query ${n}`, kind: 'query', sql: '', result: emptyResult() }
}

function makeTableTab(tableName: string): QueryTab {
  return {
    id: crypto.randomUUID(),
    name: tableName,
    kind: 'table',
    sql: `SELECT * FROM ${tableName}`,
    result: emptyResult(),
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

/**
 * Build the effective SQL with ORDER BY.
 * When sortBy is null, returns the original SQL untouched.
 * When sortBy is set, wraps in a subquery so the UI sort takes
 * precedence without destroying the user's original ORDER BY.
 */
function buildSortedSql(baseSql: string, sortBy: SortBy): string {
  if (!sortBy) return baseSql
  const clean = baseSql.trim().replace(/;+$/, '')
  const dir = sortBy.direction.toUpperCase()
  return `SELECT * FROM (${clean}) AS _s ORDER BY ${sortBy.column} ${dir}`
}

// ── SSE helpers ─────────────────────────────────

/** Full query execution — resets columns, rows, fetches a page */
async function runSse(
  connectionId: string,
  sql: string,
  tabId: string,
  pageSize: number,
  offset: number,
  getTabs: () => QueryTab[],
  setTabs: (tabs: QueryTab[]) => void,
  force = false,
) {
  setTabs(patchResult(getTabs(), tabId, { status: 'running', error: null, guardrail: null, columns: [], rows: [] }))

  for await (const { event, data } of readSSE('/query', { connectionId, sql, limit: pageSize, offset, force })) {
    if (event === '__http') {
      const resp = data as { status: number; body: Record<string, unknown> }
      const b = resp.body
      if (resp.status === 422 && b['type'] === 'guardrail') {
        setTabs(patchResult(getTabs(), tabId, {
          status: 'idle',
          guardrail: {
            level: b['level'] as 1 | 2 | 3 | 4,
            message: b['message'] as string,
            details: b['details'] as string,
          },
        }))
      } else {
        setTabs(patchResult(getTabs(), tabId, {
          status: 'error',
          error: (b['message'] ?? b['title'] ?? 'Unknown error') as string,
        }))
      }
      return
    }

    if (event === 'columns') {
      setTabs(patchResult(getTabs(), tabId, { columns: data as QueryColumn[] }))
    } else if (event === 'rows') {
      setTabs(patchResult(getTabs(), tabId, (r) => ({ rows: [...r.rows, ...(data as Record<string, unknown>[])] })))
    } else if (event === 'done') {
      const d = data as { rowCount: number; durationMs: number }
      setTabs(patchResult(getTabs(), tabId, { status: 'done', rowCount: d.rowCount, durationMs: d.durationMs }))
    } else if (event === 'error') {
      const d = data as { message: string }
      setTabs(patchResult(getTabs(), tabId, { status: 'error', error: d.message || 'Query execution failed' }))
    }
  }
}

/** Lighter page fetch — keeps columns, only replaces rows */
async function fetchPageSse(
  connectionId: string,
  sql: string,
  tabId: string,
  pageSize: number,
  offset: number,
  getTabs: () => QueryTab[],
  setTabs: (tabs: QueryTab[]) => void,
) {
  setTabs(patchResult(getTabs(), tabId, { status: 'running', rows: [] }))

  for await (const { event, data } of readSSE('/query', { connectionId, sql, limit: pageSize, offset, force: true })) {
    if (event === '__http') {
      const resp = data as { status: number; body: Record<string, unknown> }
      setTabs(patchResult(getTabs(), tabId, {
        status: 'error',
        error: ((resp.body as Record<string, unknown>)['message'] ?? 'Unknown error') as string,
      }))
      return
    }
    if (event === 'rows') {
      setTabs(patchResult(getTabs(), tabId, (r) => ({ rows: [...r.rows, ...(data as Record<string, unknown>[])] })))
    } else if (event === 'done') {
      const d = data as { rowCount: number; durationMs: number }
      setTabs(patchResult(getTabs(), tabId, { status: 'done', durationMs: d.durationMs }))
    } else if (event === 'error') {
      const d = data as { message: string }
      setTabs(patchResult(getTabs(), tabId, { status: 'error', error: d.message || 'Query execution failed' }))
    }
  }
}

/** Fetch real row count via COUNT(*) wrapper */
async function fetchTotalCount(
  connectionId: string,
  sql: string,
  tabId: string,
  getState: () => { tabs: QueryTab[] },
  setState: (s: { tabs: QueryTab[] }) => void,
) {
  const upper = sql.trim().toUpperCase()
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) return

  try {
    const countSql = `SELECT COUNT(*) AS total FROM (${sql.trim().replace(/;+$/, '')}) AS _cnt`
    for await (const { event, data } of readSSE('/query', {
      connectionId,
      sql: countSql,
      limit: 1,
      force: true,
    })) {
      if (event === 'rows') {
        const rows = data as Record<string, unknown>[]
        const total = Number(rows[0]?.['total'] ?? 0)
        if (total > 0) {
          setState({ tabs: patchResult(getState().tabs, tabId, { totalCount: total }) })
        }
      }
    }
  } catch { /* count is optional */ }
}

// ── Store ───────────────────────────────────────

const initialTab = makeQueryTab(1)

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  activeConnectionId: null,

  setActiveConnection: (id) => set({ activeConnectionId: id }),
  setActiveTab: (id) => set({ activeTabId: id }),

  addTab: () => {
    const { tabs } = get()
    const tab = makeQueryTab(tabs.filter((t) => t.kind === 'query').length + 1)
    set({ tabs: [...tabs, tab], activeTabId: tab.id })
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    if (next.length === 0) {
      const tab = makeQueryTab(1)
      set({ tabs: [tab], activeTabId: tab.id })
      return
    }
    const newActiveId = activeTabId === id
      ? (next[Math.max(0, idx - 1)] ?? next[0])!.id
      : activeTabId
    set({ tabs: next, activeTabId: newActiveId })
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

  openQuery: (sql, name) => {
    const { tabs } = get()
    const displayName = name.length > 20 ? name.slice(0, 20) + '…' : name
    const existing = tabs.find((t) => t.kind === 'query' && t.name === displayName)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const tab: QueryTab = {
      ...makeQueryTab(tabs.filter((t) => t.kind === 'query').length + 1),
      sql,
      name: displayName,
    }
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
  },

  openTable: async (tableName) => {
    const { tabs, activeConnectionId } = get()
    const existing = tabs.find((t) => t.kind === 'table' && t.name === tableName)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const tab = makeTableTab(tableName)
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
    if (activeConnectionId) {
      const ps = tab.result.pageSize
      await Promise.all([
        runSse(activeConnectionId, tab.sql, tab.id, ps, 0, () => get().tabs, (tabs) => set({ tabs })),
        fetchTotalCount(activeConnectionId, tab.sql, tab.id, get, set),
      ])
    }
  },

  closeOthers: (id) => {
    const { tabs } = get()
    const keep = tabs.find((t) => t.id === id)
    if (!keep) return
    set({ tabs: [keep], activeTabId: id })
  },

  closeToLeft: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx <= 0) return
    const next = tabs.slice(idx)
    const newActiveId = next.find((t) => t.id === activeTabId) ? activeTabId : id
    set({ tabs: next, activeTabId: newActiveId })
  },

  closeToRight: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx === -1 || idx === tabs.length - 1) return
    const next = tabs.slice(0, idx + 1)
    const newActiveId = next.find((t) => t.id === activeTabId) ? activeTabId : id
    set({ tabs: next, activeTabId: newActiveId })
  },

  closeAll: () => {
    const tab = makeQueryTab(1)
    set({ tabs: [tab], activeTabId: tab.id })
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
    if (!activeConnectionId || !tab?.sql.trim()) return
    const { pageSize, sortBy } = tab.result
    const effectiveSql = buildSortedSql(tab.sql, sortBy)
    set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, totalCount: null }) })
    await Promise.all([
      runSse(activeConnectionId, effectiveSql, activeTabId, pageSize, 0, () => get().tabs, (tabs) => set({ tabs }), true),
      fetchTotalCount(activeConnectionId, tab.sql, activeTabId, get, set),
    ])
  },

  executeQuery: async (force = false) => {
    const { activeConnectionId, tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!activeConnectionId || !tab?.sql.trim()) return
    const { pageSize } = tab.result
    // Reset sort when user manually executes
    set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, totalCount: null, sortBy: null }) })
    await Promise.all([
      runSse(activeConnectionId, tab.sql, activeTabId, pageSize, 0, () => get().tabs, (tabs) => set({ tabs }), force),
      fetchTotalCount(activeConnectionId, tab.sql, activeTabId, get, set),
    ])
  },

  goToPage: async (page: number) => {
    const { activeConnectionId, tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!activeConnectionId || !tab?.sql.trim()) return
    const { pageSize, sortBy } = tab.result
    const effectiveSql = buildSortedSql(tab.sql, sortBy)
    set({ tabs: patchResult(get().tabs, activeTabId, { page }) })
    await fetchPageSse(activeConnectionId, effectiveSql, activeTabId, pageSize, page * pageSize, () => get().tabs, (tabs) => set({ tabs }))
  },

  setResultPageSize: async (size: number) => {
    const { activeConnectionId, tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!activeConnectionId || !tab?.sql.trim()) return
    const { sortBy } = tab.result
    const effectiveSql = buildSortedSql(tab.sql, sortBy)
    set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, pageSize: size }) })
    await fetchPageSse(activeConnectionId, effectiveSql, activeTabId, size, 0, () => get().tabs, (tabs) => set({ tabs }))
  },

  sortByColumn: async (column: string) => {
    const { activeConnectionId, tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!activeConnectionId || !tab?.sql.trim()) return
    const { sortBy, pageSize } = tab.result

    // Cycle: none → asc → desc → none
    let newSort: SortBy
    if (sortBy?.column !== column) newSort = { column, direction: 'asc' }
    else if (sortBy.direction === 'asc') newSort = { column, direction: 'desc' }
    else newSort = null

    const effectiveSql = buildSortedSql(tab.sql, newSort)
    set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, sortBy: newSort, totalCount: null }) })
    await Promise.all([
      runSse(activeConnectionId, effectiveSql, activeTabId, pageSize, 0, () => get().tabs, (tabs) => set({ tabs }), true),
      fetchTotalCount(activeConnectionId, tab.sql, activeTabId, get, set),
    ])
  },

  clearGuardrail: () => {
    const { tabs, activeTabId } = get()
    set({ tabs: patchResult(tabs, activeTabId, { guardrail: null }) })
  },

  clearResults: () => {
    const { tabs, activeTabId } = get()
    set({ tabs: patchResult(tabs, activeTabId, emptyResult()) })
  },
}))

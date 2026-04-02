# Overview Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la page Project Overview avec stats de base, santé de connexion, historique de requêtes, accès rapide, et un diagramme ERD SVG interactif.

**Architecture:** Un composant `OverviewPage` divisé en sous-composants par section, avec tracking localStorage pour l'historique et les visites, un nouvel endpoint backend `/stats`, et un diagramme ERD SVG pur (pan/zoom, pas de dépendance externe).

**Tech Stack:** React + TanStack Query, Zustand, Tailwind CSS, SVG natif, localStorage, Hono backend

---

## File Map

**New files:**
- `src/web/src/components/overview/OverviewPage.tsx` — page principale, grille des cartes
- `src/web/src/components/overview/StatsCards.tsx` — 4 cartes stat (tables/vues/fonctions/taille)
- `src/web/src/components/overview/ConnectionHealthCard.tsx` — santé, latence, version, encoding, timezone
- `src/web/src/components/overview/ActivityCard.tsx` — requêtes récentes + saved queries récentes
- `src/web/src/components/overview/QuickAccessCard.tsx` — tables les plus visitées + queries épinglées
- `src/web/src/components/overview/ErdDiagram.tsx` — diagramme ERD SVG interactif

**Modified files:**
- `src/api/src/routes/connections.ts` — ajouter `GET /connections/:id/stats`
- `src/web/src/api/connections.ts` — ajouter `stats()` + types
- `src/web/src/stores/editor.store.ts` — injecter tracking history/visits
- `src/web/src/components/layout/AppShell.tsx` — brancher `OverviewPage` sur `page === 'overview'`
- `src/web/src/i18n/en.ts` + `fr.ts` — clés overview

---

## Task 1: Backend `/connections/:id/stats`

**Files:**
- Modify: `src/api/src/routes/connections.ts` (après `getOracleSchema`)

- [ ] **Étape 1 : Ajouter la fonction `getDbStats`**

Ajouter juste avant la ligne `export { connectionsRouter }` dans `src/api/src/routes/connections.ts` :

```typescript
async function getDbStats(pool: PgPool | MySQLPool | OraclePool, driver: string) {
  let version: string | null = null
  let encoding: string | null = null
  let timezone: string | null = null
  let sizePretty: string | null = null
  let sizeBytes: number | null = null

  try {
    if (driver === 'postgresql') {
      const pg = pool as PgPool
      const client = await pg.connect()
      try {
        const { rows } = await client.query(`
          SELECT
            version() AS version,
            current_setting('server_encoding') AS encoding,
            current_setting('TimeZone') AS timezone,
            pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
            pg_database_size(current_database()) AS size_bytes
        `)
        version = (rows[0] as Record<string,unknown>)?.version as string ?? null
        encoding = (rows[0] as Record<string,unknown>)?.encoding as string ?? null
        timezone = (rows[0] as Record<string,unknown>)?.timezone as string ?? null
        sizePretty = (rows[0] as Record<string,unknown>)?.size_pretty as string ?? null
        sizeBytes = Number((rows[0] as Record<string,unknown>)?.size_bytes ?? null) || null
      } finally { client.release() }
    } else if (driver === 'mysql') {
      const mysql = pool as MySQLPool
      const conn = await mysql.getConnection()
      try {
        const [[vrow]] = await conn.query('SELECT VERSION() AS v') as [Record<string,unknown>[], unknown]
        version = (vrow as Record<string,unknown>)?.v as string ?? null
        const [[encrow]] = await conn.query("SELECT @@character_set_server AS e") as [Record<string,unknown>[], unknown]
        encoding = (encrow as Record<string,unknown>)?.e as string ?? null
        const [[tzrow]] = await conn.query("SELECT @@global.time_zone AS z") as [Record<string,unknown>[], unknown]
        timezone = (tzrow as Record<string,unknown>)?.z as string ?? null
        const [[srow]] = await conn.query(`
          SELECT ROUND(SUM(data_length + index_length), 0) AS sb
          FROM information_schema.TABLES
          WHERE table_schema = DATABASE()
        `) as [Record<string,unknown>[], unknown]
        sizeBytes = Number((srow as Record<string,unknown>)?.sb) || null
        if (sizeBytes) sizePretty = sizeBytes > 1_073_741_824
          ? `${(sizeBytes / 1_073_741_824).toFixed(1)} GB`
          : sizeBytes > 1_048_576
          ? `${(sizeBytes / 1_048_576).toFixed(1)} MB`
          : `${Math.round(sizeBytes / 1024)} KB`
      } finally { conn.release() }
    } else {
      // Oracle: best-effort, many views need DBA grants
      const oracle = pool as OraclePool
      const conn = await oracle.getConnection()
      try {
        const r1 = await conn.execute<[string]>('SELECT banner FROM v$version WHERE ROWNUM = 1', [], { outFormat: 4001 })
        version = (r1.rows?.[0] as [string])?.[0] ?? null
      } catch { /* v$version may need DBA */ }
      try {
        const conn2 = await oracle.getConnection()
        try {
          const r2 = await conn2.execute<[number]>('SELECT SUM(bytes) FROM user_segments', [], { outFormat: 4001 })
          sizeBytes = Number((r2.rows?.[0] as [number])?.[0]) || null
          if (sizeBytes) sizePretty = sizeBytes > 1_073_741_824
            ? `${(sizeBytes / 1_073_741_824).toFixed(1)} GB`
            : `${(sizeBytes / 1_048_576).toFixed(1)} MB`
        } finally { await conn2.close() }
      } catch { /* segments may not be accessible */ }
      try { await conn.close() } catch { /* ignore */ }
    }
  } catch (err) {
    logger.warn({ err }, 'getDbStats partial failure')
  }

  return { version, encoding, timezone, sizePretty, sizeBytes }
}
```

- [ ] **Étape 2 : Ajouter la route `GET /connections/:id/stats`**

Ajouter juste avant `export { connectionsRouter }` :

```typescript
connectionsRouter.get('/:id/stats', async (c) => {
  const userId = c.get('userId')
  const connectionId = c.req.param('id')

  let poolOpts
  try {
    poolOpts = await getPoolOptions(connectionId, userId)
  } catch {
    return c.json(problem(404, 'Connexion introuvable.'), 404)
  }

  const pool = await connectionManager.getPool(connectionId, poolOpts)

  try {
    const stats = await getDbStats(pool, poolOpts.driver)
    return c.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stats unavailable'
    return c.json(problem(502, message), 502)
  }
})
```

- [ ] **Étape 3 : Vérifier le typecheck backend**

```bash
cd src/api && pnpm typecheck
```
Attendu : 0 erreur.

---

## Task 2: Frontend API — `connectionsApi.stats()`

**Files:**
- Modify: `src/web/src/api/connections.ts`

- [ ] **Étape 1 : Ajouter le type `DbStats`**

Ajouter après le type `SchemaFunction` :

```typescript
export type DbStats = {
  version: string | null
  encoding: string | null
  timezone: string | null
  sizePretty: string | null
  sizeBytes: number | null
}
```

- [ ] **Étape 2 : Ajouter la méthode `stats` dans `connectionsApi`**

Ajouter après `switchDatabase` :

```typescript
  stats: (id: string) => api.get<DbStats>(`/connections/${id}/stats`),
```

- [ ] **Étape 3 : Vérifier typecheck web**

```bash
cd src/web && pnpm typecheck 2>&1 | grep "connections.ts"
```
Attendu : 0 erreur sur connections.ts.

---

## Task 3: Tracking historique + visites dans editor.store.ts

**Files:**
- Modify: `src/web/src/stores/editor.store.ts`

Types localStorage utilisés :
```typescript
// dblumi:qhistory
type QueryHistoryEntry = { sql: string; connectionId: string; executedAt: string; durationMs: number }
// dblumi:tvisits
type TableVisitEntry = { tableName: string; connectionId: string; visitCount: number; lastVisited: string }
```

- [ ] **Étape 1 : Ajouter les helpers localStorage en haut du fichier (après les imports)**

Chercher la ligne `// ── SSE helpers` dans editor.store.ts et insérer avant :

```typescript
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
```

- [ ] **Étape 2 : Injecter `saveQueryHistory` dans `executeQuery`**

Remplacer le corps de `executeQuery` :

```typescript
executeQuery: async (force = false) => {
  const { activeConnectionId, tabs, activeTabId } = get()
  const tab = tabs.find((t) => t.id === activeTabId)
  if (!activeConnectionId || !tab?.sql.trim()) return
  const { pageSize } = tab.result
  set({ tabs: patchResult(get().tabs, activeTabId, { page: 0, totalCount: null, sortBy: null, sortMulti: [], executedSql: tab.sql }) })
  await Promise.all([
    runSse(activeConnectionId, tab.sql, activeTabId, pageSize, 0, () => get().tabs, (tabs) => set({ tabs }), force),
    fetchTotalCount(activeConnectionId, tab.sql, activeTabId, get, set),
  ])
  const done = get().tabs.find((t) => t.id === activeTabId)
  if (done?.result.status === 'done') {
    saveQueryHistory(tab.sql, activeConnectionId, done.result.durationMs)
  }
},
```

- [ ] **Étape 3 : Injecter `recordTableVisit` dans `openTable`**

Ajouter juste après `const { tabs, activeConnectionId } = get()` dans `openTable` :

```typescript
if (activeConnectionId) recordTableVisit(tableName, activeConnectionId)
```

- [ ] **Étape 4 : Vérifier typecheck**

```bash
cd src/web && pnpm typecheck 2>&1 | grep "editor.store"
```
Attendu : 0 erreur.

---

## Task 4: Traductions i18n

**Files:**
- Modify: `src/web/src/i18n/en.ts`
- Modify: `src/web/src/i18n/fr.ts`

- [ ] **Étape 1 : Ajouter les clés dans `en.ts`**

Trouver `'common.overviewPlaceholder'` et remplacer le bloc `// ── Navigation ──` par :

```typescript
  // ── Navigation ──
  'nav.overview': 'Project Overview',
  'nav.tables': 'Tables',
  'nav.sqlEditor': 'SQL Editor',

  // ── Overview ──
  'overview.noConnection': 'Select a connection to view the overview',
  'overview.stats': 'Database',
  'overview.tables': 'Tables',
  'overview.views': 'Views',
  'overview.functions': 'Functions',
  'overview.dbSize': 'Size',
  'overview.health': 'Connection health',
  'overview.connected': 'Connected',
  'overview.disconnected': 'Disconnected',
  'overview.latency': 'Latency',
  'overview.version': 'Server version',
  'overview.encoding': 'Encoding',
  'overview.timezone': 'Timezone',
  'overview.recentQueries': 'Recent queries',
  'overview.recentSaved': 'Recent saved queries',
  'overview.topTables': 'Most visited tables',
  'overview.pinned': 'Pinned queries',
  'overview.noHistory': 'No recent queries',
  'overview.noPinned': 'No pinned queries — click ★ on a saved query',
  'overview.noTopTables': 'No table visits yet',
  'overview.erd': 'Data model',
  'overview.erdHint': 'Scroll to zoom · drag to pan · click a table to open it',
  'overview.noSchema': 'No tables found',
  'overview.noSaved': 'No saved queries',
  'overview.pin': 'Pin',
  'overview.unpin': 'Unpin',
```

- [ ] **Étape 2 : Ajouter les clés dans `fr.ts`**

Même emplacement, en français :

```typescript
  // ── Navigation ──
  'nav.overview': 'Project Overview',
  'nav.tables': 'Tables',
  'nav.sqlEditor': 'SQL Editor',

  // ── Overview ──
  'overview.noConnection': 'Sélectionner une connexion pour voir l\'overview',
  'overview.stats': 'Base de données',
  'overview.tables': 'Tables',
  'overview.views': 'Vues',
  'overview.functions': 'Fonctions',
  'overview.dbSize': 'Taille',
  'overview.health': 'Santé de la connexion',
  'overview.connected': 'Connecté',
  'overview.disconnected': 'Déconnecté',
  'overview.latency': 'Latence',
  'overview.version': 'Version serveur',
  'overview.encoding': 'Encodage',
  'overview.timezone': 'Fuseau horaire',
  'overview.recentQueries': 'Requêtes récentes',
  'overview.recentSaved': 'Requêtes sauvegardées récentes',
  'overview.topTables': 'Tables les plus visitées',
  'overview.pinned': 'Requêtes épinglées',
  'overview.noHistory': 'Aucune requête récente',
  'overview.noPinned': 'Aucune requête épinglée — cliquer ★ sur une requête',
  'overview.noTopTables': 'Aucune visite de table',
  'overview.erd': 'Modèle de données',
  'overview.erdHint': 'Scroll pour zoomer · glisser pour naviguer · cliquer pour ouvrir',
  'overview.noSchema': 'Aucune table trouvée',
  'overview.noSaved': 'Aucune requête sauvegardée',
  'overview.pin': 'Épingler',
  'overview.unpin': 'Désépingler',
```

---

## Task 5: `StatsCards` + `ConnectionHealthCard`

**Files:**
- Create: `src/web/src/components/overview/StatsCards.tsx`
- Create: `src/web/src/components/overview/ConnectionHealthCard.tsx`

- [ ] **Étape 1 : Créer `StatsCards.tsx`**

```typescript
// src/web/src/components/overview/StatsCards.tsx
import { useQuery } from '@tanstack/react-query'
import { connectionsApi, type SchemaTable, type SchemaFunction, type DbStats } from '@/api/connections'
import { useI18n } from '@/i18n'
import { Table2, Eye, Zap, HardDrive } from 'lucide-react'

type Props = { connectionId: string }

export function StatsCards({ connectionId }: Props) {
  const { t } = useI18n()

  const { data: schema } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const { data: stats } = useQuery({
    queryKey: ['dbstats', connectionId],
    queryFn: () => connectionsApi.stats(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const tableCount = schema?.tables.filter((t: SchemaTable) => t.type !== 'view').length ?? '—'
  const viewCount = schema?.tables.filter((t: SchemaTable) => t.type === 'view').length ?? '—'
  const funcCount = schema?.functions?.length ?? '—'
  const dbSize = stats?.sizePretty ?? '—'

  const items = [
    { label: t('overview.tables'), value: tableCount, icon: Table2, color: 'text-blue-400' },
    { label: t('overview.views'), value: viewCount, icon: Eye, color: 'text-violet-400' },
    { label: t('overview.functions'), value: funcCount, icon: Zap, color: 'text-amber-400' },
    { label: t('overview.dbSize'), value: dbSize, icon: HardDrive, color: 'text-emerald-400' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
          <Icon className={`h-8 w-8 ${color} flex-shrink-0 opacity-80`} />
          <div>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Étape 2 : Créer `ConnectionHealthCard.tsx`**

```typescript
// src/web/src/components/overview/ConnectionHealthCard.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi } from '@/api/connections'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { CheckCircle, XCircle, RefreshCw, Server, Globe, Type } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = { connectionId: string }

export function ConnectionHealthCard({ connectionId }: Props) {
  const { t } = useI18n()
  const [checking, setChecking] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)

  const { data: stats } = useQuery({
    queryKey: ['dbstats', connectionId],
    queryFn: () => connectionsApi.stats(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const handleCheck = async () => {
    setChecking(true)
    try {
      const r = await connectionsApi.test(connectionId)
      setHealth(r)
    } catch {
      setHealth({ ok: false, error: 'Unreachable' })
    } finally {
      setChecking(false)
    }
  }

  const rows = [
    { icon: Server, label: t('overview.version'), value: stats?.version ?? '—' },
    { icon: Type, label: t('overview.encoding'), value: stats?.encoding ?? '—' },
    { icon: Globe, label: t('overview.timezone'), value: stats?.timezone ?? '—' },
  ]

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{t('overview.health')}</span>
        <div className="flex items-center gap-2">
          {health && (
            <span className={cn('text-xs flex items-center gap-1', health.ok ? 'text-emerald-400' : 'text-destructive')}>
              {health.ok
                ? <><CheckCircle className="h-3.5 w-3.5" />{t('overview.connected')} · {health.latencyMs}ms</>
                : <><XCircle className="h-3.5 w-3.5" />{health.error ?? t('overview.disconnected')}</>
              }
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCheck} disabled={checking}>
            <RefreshCw className={cn('h-3 w-3', checking && 'animate-spin')} />
            {t('overview.latency')}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-md bg-surface-raised px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
            </div>
            <p className="text-xs font-mono truncate" title={value}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Task 6: `ActivityCard`

**Files:**
- Create: `src/web/src/components/overview/ActivityCard.tsx`

- [ ] **Étape 1 : Créer `ActivityCard.tsx`**

```typescript
// src/web/src/components/overview/ActivityCard.tsx
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { savedQueriesApi } from '@/api/saved-queries'
import { useEditorStore } from '@/stores/editor.store'
import { type QueryHistoryEntry } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Clock, BookMarked } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = { connectionId: string }

function useQueryHistory(connectionId: string): QueryHistoryEntry[] {
  return useMemo(() => {
    try {
      const all: QueryHistoryEntry[] = JSON.parse(localStorage.getItem('dblumi:qhistory') ?? '[]')
      return all.filter((e) => e.connectionId === connectionId).slice(0, 8)
    } catch {
      return []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])
}

export function ActivityCard({ connectionId }: Props) {
  const { t } = useI18n()
  const { openQuery } = useEditorStore()
  const history = useQueryHistory(connectionId)

  const { data: savedData } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: savedQueriesApi.list,
    staleTime: 60_000,
  })

  const recentSaved = useMemo(() => {
    if (!savedData?.savedQueries) return []
    return [...savedData.savedQueries]
      .filter((q) => !q.connectionId || q.connectionId === connectionId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6)
  }, [savedData, connectionId])

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Recent queries */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('overview.recentQueries')}</span>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('overview.noHistory')}</p>
        ) : (
          <ul className="space-y-1.5">
            {history.map((entry, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => openQuery(entry.sql, entry.sql.slice(0, 30) + '…')}
                  className="w-full text-left group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-raised transition-colors"
                >
                  <span className="text-[11px] font-mono text-foreground/80 truncate flex-1">{entry.sql}</span>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{entry.durationMs}ms</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent saved queries */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookMarked className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('overview.recentSaved')}</span>
        </div>
        {recentSaved.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('overview.noSaved')}</p>
        ) : (
          <ul className="space-y-1.5">
            {recentSaved.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => openQuery(q.sql, q.name, q.id)}
                  className="w-full text-left flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-raised transition-colors"
                >
                  <span className="text-xs truncate flex-1">{q.name}</span>
                  {q.folder && <span className="text-[10px] text-muted-foreground flex-shrink-0">{q.folder}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

---

## Task 7: `QuickAccessCard`

**Files:**
- Create: `src/web/src/components/overview/QuickAccessCard.tsx`

- [ ] **Étape 1 : Créer `QuickAccessCard.tsx`**

```typescript
// src/web/src/components/overview/QuickAccessCard.tsx
import { useMemo, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { savedQueriesApi } from '@/api/saved-queries'
import { useEditorStore, type TableVisitEntry } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Table2, Star, BarChart2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = { connectionId: string }

function useTableVisits(connectionId: string): TableVisitEntry[] {
  return useMemo(() => {
    try {
      const all: TableVisitEntry[] = JSON.parse(localStorage.getItem('dblumi:tvisits') ?? '[]')
      return all
        .filter((e) => e.connectionId === connectionId)
        .sort((a, b) => b.visitCount - a.visitCount)
        .slice(0, 8)
    } catch {
      return []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])
}

function usePinnedIds() {
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dblumi:pinned') ?? '[]') }
    catch { return [] }
  })
  const toggle = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try { localStorage.setItem('dblumi:pinned', JSON.stringify(next)) } catch { /* */ }
      return next
    })
  }, [])
  return { pinned, toggle }
}

export function QuickAccessCard({ connectionId }: Props) {
  const { t } = useI18n()
  const { openTable, openQuery } = useEditorStore()
  const topTables = useTableVisits(connectionId)
  const { pinned, toggle } = usePinnedIds()

  const { data: savedData } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: savedQueriesApi.list,
    staleTime: 60_000,
  })

  const pinnedQueries = useMemo(
    () => (savedData?.savedQueries ?? []).filter((q) => pinned.includes(q.id)),
    [savedData, pinned],
  )
  const allSaved = savedData?.savedQueries ?? []

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Top tables */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('overview.topTables')}</span>
        </div>
        {topTables.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('overview.noTopTables')}</p>
        ) : (
          <ul className="space-y-1.5">
            {topTables.map((entry) => (
              <li key={entry.tableName}>
                <button
                  type="button"
                  onClick={() => openTable(entry.tableName)}
                  className="w-full text-left flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-raised transition-colors"
                >
                  <Table2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs flex-1 truncate">{entry.tableName}</span>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{entry.visitCount}×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pinned queries */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Star className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('overview.pinned')}</span>
        </div>
        {pinnedQueries.length === 0 && (
          <p className="text-xs text-muted-foreground mb-3">{t('overview.noPinned')}</p>
        )}
        {pinnedQueries.length > 0 && (
          <ul className="space-y-1.5 mb-3">
            {pinnedQueries.map((q) => (
              <li key={q.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openQuery(q.sql, q.name, q.id)}
                  className="flex-1 text-left flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-raised transition-colors"
                >
                  <span className="text-xs truncate">{q.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => toggle(q.id)}
                  className="p-1 rounded hover:bg-surface-raised text-amber-400 flex-shrink-0"
                  title={t('overview.unpin')}
                >
                  <Star className="h-3 w-3 fill-current" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* All saved queries for pinning */}
        {allSaved.filter((q) => !pinned.includes(q.id)).slice(0, 4).map((q) => (
          <div key={q.id} className="flex items-center gap-1">
            <span className="flex-1 text-xs text-muted-foreground truncate px-2">{q.name}</span>
            <button
              type="button"
              onClick={() => toggle(q.id)}
              className="p-1 rounded hover:bg-surface-raised text-muted-foreground hover:text-amber-400 flex-shrink-0 transition-colors"
              title={t('overview.pin')}
            >
              <Star className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Task 8: `ErdDiagram`

**Files:**
- Create: `src/web/src/components/overview/ErdDiagram.tsx`

- [ ] **Étape 1 : Créer `ErdDiagram.tsx`**

```typescript
// src/web/src/components/overview/ErdDiagram.tsx
import { useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi, type SchemaTable } from '@/api/connections'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Table2, Eye } from 'lucide-react'

type Props = { connectionId: string }

const NODE_W = 240
const HEADER_H = 32
const COL_H = 22
const NODE_PAD = 8
const COL_GAP = 60
const ROW_GAP = 48

type LayoutNode = SchemaTable & { x: number; y: number; width: number; height: number }

function layoutNodes(tables: SchemaTable[]): LayoutNode[] {
  const COLS = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(tables.length))))
  const nodes = tables.map((table, i) => ({
    ...table,
    col: i % COLS,
    row: Math.floor(i / COLS),
    width: NODE_W,
    height: HEADER_H + table.columns.length * COL_H + NODE_PAD,
  }))
  const rowCount = Math.ceil(tables.length / COLS)
  const rowHeights = Array.from({ length: rowCount }, (_, r) =>
    Math.max(...nodes.filter((n) => n.row === r).map((n) => n.height), 80),
  )
  const rowY = rowHeights.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1]! + rowHeights[i - 1]! + ROW_GAP)
    return acc
  }, [])
  return nodes.map((n) => ({
    ...n,
    x: n.col * (NODE_W + COL_GAP),
    y: rowY[n.row]!,
  }))
}

type EdgePath = { id: string; d: string }

function buildEdges(nodes: LayoutNode[]): EdgePath[] {
  const nodeMap = new Map(nodes.map((n) => [n.name, n]))
  const edges: EdgePath[] = []

  for (const node of nodes) {
    for (const fk of node.foreignKeys ?? []) {
      const target = nodeMap.get(fk.referencedTable)
      if (!target) continue
      // Find row index of FK column in source, PK in target
      const srcColIdx = node.columns.findIndex((c) => fk.fields.includes(c.name))
      const dstColIdx = target.columns.findIndex((c) => fk.referencedFields.includes(c.name))
      const srcY = node.y + HEADER_H + (srcColIdx >= 0 ? srcColIdx : 0) * COL_H + COL_H / 2
      const dstY = target.y + HEADER_H + (dstColIdx >= 0 ? dstColIdx : 0) * COL_H + COL_H / 2
      // Decide which sides to connect
      const srcRight = node.x + NODE_W
      const dstLeft = target.x
      const srcLeft = node.x
      const dstRight = target.x + NODE_W
      let x1: number, x2: number, y1: number, y2: number
      if (Math.abs(srcRight - dstLeft) <= Math.abs(srcLeft - dstRight)) {
        x1 = srcRight; y1 = srcY; x2 = dstLeft; y2 = dstY
      } else {
        x1 = srcLeft; y1 = srcY; x2 = dstRight; y2 = dstY
      }
      const cp = Math.abs(x2 - x1) * 0.5
      const d = `M ${x1} ${y1} C ${x1 + (x1 < x2 ? cp : -cp)} ${y1} ${x2 + (x1 < x2 ? -cp : cp)} ${y2} ${x2} ${y2}`
      edges.push({ id: `${node.name}-${fk.name ?? fk.referencedTable}`, d })
    }
  }
  return edges
}

export function ErdDiagram({ connectionId }: Props) {
  const { t } = useI18n()
  const { openTable } = useEditorStore()

  const { data: schema, isLoading } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 20, y: 20, scale: 1 })
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return
    isDragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    e.preventDefault()
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    setTransform((t) => ({ ...t, scale: Math.max(0.15, Math.min(3, t.scale * factor)) }))
  }, [])

  if (isLoading) return <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">Loading…</div>

  const tables = schema?.tables ?? []
  if (tables.length === 0) return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">{t('overview.noSchema')}</div>

  const nodes = layoutNodes(tables)
  const edges = buildEdges(nodes)
  const totalW = Math.max(...nodes.map((n) => n.x + n.width)) + COL_GAP
  const totalH = Math.max(...nodes.map((n) => n.y + n.height)) + ROW_GAP

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{t('overview.erd')}</span>
        <span className="text-[10px] text-muted-foreground">{t('overview.erdHint')}</span>
      </div>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded border border-border bg-surface h-[520px] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={() => { isDragging.current = false }}
        onMouseLeave={() => { isDragging.current = false }}
        onWheel={onWheel}
      >
        <div
          style={{
            position: 'absolute',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: totalW,
            height: totalH,
          }}
        >
          {/* SVG edges layer */}
          <svg
            style={{ position: 'absolute', inset: 0, width: totalW, height: totalH, overflow: 'visible', pointerEvents: 'none' }}
          >
            <defs>
              <marker id="erd-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="rgb(var(--color-border-strong, 100 100 100))" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeOpacity={0.4}
                className="text-border-strong"
                markerEnd="url(#erd-arrow)"
              />
            ))}
          </svg>

          {/* Table nodes */}
          {nodes.map((node) => (
            <div
              key={node.name}
              data-node="true"
              style={{ position: 'absolute', left: node.x, top: node.y, width: node.width }}
              className="rounded border border-border bg-card shadow-sm overflow-hidden"
            >
              <div
                className="flex items-center gap-1.5 px-2.5 border-b border-border bg-surface-raised cursor-pointer hover:bg-surface-overlay transition-colors"
                style={{ height: HEADER_H }}
                onClick={() => openTable(node.name)}
              >
                {node.type === 'view'
                  ? <Eye className="h-3 w-3 text-violet-400 flex-shrink-0" />
                  : <Table2 className="h-3 w-3 text-blue-400 flex-shrink-0" />}
                <span className="text-[11px] font-semibold truncate">{node.name}</span>
              </div>
              {node.columns.map((col) => (
                <div
                  key={col.name}
                  className="flex items-center gap-1.5 px-2.5 border-b border-border/20 last:border-0"
                  style={{ height: COL_H }}
                >
                  {col.primaryKey && (
                    <span className="text-[9px] font-bold text-amber-400 flex-shrink-0 leading-none">PK</span>
                  )}
                  <span className="text-[10px] truncate flex-1">{col.name}</span>
                  <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 truncate max-w-[60px]">{col.dataType}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

---

## Task 9: `OverviewPage` + wiring AppShell

**Files:**
- Create: `src/web/src/components/overview/OverviewPage.tsx`
- Modify: `src/web/src/components/layout/AppShell.tsx`

- [ ] **Étape 1 : Créer `OverviewPage.tsx`**

```typescript
// src/web/src/components/overview/OverviewPage.tsx
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { StatsCards } from './StatsCards'
import { ConnectionHealthCard } from './ConnectionHealthCard'
import { ActivityCard } from './ActivityCard'
import { QuickAccessCard } from './QuickAccessCard'
import { ErdDiagram } from './ErdDiagram'

export function OverviewPage() {
  const { t } = useI18n()
  const activeConnectionId = useEditorStore((s) => s.activeConnectionId)

  if (!activeConnectionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t('overview.noConnection')}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <StatsCards connectionId={activeConnectionId} />
      <ConnectionHealthCard connectionId={activeConnectionId} />
      <ActivityCard connectionId={activeConnectionId} />
      <QuickAccessCard connectionId={activeConnectionId} />
      <ErdDiagram connectionId={activeConnectionId} />
    </div>
  )
}
```

- [ ] **Étape 2 : Brancher `OverviewPage` dans `AppShell.tsx`**

Trouver le bloc `{/* Page content */}` dans AppShell.tsx :

```typescript
// Ajouter l'import en haut du fichier
import { OverviewPage } from '@/components/overview/OverviewPage'
```

Puis remplacer le rendu du contenu principal :

```typescript
{/* Page content */}
<div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
  {page === 'admin' && user?.role === 'admin' ? (
    <AdminPage />
  ) : page === 'overview' ? (
    <OverviewPage />
  ) : (
    <TooltipProvider delayDuration={300}>
      <UnifiedEditorArea onSaveNew={() => setSaveOpen(true)} onSaveAs={() => setSaveOpen(true)} />
    </TooltipProvider>
  )}
</div>
```

- [ ] **Étape 3 : Vérifier typecheck complet**

```bash
cd /path/to/dblumi && pnpm typecheck 2>&1 | grep "error TS"
```
Attendu : 0 nouvelles erreurs (seules les erreurs préexistantes AdminPage/CopilotPanel/SqlEditor sont tolérées).

- [ ] **Étape 4 : Tester manuellement**

1. Lancer `pnpm dev` depuis la racine
2. Naviguer vers l'onglet "Project Overview" dans la nav
3. Vérifier : 4 cartes stats visibles
4. Cliquer "Latence" → badge vert avec ms
5. Exécuter une requête SQL → revenir Overview → vérifier historique
6. Ouvrir une table → revenir Overview → vérifier "Top tables"
7. Épingler une saved query → vérifier badge ★ jaune
8. Scroll bas → ERD visible avec tables et lignes FK
9. Scroll wheel sur ERD → zoom in/out
10. Drag sur ERD → navigation

---

## Self-Review

**Spec coverage:**
- ✅ Nombre de tables/vues/fonctions → `StatsCards`
- ✅ Taille de la base → `StatsCards` (via `/stats` endpoint, driver-dependent)
- ✅ Stats rapides latence → `ConnectionHealthCard` bouton test
- ✅ Dernières requêtes exécutées → `ActivityCard` (localStorage)
- ✅ Requêtes sauvegardées récentes → `ActivityCard` (API sorted by updatedAt)
- ✅ Tables les plus visitées → `QuickAccessCard` (localStorage counters)
- ✅ Requêtes sauvegardées épinglées → `QuickAccessCard` (localStorage pin toggle)
- ✅ Statut connexion + version + encodage + timezone → `ConnectionHealthCard`
- ✅ Schéma ERD → `ErdDiagram` (SVG pur, pan/zoom, FK edges)

**Placeholder scan:** Aucun TBD, TODO, ou placeholder détecté.

**Type consistency:**
- `QueryHistoryEntry` + `TableVisitEntry` exportés depuis `editor.store.ts`, importés dans les composants
- `connectionsApi.stats()` retourne `DbStats` défini dans `connections.ts`
- `connectionId` passé comme prop string dans tous les composants enfants

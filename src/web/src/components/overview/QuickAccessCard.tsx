// src/web/src/components/overview/QuickAccessCard.tsx
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi, type SchemaTable } from '@/api/connections'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Table2, Eye, Star, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { envIconClass } from '@/components/ui/driver-icon'

type Props = { connectionId: string; environment?: string | null; onNavigate: (page: 'sql-editor' | 'tables') => void }

function useTableFavs(connectionId: string) {
  const storageKey = `dblumi:table-favs:${connectionId}`
  const [favs, setFavs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') }
    catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(favs)) } catch { /* */ }
  }, [storageKey, favs])
  const toggle = useCallback((name: string) => {
    setFavs((prev) => prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name])
  }, [])
  return { favs, toggle }
}

function useVisitCounts(connectionId: string): Record<string, number> {
  return useMemo(() => {
    try {
      const all = JSON.parse(localStorage.getItem('dblumi:tvisits') ?? '[]')
      const map: Record<string, number> = {}
      for (const e of all) {
        if (e.connectionId === connectionId) map[e.tableName] = e.visitCount
      }
      return map
    } catch { return {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])
}

const PAGE_SIZE = 10

export function QuickAccessCard({ connectionId, environment, onNavigate }: Props) {
  const { t } = useI18n()
  const { openTable } = useEditorStore()
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const { favs, toggle } = useTableFavs(connectionId)
  const visits = useVisitCounts(connectionId)

  const { data: schema } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const tables = useMemo(() => {
    const all: SchemaTable[] = schema?.tables ?? []
    return all
      .map((t) => ({ ...t, visitCount: visits[t.name] ?? 0, fav: favs.includes(t.name) }))
      .filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => Number(b.fav) - Number(a.fav) || b.visitCount - a.visitCount || a.name.localeCompare(b.name))
  }, [schema, visits, favs, search])

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col min-h-[420px]">
      <div className="flex items-center gap-2 mb-3">
        <Table2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('overview.tables')}</span>
        <span className="ml-auto text-xs text-muted-foreground">{tables.length}</span>
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 pl-7 text-xs"
          placeholder={t('conn.search')}
        />
      </div>
      {tables.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2">{t('overview.noSchema')}</p>
      ) : (
        <ul className="flex-1 overflow-auto space-y-0.5">
          {(showAll ? tables : tables.slice(0, PAGE_SIZE)).map((table) => (
            <li key={table.name} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { openTable(table.name); onNavigate('sql-editor') }}
                className="flex-1 text-left flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-raised transition-colors min-w-0"
              >
                {table.type === 'view'
                  ? <Eye className={`h-3 w-3 flex-shrink-0 ${envIconClass(environment)}`} />
                  : <Table2 className={`h-3 w-3 flex-shrink-0 ${envIconClass(environment)}`} />
                }
                <span className="text-xs flex-1 truncate">{table.name}</span>
                {table.visitCount > 0 && (
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{table.visitCount}×</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => toggle(table.name)}
                className={`p-1 rounded hover:bg-surface-raised flex-shrink-0 transition-colors ${
                  table.fav ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'
                }`}
                title={table.fav ? t('overview.unpin') : t('overview.pin')}
              >
                <Star className={`h-3 w-3 ${table.fav ? 'fill-current' : ''}`} />
              </button>
            </li>
          ))}
          {!showAll && tables.length > PAGE_SIZE && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-raised rounded transition-colors"
              >
                {t('overview.showMore', { count: String(tables.length - PAGE_SIZE) })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

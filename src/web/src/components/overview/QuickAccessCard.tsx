// src/web/src/components/overview/QuickAccessCard.tsx
import { useMemo, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { savedQueriesApi } from '@/api/saved-queries'
import { useEditorStore, type TableVisitEntry } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Table2, Star, BarChart2 } from 'lucide-react'

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

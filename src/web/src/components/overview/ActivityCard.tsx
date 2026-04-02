// src/web/src/components/overview/ActivityCard.tsx
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { savedQueriesApi } from '@/api/saved-queries'
import { useEditorStore, type QueryHistoryEntry } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Clock, BookMarked } from 'lucide-react'

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

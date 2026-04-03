// src/web/src/components/overview/ActivityCard.tsx
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { savedQueriesApi } from '@/api/saved-queries'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { BookMarked, Star, Search, Share2, FileCode2 } from 'lucide-react'
import { envIconClass } from '@/components/ui/driver-icon'
import { Input } from '@/components/ui/input'

type Props = { connectionId: string; environment?: string | null; onNavigate: (page: 'sql-editor' | 'tables') => void }

function usePinnedIds(connectionId: string) {
  const storageKey = `dblumi:pinned:${connectionId}`
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') }
    catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(pinned)) } catch { /* */ }
  }, [storageKey, pinned])
  const toggle = useCallback((id: string) => {
    setPinned((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }, [])
  return { pinned, toggle }
}

const PAGE_SIZE = 10

export function ActivityCard({ connectionId, environment, onNavigate }: Props) {
  const { t } = useI18n()
  const { openQuery } = useEditorStore()
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const { pinned, toggle } = usePinnedIds(connectionId)

  const { data: savedData } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: savedQueriesApi.list,
    staleTime: 60_000,
  })

  const queries = useMemo(() => {
    const all = (savedData?.savedQueries ?? []).filter(
      (q) => !q.connectionId || q.connectionId === connectionId,
    )
    return [...all]
      .map((q) => ({ ...q, pinned: pinned.includes(q.id) }))
      .filter((q) => !search || q.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [savedData, connectionId, pinned, search])

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col min-h-[420px]">
      <div className="flex items-center gap-2 mb-3">
        <BookMarked className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('overview.queryHistory')}</span>
        <span className="ml-auto text-xs text-muted-foreground">{queries.length}</span>
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
      {queries.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2">{t('overview.noSaved')}</p>
      ) : (
        <ul className="flex-1 overflow-auto space-y-0.5">
          {(showAll ? queries : queries.slice(0, PAGE_SIZE)).map((q) => (
            <li key={q.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { openQuery(q.sql, q.name, q.id); onNavigate('sql-editor') }}
                className="flex-1 text-left flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-raised transition-colors min-w-0"
              >
                <FileCode2 className={`h-3 w-3 flex-shrink-0 ${envIconClass(environment)}`} />
                <span className="text-xs flex-1 truncate">{q.name}</span>
                {q.folder && (
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{q.folder}</span>
                )}
                {q.shared && (
                  <Share2 className="h-2.5 w-2.5 flex-shrink-0 text-muted-foreground/40" />
                )}
              </button>
              <button
                type="button"
                onClick={() => toggle(q.id)}
                className={`p-1 rounded hover:bg-surface-raised flex-shrink-0 transition-colors ${
                  q.pinned ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'
                }`}
                title={q.pinned ? t('overview.unpin') : t('overview.pin')}
              >
                <Star className={`h-3 w-3 ${q.pinned ? 'fill-current' : ''}`} />
              </button>
            </li>
          ))}
          {!showAll && queries.length > PAGE_SIZE && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-raised rounded transition-colors"
              >
                {t('overview.showMore', { count: String(queries.length - PAGE_SIZE) })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

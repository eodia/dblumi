import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { savedQueryVersionsApi, type SavedQueryVersion } from '@/api/saved-query-versions'
import { TimelineDiffView, SqlReadOnlyView } from './TimelineDiffView'
import { Button } from '@/components/ui/button'
import { Check, X, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useEditorStore } from '@/stores/editor.store'

type Props = {
  queryId: string
  queryName: string
  currentSql: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ViewState =
  | { mode: 'view'; sql: string; label: string }
  | { mode: 'vsCurrent'; versionId: string }
  | { mode: 'compare'; versionA: string; versionB: string }

export function TimelineModal({ queryId, queryName, currentSql, open, onOpenChange }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const setSql = useEditorStore((s) => s.setSql)
  const [view, setView] = useState<ViewState>({ mode: 'view', sql: currentSql, label: t('sq.timeline.current') })
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelValue, setLabelValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['saved-query-versions', queryId],
    queryFn: ({ pageParam }) => savedQueryVersionsApi.list(queryId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  })

  const versions = data?.pages.flatMap((p) => p.versions) ?? []

  const labelMutation = useMutation({
    mutationFn: ({ versionId, label }: { versionId: string; label: string | null }) =>
      savedQueryVersionsApi.updateLabel(queryId, versionId, label),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-query-versions', queryId] })
      toast.success(t('sq.timeline.labelSaved'))
    },
  })

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !hasNextPage || isFetchingNextPage) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Checkbox logic
  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= 2) return prev
        next.add(id)
      }
      return next
    })
  }

  // Checkboxes trigger comparison mode
  useEffect(() => {
    const ids = Array.from(checked)
    if (ids.length === 2) {
      setView({ mode: 'compare', versionA: ids[0]!, versionB: ids[1]! })
    } else if (ids.length === 1) {
      setView({ mode: 'vsCurrent', versionId: ids[0]! })
    }
  }, [checked])

  // Click on version row = view its SQL (no diff)
  const selectVersion = (versionId: string) => {
    if (checked.size > 0) return
    const v = versions.find((ver) => ver.id === versionId)
    if (v) setView({ mode: 'view', sql: v.sql, label: formatDate(v.createdAt) })
  }

  // Resolve SQL strings for comparison modes
  const getSqlById = (id: string) => versions.find((v) => v.id === id)?.sql ?? ''

  let original = ''
  let modified = ''
  let headerLabel = ''

  if (view.mode === 'view') {
    headerLabel = view.label
  } else if (view.mode === 'vsCurrent') {
    original = getSqlById(view.versionId)
    modified = currentSql
    headerLabel = t('sq.timeline.vsCurrent')
  } else if (view.mode === 'compare') {
    const idxA = versions.findIndex((v) => v.id === view.versionA)
    const idxB = versions.findIndex((v) => v.id === view.versionB)
    if (idxA > idxB) {
      original = getSqlById(view.versionA)
      modified = getSqlById(view.versionB)
    } else {
      original = getSqlById(view.versionB)
      modified = getSqlById(view.versionA)
    }
    headerLabel = t('sq.timeline.comparing')
  }

  // Determine which SQL can be restored
  const getRestorableSql = (): string | null => {
    if (view.mode === 'view') return view.sql !== currentSql ? view.sql : null
    if (view.mode === 'vsCurrent') return getSqlById(view.versionId) || null
    // compare mode: restore the more recent version (modified = right side)
    return modified || null
  }
  const restorableSql = getRestorableSql()

  const startEditLabel = (v: SavedQueryVersion) => {
    setEditingLabel(v.id)
    setLabelValue(v.label ?? '')
  }

  const commitLabel = () => {
    if (editingLabel) {
      labelMutation.mutate({ versionId: editingLabel, label: labelValue.trim() || null })
      setEditingLabel(null)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0 bg-card border-border-subtle overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border-subtle">
          <DialogTitle className="text-base">{t('sq.timeline')} — {queryName}</DialogTitle>
        </DialogHeader>

        <div className="flex" style={{ height: '500px' }}>
          {/* Left panel: version list */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="w-[280px] flex-shrink-0 border-r border-border-subtle overflow-y-auto"
          >
            {/* Current (editor) entry */}
            <div
              className={cn(
                'px-3 py-2.5 border-b border-border-subtle cursor-pointer transition-colors',
                view.mode === 'view' && view.sql === currentSql && 'bg-accent',
              )}
              onClick={() => { setChecked(new Set()); setView({ mode: 'view', sql: currentSql, label: t('sq.timeline.current') }) }}
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                <span className="text-xs font-semibold text-primary">{t('sq.timeline.current')}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 ml-4">{t('sq.timeline.editing')}</p>
            </div>

            {versions.length === 0 && (
              <p className="px-3 py-6 text-xs text-muted-foreground text-center">{t('sq.timeline.noVersions')}</p>
            )}

            {versions.map((v) => {
              const isSelected = view.mode === 'view' && view.sql === v.sql && view.label === formatDate(v.createdAt)
              const isChecked = checked.has(v.id)
              return (
                <div
                  key={v.id}
                  className={cn(
                    'px-3 py-2.5 border-b border-border-subtle/50 cursor-pointer transition-colors hover:bg-accent/50',
                    (isSelected || isChecked) && 'bg-accent',
                  )}
                  onClick={() => selectVersion(v.id)}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => { e.stopPropagation(); toggleCheck(v.id) }}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-primary w-3.5 h-3.5 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-foreground">{v.editedBy.name}</div>
                      <div className="text-[11px] text-muted-foreground">{formatDate(v.createdAt)}</div>
                    </div>
                  </div>

                  {/* Label */}
                  <div className="mt-1.5 ml-[22px]">
                    {editingLabel === v.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          autoFocus
                          value={labelValue}
                          onChange={(e) => setLabelValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitLabel()
                            if (e.key === 'Escape') setEditingLabel(null)
                            e.stopPropagation()
                          }}
                          className="h-5 text-[11px] px-1.5 py-0 flex-1"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button onClick={(e) => { e.stopPropagation(); commitLabel() }} className="text-primary">
                          <Check className="h-3 w-3" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingLabel(null) }} className="text-muted-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : v.label ? (
                      <span
                        className="inline-block bg-primary/10 text-primary text-[11px] px-2 py-0.5 rounded cursor-text"
                        onClick={(e) => { e.stopPropagation(); startEditLabel(v) }}
                      >
                        {v.label}
                      </span>
                    ) : (
                      <button
                        className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        onClick={(e) => { e.stopPropagation(); startEditLabel(v) }}
                      >
                        {t('sq.timeline.addLabel')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {isFetchingNextPage && (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">{t('common.loading')}</div>
            )}
          </div>

          {/* Right panel: view or diff */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{headerLabel}</span>
              {restorableSql && (
                <Button
                  size="sm"
                  className="gap-1.5 h-6 px-2.5 text-xs"
                  onClick={() => {
                    setSql(restorableSql)
                    onOpenChange(false)
                    toast.success(t('sq.timeline.restored'))
                  }}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('sq.timeline.restore')}
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              {view.mode === 'view' ? (
                <SqlReadOnlyView value={view.sql} />
              ) : (
                <TimelineDiffView original={original} modified={modified} />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

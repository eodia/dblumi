import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useI18n } from '@/i18n'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Loader2, AlertCircle, CheckCircle2, TableIcon,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, GripVertical,
  Filter, ArrowDownUp, Plus, Trash2, Copy, Download, X,
  ChevronDown, Pencil, ClipboardCopy, CalendarIcon, ListPlus,
  Upload, ScanSearch, Pin, PinOff, EyeOff, Eye, ArrowLeftRight, RefreshCcw,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { toast } from 'sonner'
import { readSSE } from '@/api/client'
import { useEditorStore, type QueryColumn, type SortBy, type SortEntry, type FilterRow } from '@/stores/editor.store'
import { SlideToConfirm } from '@/components/ui/slide-to-confirm'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'

const DEFAULT_COL_W = 180
const MIN_COL_W = 60
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500]

const FILTER_OPERATORS = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: 'LIKE', label: 'LIKE' },
  { value: 'ILIKE', label: 'ILIKE' },
  { value: 'IS NULL', label: 'IS NULL' },
  { value: 'IS NOT NULL', label: 'IS NOT NULL' },
] as const

type CellRef = { rowIdx: number; colName: string }

// ── Per-tab state that persists across tab switches ─
type TabLocalState = {
  showFilter: boolean
  showSort: boolean
  filters: FilterRow[]
  sorts: SortEntry[]
  selected: Set<number>
  colWidths: Record<string, number>
  colOrder: string[] | null
  pinnedCols: string[]
  hiddenCols: string[]
}

// Module-level map so it survives component unmount/remount
const _tabStates = new Map<string, TabLocalState>()

function defaultTabState(): TabLocalState {
  return { showFilter: false, showSort: false, filters: [], sorts: [], selected: new Set(), colWidths: {}, colOrder: null, pinnedCols: [], hiddenCols: [] }
}

// ── Pagination bar ───────────────────────────────
export function PaginationBar({
  page, totalPages, pageSize, totalRows, onPage, onPageSize, onRefresh, onExport,
}: {
  page: number; totalPages: number; pageSize: number; totalRows: number
  onPage: (p: number) => void; onPageSize: (s: number) => void; onRefresh?: () => void
  onExport?: (format: 'csv' | 'json' | 'sql') => void
}) {
  const { t } = useI18n()
  const [inputValue, setInputValue] = useState('')
  const commitInput = () => {
    const n = parseInt(inputValue, 10)
    if (!isNaN(n)) onPage(Math.max(0, Math.min(totalPages - 1, n - 1)))
    setInputValue('')
  }
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, totalRows)

  return (
    <div className="flex items-center justify-between h-9 px-3 border-t border-border-subtle bg-surface flex-shrink-0 gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] text-text-muted whitespace-nowrap hidden sm:block">{t('results.perPage')}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 w-16 px-2 text-xs justify-between">
              {pageSize === 10000 ? t('results.all') : pageSize}<ChevronRight className="h-3 w-3 rotate-90 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[4rem]">
            {PAGE_SIZE_OPTIONS.map((s) => (
              <DropdownMenuItem key={s} className={cn('text-xs', s === pageSize && 'text-primary font-medium')}
                onClick={() => { onPageSize(s); onPage(0) }}>{s}</DropdownMenuItem>
            ))}
            <DropdownMenuItem className={cn('text-xs', pageSize === 10000 && 'text-primary font-medium')}
              onClick={() => { onPageSize(10000); onPage(0) }}>{t('results.all')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="text-[11px] text-text-muted tabular-nums hidden md:flex items-center gap-1 flex-shrink-0">
        {start.toLocaleString('fr-FR')}–{end.toLocaleString('fr-FR')}
        <span className="opacity-50">/</span>
        {totalRows.toLocaleString('fr-FR')}
      </span>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-1 mr-0.5">
                <Download className="h-3.5 w-3.5" />
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-xs" onClick={() => onExport('csv')}>{t('sel.exportAsCsv')}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => onExport('json')}>{t('sel.exportAsJson')}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => onExport('sql')}>{t('sel.exportAsSql')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onRefresh && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 mr-1" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5" /></Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={page === 0} onClick={() => onPage(0)}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
        {page > 0 && <Button variant="ghost" size="sm" className="h-6 min-w-6 px-1.5 text-xs text-text-muted" onClick={() => onPage(page - 1)}>{page}</Button>}
        <Input className="h-6 w-10 text-center text-xs px-1 tabular-nums"
          value={inputValue !== '' ? inputValue : String(page + 1)}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitInput}
          onKeyDown={(e) => { if (e.key === 'Enter') { commitInput(); (e.target as HTMLInputElement).blur() }; if (e.key === 'Escape') { setInputValue(''); (e.target as HTMLInputElement).blur() } }}
          onFocus={(e) => { setInputValue(String(page + 1)); e.target.select() }}
        />
        {page < totalPages - 1 && <Button variant="ghost" size="sm" className="h-6 min-w-6 px-1.5 text-xs text-text-muted" onClick={() => onPage(page + 1)}>{page + 2}</Button>}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={page >= totalPages - 1} onClick={() => onPage(totalPages - 1)}><ChevronsRight className="h-3.5 w-3.5" /></Button>
        <span className="text-[11px] text-text-muted tabular-nums ml-1 hidden sm:block">/ {totalPages}</span>
      </div>
    </div>
  )
}

// ── Column resize handle ─────────────────────────
function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const startX = useRef(0)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    startX.current = e.clientX
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => { onResize(ev.clientX - startX.current); startX.current = ev.clientX }
    const onUp = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onUp) }
    target.addEventListener('pointermove', onMove); target.addEventListener('pointerup', onUp)
  }, [onResize])

  return <div onPointerDown={onPointerDown} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 hover:bg-primary/30 active:bg-primary/50 transition-colors" />
}

// ── Sortable column header ───────────────────────
function SortableColumnHeader({ col, width, sortBy, sortMulti, onSort, onResize, isPinned, hiddenCount, stickyLeft, onAddFilter, onPin, onHide, onFitWidth, onShowHidden }: {
  col: QueryColumn; width: number; sortBy: SortBy; sortMulti: SortEntry[]
  onSort: (e: React.MouseEvent) => void; onResize: (delta: number) => void
  isPinned: boolean; hiddenCount: number; stickyLeft?: number
  onAddFilter: () => void; onPin: () => void; onHide: () => void; onFitWidth: () => void; onShowHidden: () => void
}) {
  const { t } = useI18n()
  const hasHidden = hiddenCount > 0
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.name })
  const isSticky = stickyLeft !== undefined
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={setNodeRef}
          className={cn('relative flex items-center gap-0.5 border-r border-border-subtle flex-shrink-0 select-none', isSticky && 'bg-surface-raised border-r-primary/20')}
          style={{ width, transform: CSS.Transform.toString(transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 30 : isSticky ? 11 : undefined, position: isSticky ? 'sticky' : undefined, left: stickyLeft }}>
          <span {...attributes} {...listeners}
            className="flex items-center justify-center w-5 flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-text-muted/70 transition-colors"
            onClick={(e) => e.stopPropagation()}>
            <GripVertical className="h-3 w-3" />
          </span>
          <button type="button" onClick={onSort} className="flex items-center gap-1 min-w-0 flex-1 hover:text-foreground transition-colors">
            {isPinned && <Pin className="h-2.5 w-2.5 text-primary/60 flex-shrink-0" />}
            <span className="text-[11px] font-semibold text-muted-foreground flex-shrink-0">{col.name}</span>
            <span className="text-[10px] text-text-muted/50 font-mono truncate">{col.dataType}</span>
            {(() => {
              const sortIdx = sortMulti.findIndex((s) => s.column === col.name)
              if (sortIdx >= 0) {
                const dir = sortMulti[sortIdx]!.direction
                return (
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    {dir === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />}
                    {sortMulti.length > 1 && <span className="text-[9px] text-primary font-bold tabular-nums">{sortIdx + 1}</span>}
                  </span>
                )
              }
              return <ArrowUpDown className="h-3 w-3 text-text-muted/20 flex-shrink-0" />
            })()}
          </button>
          <ResizeHandle onResize={onResize} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem className="gap-2 text-xs" onClick={onAddFilter}>
          <Filter className="h-3.5 w-3.5" />{t('table.addFilter')}
        </ContextMenuItem>
        <ContextMenuItem className="gap-2 text-xs" onClick={onPin}>
          {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          {isPinned ? t('col.unpin') : t('col.pin')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="gap-2 text-xs" onClick={onFitWidth}>
          <ArrowLeftRight className="h-3.5 w-3.5" />{t('col.fitWidth')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="gap-2 text-xs" onClick={onHide}>
          <EyeOff className="h-3.5 w-3.5" />{t('col.hide')}
        </ContextMenuItem>
        {hasHidden && (
          <ContextMenuItem className="gap-2 text-xs" onClick={onShowHidden}>
            <Eye className="h-3.5 w-3.5" />{t('col.showHidden', { count: String(hiddenCount) })}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── Filter Panel ─────────────────────────────────
function FilterPanel({ columns, filters, setFilters, onApply, onClear }: {
  columns: QueryColumn[]; filters: FilterRow[]; setFilters: (f: FilterRow[]) => void; onApply: () => void; onClear: () => void
}) {
  const { t } = useI18n()
  const addFilter = () => setFilters([...filters, { column: columns[0]?.name ?? '', operator: '=', value: '' }])
  const removeFilter = (i: number) => setFilters(filters.filter((_, j) => j !== i))
  const updateFilter = (i: number, patch: Partial<FilterRow>) =>
    setFilters(filters.map((f, j) => j === i ? { ...f, ...patch } : f))
  const noValue = (op: string) => op === 'IS NULL' || op === 'IS NOT NULL'

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onApply() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onApply])

  return (
    <div className="px-3 py-2 border-b border-border-subtle bg-surface space-y-2">
      {filters.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 min-w-[100px] px-2 text-xs justify-between">
                {f.column}<ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-56 overflow-y-auto">
              {columns.map((col) => (
                <DropdownMenuItem key={col.name} className="text-xs" onClick={() => updateFilter(i, { column: col.name })}>{col.name}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-24 px-2 text-xs justify-between">
                {f.operator}<ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {FILTER_OPERATORS.map((op) => (
                <DropdownMenuItem key={op.value} className="text-xs" onClick={() => updateFilter(i, { operator: op.value })}>{op.label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {!noValue(f.operator) && (
            <Input value={f.value} onChange={(e) => updateFilter(i, { value: e.target.value })} placeholder={t('table.filterValue')} className="h-7 text-xs flex-1 min-w-[120px]"
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onApply() } }} />
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeFilter(i)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addFilter}><Plus className="h-3 w-3" />{t('table.addFilter')}</Button>
        <div className="flex-1" />
        {filters.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={onClear}>{t('table.removeFilters')}</Button>
        )}
        <Button size="sm" className="h-7 text-xs" onClick={onApply} title="Ctrl+Enter">{t('table.applyFilters')}</Button>
      </div>
    </div>
  )
}

// ── Sortable sort row ────────────────────────────
function SortableRow({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const handle = (
    <span {...attributes} {...listeners}
      className="cursor-grab active:cursor-grabbing text-text-muted/40 hover:text-text-muted/80 flex-shrink-0">
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  )
  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 20 : undefined }}
    >
      {children(handle)}
    </div>
  )
}

// ── Sort Panel (multi-sort with reorder) ─────────
function SortPanel({ columns, sorts, setSorts, onApply, onClear }: {
  columns: QueryColumn[]; sorts: SortEntry[]; setSorts: (s: SortEntry[]) => void; onApply: () => void; onClear: () => void
}) {
  const { t } = useI18n()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onApply() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onApply])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const ids = sorts.map((_, i) => `sort-${i}`)

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const fromIdx = ids.indexOf(String(active.id))
    const toIdx = ids.indexOf(String(over.id))
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...sorts]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved!)
    setSorts(next)
  }

  const updateSort = (i: number, patch: Partial<SortEntry>) =>
    setSorts(sorts.map((s, j) => j === i ? { ...s, ...patch } : s))
  const removeSort = (i: number) => setSorts(sorts.filter((_, j) => j !== i))
  return (
    <div className="px-3 py-2 border-b border-border-subtle bg-surface space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {sorts.map((s, i) => (
            <SortableRow key={ids[i]} id={ids[i]!}>
              {(handle) => (
                <div className="flex items-center gap-2 text-xs">
                  {handle}
                  <span className="text-text-muted flex-shrink-0">{i === 0 ? t('table.sortBy') : t('table.thenBy')}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-6 px-2 text-xs gap-1 font-semibold">
                        {s.column}<ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-56 overflow-y-auto">
                      {columns.map((col) => (
                        <DropdownMenuItem key={col.name} className="text-xs" onClick={() => updateSort(i, { column: col.name })}>
                          {col.name}
                          <span className="ml-auto text-text-muted/50 font-mono text-[10px]">{col.dataType}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="flex-1" />
                  <span className="text-text-muted flex-shrink-0">{t('table.ascending')}</span>
                  <Switch checked={s.direction === 'asc'} onCheckedChange={(asc) => updateSort(i, { direction: asc ? 'asc' : 'desc' })} className="scale-75" />
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeSort(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              {t('table.addSort')}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-56 overflow-y-auto">
            {columns.map((col) => (
              <DropdownMenuItem key={col.name} className="text-xs"
                onClick={() => setSorts([...sorts, { column: col.name, direction: 'asc' }])}>
                {col.name}
                <span className="ml-auto text-text-muted/50 font-mono text-[10px]">{col.dataType}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        {sorts.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={onClear}>{t('table.removeSorts')}</Button>
        )}
        <Button size="sm" className="h-7 text-xs" onClick={onApply} disabled={sorts.length === 0} title="Ctrl+Enter">{t('table.applySort')}</Button>
      </div>
    </div>
  )
}

// ── Clipboard / Export helpers ────────────────────
function rowsToCsv(rows: Record<string, unknown>[], columns: QueryColumn[]): string {
  const header = columns.map((c) => c.name).join(',')
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = r[c.name]; if (v === null || v === undefined) return ''
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  ).join('\n')
  return `${header}\n${body}`
}
function rowsToJson(rows: Record<string, unknown>[], columns: QueryColumn[]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c) => [c.name, r[c.name] ?? null]))), null, 2)
}
function rowsToSql(rows: Record<string, unknown>[], columns: QueryColumn[], tableName: string): string {
  return rows.map((r) => {
    const vals = columns.map((c) => { const v = r[c.name]; if (v === null || v === undefined) return 'NULL'; if (typeof v === 'number') return String(v); return `'${String(v).replace(/'/g, "''")}'` })
    return `INSERT INTO ${tableName} (${columns.map((c) => c.name).join(', ')}) VALUES (${vals.join(', ')});`
  }).join('\n')
}
function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}

// ── Type-aware field ─────────────────────────────
function isDateOnly(dt: string) {
  return dt.toLowerCase() === 'date'
}
function isDateTime(dt: string) {
  const l = dt.toLowerCase()
  return l.includes('timestamp') || l === 'timestamptz' || l === 'datetime'
}
function isDateType(dt: string) {
  return isDateOnly(dt) || isDateTime(dt)
}
function isBoolType(dt: string) {
  const l = dt.toLowerCase()
  return l === 'boolean' || l === 'bool'
}
function isNumericType(dt: string) {
  const l = dt.toLowerCase()
  return ['integer', 'int', 'int2', 'int4', 'int8', 'smallint', 'bigint', 'serial', 'float4', 'float8', 'numeric', 'decimal', 'real', 'double precision', 'double'].includes(l)
}
function isTextType(dt: string) {
  const l = dt.toLowerCase()
  return l === 'text' || l === 'clob' || l.startsWith('tinytext') || l.startsWith('mediumtext') || l.startsWith('longtext') || l.startsWith('varchar') || l.startsWith('character varying') || l.startsWith('nvarchar')
}
function isUuidType(dt: string) {
  return dt.toLowerCase() === 'uuid'
}

function TypedField({ col, value, onChange }: { col: QueryColumn; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n()
  const dt = col.dataType

  if (isBoolType(dt)) {
    const checked = value === 'true' || value === '1'
    return (
      <div className="flex items-center gap-2 h-8">
        <Switch checked={checked} onCheckedChange={(v) => onChange(v ? 'true' : 'false')} />
        <span className="text-xs text-text-muted">{checked ? 'true' : 'false'}</span>
      </div>
    )
  }

  if (isDateType(dt)) {
    let dateVal: Date | undefined
    let timeStr = '00:00:00'
    try {
      if (value) {
        dateVal = parseISO(value)
        if (isDateTime(dt) && value.includes('T')) {
          timeStr = value.split('T')[1]?.slice(0, 8) ?? '00:00:00'
        } else if (isDateTime(dt) && value.includes(' ')) {
          timeStr = value.split(' ')[1]?.slice(0, 8) ?? '00:00:00'
        }
      }
    } catch { /* ignore */ }

    const hasTime = isDateTime(dt)
    const displayFormat = hasTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy'

    return (
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn('h-8 justify-start text-xs font-normal gap-2', hasTime ? 'flex-1' : 'w-full')}>
              <CalendarIcon className="h-3.5 w-3.5 text-text-muted" />
              {dateVal ? format(dateVal, displayFormat, { locale: fr }) : <span className="text-text-muted">{t('sheet.chooseDate')}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateVal}
              onSelect={(d) => {
                if (!d) return
                if (hasTime) onChange(`${format(d, 'yyyy-MM-dd')}T${timeStr}:00`)
                else onChange(format(d, 'yyyy-MM-dd'))
              }}
              locale={fr}
            />
          </PopoverContent>
        </Popover>
        {hasTime && (
          <Input
            type="time"
            step="1"
            value={timeStr}
            onChange={(e) => {
              const t = e.target.value || '00:00:00'
              const datePart = dateVal ? format(dateVal, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
              onChange(`${datePart}T${t}`)
            }}
            className="h-8 w-28 text-xs appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
          />
        )}
      </div>
    )
  }

  if (isUuidType(dt)) {
    return (
      <div className="flex items-center gap-1.5">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="NULL" className="h-8 text-xs font-mono flex-1" />
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0 text-text-muted hover:text-foreground" onClick={() => onChange(crypto.randomUUID())} title="Générer un UUID">
          <RefreshCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  if (isNumericType(dt)) {
    return <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder="NULL" className="h-8 text-xs" />
  }

  if (isTextType(dt)) {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="NULL" rows={4} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
  }

  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="NULL" className="h-8 text-xs" />
}

// ── Record Sheet (insert / edit) ─────────────────
function RecordSheet({ open, mode, editRow, onClose, columns }: {
  open: boolean
  mode: 'row' | 'column' | 'csv' | 'edit'
  editRow?: Record<string, unknown>
  onClose: () => void
  columns: QueryColumn[]
}) {
  const { t } = useI18n()
  const initialValues = useMemo(() => {
    if (mode === 'edit' && editRow) {
      return Object.fromEntries(columns.map((c) => [c.name, editRow[c.name] === null || editRow[c.name] === undefined ? '' : String(editRow[c.name])]))
    }
    if (mode === 'row') {
      return Object.fromEntries(columns.filter((c) => isUuidType(c.dataType)).map((c) => [c.name, crypto.randomUUID()]))
    }
    return {}
  }, [mode, editRow, columns])

  const [rowValues, setRowValues] = useState<Record<string, string>>(initialValues)
  const [colName, setColName] = useState('')
  const [colType, setColType] = useState('text')
  const [csvText, setCsvText] = useState('')
  const { tabs, activeTabId, activeConnectionId, executeQuery } = useEditorStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  const tableName = tab?.kind === 'table' ? tab.name : ''

  const reloadTable = async () => {
    useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
    await executeQuery(true)
  }

  const handleInsertRow = async () => {
    if (!activeConnectionId || !tableName) return
    const cols = Object.keys(rowValues).filter((k) => rowValues[k] !== '')
    if (cols.length === 0) return
    const vals = cols.map((k) => { const v = rowValues[k]; return v === 'NULL' ? 'NULL' : `'${v!.replace(/'/g, "''")}'` })
    useEditorStore.getState().setSql(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${vals.join(', ')})`)
    await executeQuery(true)
    await reloadTable()
    setRowValues({}); onClose()
  }

  const handleUpdateRow = async () => {
    if (!activeConnectionId || !tableName || !editRow) return
    const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]
    if (!pkCol) return
    const pkVal = editRow[pkCol.name]
    const pkLit = typeof pkVal === 'number' ? String(pkVal) : `'${String(pkVal).replace(/'/g, "''")}'`
    const sets = columns
      .filter((c) => c.name !== pkCol.name)
      .map((c) => {
        const v = rowValues[c.name]
        if (v === undefined || v === '') return `${c.name} = NULL`
        return `${c.name} = '${v.replace(/'/g, "''")}'`
      })
    useEditorStore.getState().setSql(`UPDATE ${tableName} SET ${sets.join(', ')} WHERE ${pkCol.name} = ${pkLit}`)
    await executeQuery(true)
    await reloadTable()
    onClose()
  }

  const handleAddColumn = async () => {
    if (!activeConnectionId || !tableName || !colName.trim()) return
    useEditorStore.getState().setSql(`ALTER TABLE ${tableName} ADD COLUMN ${colName.trim()} ${colType}`)
    await executeQuery(true)
    await reloadTable()
    setColName(''); onClose()
  }

  const handleImportCsv = async () => {
    if (!activeConnectionId || !tableName || !csvText.trim()) return
    const lines = csvText.trim().split('\n'); if (lines.length < 2) return
    const headers = lines[0]!.split(',').map((h) => h.trim())
    for (const line of lines.slice(1)) {
      const vals = line.split(',').map((v) => { const t = v.trim(); return t === '' || t.toUpperCase() === 'NULL' ? 'NULL' : `'${t.replace(/'/g, "''")}'` })
      useEditorStore.getState().setSql(`INSERT INTO ${tableName} (${headers.join(', ')}) VALUES (${vals.join(', ')})`)
      await executeQuery(true)
    }
    await reloadTable()
    setCsvText(''); onClose()
  }

  const titles: Record<string, string> = { row: t('sheet.newRow'), column: t('sheet.newColumn'), csv: t('sheet.importCsv'), edit: t('sheet.editRecord') }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md bg-card flex flex-col overflow-hidden">
        <SheetHeader><SheetTitle>{titles[mode]}</SheetTitle></SheetHeader>
        <div className="mt-4 flex-1 overflow-y-auto px-3 space-y-3">
          {(mode === 'row' || mode === 'edit') && (
            <div className="space-y-3">
              {columns.map((col) => (
                <div key={col.name} className="space-y-1">
                  <Label className="text-xs">{col.name} <span className="text-text-muted/50 font-mono">{col.dataType}</span></Label>
                  <TypedField col={col} value={rowValues[col.name] ?? ''} onChange={(v) => setRowValues((p) => ({ ...p, [col.name]: v }))} />
                </div>
              ))}
            </div>
          )}
          {mode === 'column' && (
            <div className="space-y-2">
              <div className="space-y-1"><Label className="text-xs">{t('sheet.columnName')}</Label><Input value={colName} onChange={(e) => setColName(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t('sheet.columnType')}</Label><Input value={colType} onChange={(e) => setColType(e.target.value)} placeholder="text" className="h-8 text-xs" /></div>
            </div>
          )}
          {mode === 'csv' && (
            <div className="space-y-1">
              <Label className="text-xs">{t('sheet.csvHint')}</Label>
              <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)}
                placeholder={"name,email,age\nAlice,alice@example.com,30\nBob,bob@example.com,25"}
                className="w-full h-40 rounded-md border border-border-subtle bg-surface-overlay p-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          )}
        </div>
        <SheetFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('sheet.cancel')}</Button>
          {mode === 'row' && <Button size="sm" onClick={handleInsertRow}>{t('sheet.insertRow')}</Button>}
          {mode === 'edit' && <Button size="sm" onClick={handleUpdateRow}>{t('sheet.save')}</Button>}
          {mode === 'column' && <Button size="sm" onClick={handleAddColumn} disabled={!colName.trim()}>{t('sheet.addColumn')}</Button>}
          {mode === 'csv' && <Button size="sm" onClick={handleImportCsv} disabled={!csvText.trim()}>{t('sheet.import')}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Main component ───────────────────────────────
export function ResultsTable() {
  const { t } = useI18n()
  const { tabs, activeTabId, activeConnectionId, goToPage, setResultPageSize, reloadTab, sortByColumn, sortByMulti, executeQuery, executeSql, pendingCsvImport, setPendingCsvImport, setTabFilters } = useEditorStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  const result = tab?.result
  const isTableMode = tab?.kind === 'table'
  const tableName = isTableMode ? tab.name : ''
  const { status, columns, rows, rowCount, totalCount, page, pageSize, durationMs, error, sortBy } =
    result ?? { status: 'idle' as const, columns: [], rows: [], rowCount: 0, totalCount: null, page: 0, pageSize: 100, durationMs: 0, error: null, guardrail: null, sortBy: null, sortMulti: [] }

  const total = totalCount ?? rowCount
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // ── Per-tab persistent local state ──────
  const getTabState = (): TabLocalState => {
    if (!activeTabId) return defaultTabState()
    if (!_tabStates.has(activeTabId)) {
      // Seed from persisted store data on first access
      _tabStates.set(activeTabId, {
        ...defaultTabState(),
        filters: tab?.filters ?? [],
        sorts: result?.sortMulti ?? [],
      })
    }
    return _tabStates.get(activeTabId)!
  }
  const setTabState = (patch: Partial<TabLocalState>) => {
    const cur = getTabState()
    _tabStates.set(activeTabId, { ...cur, ...patch })
    // Force re-render
    setRenderKey((k) => k + 1)
  }
  const [, setRenderKey] = useState(0)

  const ts = getTabState()
  const { showFilter, showSort, filters, sorts, selected, colWidths, colOrder, pinnedCols, hiddenCols } = ts

  // Sync store sortMulti → local sorts (when header clicks change sortMulti)
  const storeSortMulti = result?.sortMulti ?? []
  const prevSortMultiRef = useRef(storeSortMulti)
  if (storeSortMulti !== prevSortMultiRef.current && JSON.stringify(storeSortMulti) !== JSON.stringify(sorts)) {
    prevSortMultiRef.current = storeSortMulti
    setTabState({ sorts: storeSortMulti })
  }

  const getColWidth = (name: string) => colWidths[name] ?? DEFAULT_COL_W
  const handleResize = useCallback((colName: string, delta: number) => {
    setTabState({ colWidths: { ...getTabState().colWidths, [colName]: Math.max(MIN_COL_W, (getTabState().colWidths[colName] ?? DEFAULT_COL_W) + delta) } })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  const fitColWidth = useCallback((colName: string) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = '12px monospace'
    const col = columns.find((c) => c.name === colName)
    let maxW = ctx.measureText((col?.name ?? colName) + '  ' + (col?.dataType ?? '')).width + 56
    for (const row of rows) {
      const val = row[colName]
      const str = val === null ? 'NULL' : val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
      maxW = Math.max(maxW, ctx.measureText(str).width + 24)
    }
    setTabState({ colWidths: { ...getTabState().colWidths, [colName]: Math.max(MIN_COL_W, Math.min(600, Math.ceil(maxW))) } })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rows, activeTabId])

  const togglePin = useCallback((colName: string) => {
    const ts = getTabState()
    const next = ts.pinnedCols.includes(colName)
      ? ts.pinnedCols.filter((c) => c !== colName)
      : [...ts.pinnedCols, colName]
    setTabState({ pinnedCols: next })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  const hideCol = useCallback((colName: string) => {
    const ts = getTabState()
    setTabState({ hiddenCols: [...ts.hiddenCols, colName], pinnedCols: ts.pinnedCols.filter((c) => c !== colName) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  const baseColumns = colOrder
    ? colOrder.map((name) => columns.find((c) => c.name === name)).filter(Boolean) as QueryColumn[]
    : columns
  const visibleColumns = baseColumns.filter((c) => !hiddenCols.includes(c.name))
  const orderedColumns = [
    ...visibleColumns.filter((c) => pinnedCols.includes(c.name)),
    ...visibleColumns.filter((c) => !pinnedCols.includes(c.name)),
  ]

  // Reset colOrder when columns change
  const colKey = columns.map((c) => c.name).join(',')
  const prevColKey = useRef(colKey)
  if (colKey !== prevColKey.current) { prevColKey.current = colKey; if (colOrder) setTabState({ colOrder: null }) }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e; if (!over || active.id === over.id) return
    const current = getTabState().colOrder ?? columns.map((c) => c.name)
    const fromIdx = current.indexOf(String(active.id)); const toIdx = current.indexOf(String(over.id))
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...current]; const [moved] = next.splice(fromIdx, 1); next.splice(toIdx, 0, moved!)
    setTabState({ colOrder: next })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, columns])

  const allSelected = rows.length > 0 && selected.size === rows.length
  const someSelected = selected.size > 0
  const toggleRow = useCallback((i: number) => {
    const s = new Set(getTabState().selected); s.has(i) ? s.delete(i) : s.add(i); setTabState({ selected: s })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])
  const toggleAll = useCallback(() => {
    setTabState({ selected: allSelected ? new Set() : new Set(rows.map((_, i) => i)) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, allSelected, rows])

  // Reset selection on data change
  const rowsRef = useRef(rows)
  if (rows !== rowsRef.current) { rowsRef.current = rows; if (selected.size > 0) setTabState({ selected: new Set() }) }

  const [sheetState, setSheetState] = useState<{ mode: 'row' | 'column' | 'csv' | 'edit'; editRow?: Record<string, unknown> } | null>(null)

  useEffect(() => {
    if (pendingCsvImport && pendingCsvImport === tableName) {
      setSheetState({ mode: 'csv' })
      setPendingCsvImport(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCsvImport, tableName])

  // ── Inline cell editing ─────────────────
  const [editingCell, setEditingCell] = useState<CellRef | null>(null)
  const [editValue, setEditValue] = useState('')
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set()) // "rowIdx:colName"
  const cellKey = (r: number, c: string) => `${r}:${c}`
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<Record<string, unknown> | null>(null)
  const [deleteMultiConfirm, setDeleteMultiConfirm] = useState<{ count: number; action: () => Promise<void> } | null>(null)
  const [ctxCell, setCtxCell] = useState<{ row: Record<string, unknown>; colName: string } | null>(null)

  // ── Apply filter → build WHERE ──────────
  const startEditing = useCallback((rowIdx: number, colName: string) => {
    if (!isTableMode) return
    const val = rows[rowIdx]?.[colName]
    setEditingCell({ rowIdx, colName })
    setEditValue(val === null ? '' : val === undefined ? '' : String(val))
  }, [isTableMode, rows])

  const commitEdit = useCallback(async () => {
    if (!editingCell || !tableName || !activeConnectionId) return
    const { rowIdx, colName } = editingCell
    const row = rows[rowIdx]
    if (!row) return

    // Check if value actually changed
    const oldVal = row[colName]
    const oldStr = oldVal === null ? '' : oldVal === undefined ? '' : String(oldVal)
    if (editValue === oldStr) {
      setEditingCell(null)
      return
    }

    const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]
    if (!pkCol) return
    const newVal = editValue === '' ? 'NULL' : `'${editValue.replace(/'/g, "''")}'`

    // Collect all rows to update: the edited cell + all selected cells
    const rowIndicesToUpdate = new Set([rowIdx])
    for (const key of selectedCells) {
      const [ri] = key.split(':')
      rowIndicesToUpdate.add(parseInt(ri!, 10))
    }

    for (const ri of rowIndicesToUpdate) {
      const r = rows[ri]
      if (!r) continue
      // For the edited cell's column, apply new value; for other columns in selected cells, also apply
      const colsForRow = ri === rowIdx
        ? [colName]
        : Array.from(selectedCells).filter((k) => k.startsWith(`${ri}:`)).map((k) => k.split(':')[1]!)
      for (const cn of colsForRow) {
        const pk = r[pkCol.name]
        const pl = typeof pk === 'number' ? String(pk) : `'${String(pk).replace(/'/g, "''")}'`
        const sql = `UPDATE ${tableName} SET ${cn} = ${newVal} WHERE ${pkCol.name} = ${pl}`
        for await (const { event, data } of readSSE('/query', { connectionId: activeConnectionId, sql, limit: 1, force: true })) {
          if (event === 'error') {
            const d = data as { message: string; detail?: string }
            const msg = d.message || 'Query execution failed'
            const full = d.detail ? `${msg}\n${d.detail}` : msg
            toast.error(msg, { description: d.detail, duration: Infinity, action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(full) } })
          } else if (event === '__http') {
            const resp = data as { status: number; body: Record<string, unknown> }
            const msg = (resp.body['message'] ?? resp.body['title'] ?? 'Unknown error') as string
            toast.error(msg, { duration: Infinity, action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(msg) } })
          }
        }
      }
    }

    setEditingCell(null)
    setSelectedCells(new Set())
    await reloadTab()
  }, [editingCell, editValue, tableName, activeConnectionId, rows, columns, selectedCells, reloadTab])

  const cancelEdit = useCallback(() => {
    setEditingCell(null)
  }, [])

  const setNullSelectedCells = useCallback(async () => {
    if (!isTableMode || !tableName || !activeConnectionId || selectedCells.size === 0 || editingCell) return
    const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]
    if (!pkCol) return

    for (const key of selectedCells) {
      const [riStr, colName] = key.split(':')
      if (!riStr || !colName) continue
      const row = rows[parseInt(riStr, 10)]
      if (!row) continue
      const pk = row[pkCol.name]
      const pl = typeof pk === 'number' ? String(pk) : `'${String(pk).replace(/'/g, "''")}'`
      const sql = `UPDATE ${tableName} SET ${colName} = NULL WHERE ${pkCol.name} = ${pl}`
      for await (const { event, data } of readSSE('/query', { connectionId: activeConnectionId, sql, limit: 1, force: true })) {
        if (event === 'error') {
          const d = data as { message: string; detail?: string }
          const msg = d.message || 'Query execution failed'
          const full = d.detail ? `${msg}\n${d.detail}` : msg
          toast.error(msg, { description: d.detail, duration: Infinity, action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(full) } })
        } else if (event === '__http') {
          const resp = data as { status: number; body: Record<string, unknown> }
          const msg = (resp.body['message'] ?? resp.body['title'] ?? 'Unknown error') as string
          toast.error(msg, { duration: Infinity, action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(msg) } })
        }
      }
    }

    setSelectedCells(new Set())
    await reloadTab()
  }, [isTableMode, tableName, activeConnectionId, selectedCells, editingCell, columns, rows, reloadTab])

  const pasteToSelectedCells = useCallback(async (value: string) => {
    if (!isTableMode || !tableName || !activeConnectionId || selectedCells.size === 0 || editingCell) return
    const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]
    if (!pkCol) return
    const newVal = value === '' ? 'NULL' : `'${value.replace(/'/g, "''")}'`
    for (const key of selectedCells) {
      const [riStr, colName] = key.split(':')
      if (!riStr || !colName) continue
      const row = rows[parseInt(riStr, 10)]
      if (!row) continue
      const pk = row[pkCol.name]
      const pl = typeof pk === 'number' ? String(pk) : `'${String(pk).replace(/'/g, "''")}'`
      const sql = `UPDATE ${tableName} SET ${colName} = ${newVal} WHERE ${pkCol.name} = ${pl}`
      for await (const { event, data } of readSSE('/query', { connectionId: activeConnectionId, sql, limit: 1, force: true })) {
        if (event === 'error') {
          const d = data as { message: string; detail?: string }
          const msg = d.message || 'Query execution failed'
          const full = d.detail ? `${msg}\n${d.detail}` : msg
          toast.error(msg, { description: d.detail, duration: Infinity, action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(full) } })
        } else if (event === '__http') {
          const resp = data as { status: number; body: Record<string, unknown> }
          const msg = (resp.body['message'] ?? resp.body['title'] ?? 'Unknown error') as string
          toast.error(msg, { duration: Infinity, action: { label: 'Copy', onClick: () => navigator.clipboard.writeText(msg) } })
        }
      }
    }
    setSelectedCells(new Set())
    await reloadTab()
  }, [isTableMode, tableName, activeConnectionId, selectedCells, editingCell, columns, rows, reloadTab])

  const anchorCellRef = useRef<CellRef | null>(null)
  const cursorCellRef = useRef<CellRef | null>(null)
  const isDraggingRef = useRef(false)

  const selectRect = useCallback((anchor: CellRef, rowIdx: number, colName: string) => {
    const colNames = orderedColumns.map((c) => c.name)
    const colIdx1 = colNames.indexOf(anchor.colName)
    const colIdx2 = colNames.indexOf(colName)
    const minRow = Math.min(anchor.rowIdx, rowIdx)
    const maxRow = Math.max(anchor.rowIdx, rowIdx)
    const minCol = Math.min(colIdx1, colIdx2)
    const maxCol = Math.max(colIdx1, colIdx2)
    const next = new Set<string>()
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        next.add(cellKey(r, colNames[c]!))
      }
    }
    return next
  }, [orderedColumns])

  useEffect(() => {
    const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']
    const handler = (e: KeyboardEvent) => {
      if (editingCell) return

      // Ctrl+A: select all cells
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (orderedColumns.length === 0 || rows.length === 0) return
        e.preventDefault()
        const firstCol = orderedColumns[0]!.name
        const lastCol = orderedColumns[orderedColumns.length - 1]!.name
        anchorCellRef.current = { rowIdx: 0, colName: firstCol }
        cursorCellRef.current = { rowIdx: rows.length - 1, colName: lastCol }
        setSelectedCells(selectRect({ rowIdx: 0, colName: firstCol }, rows.length - 1, lastCol))
        return
      }

      if (isTableMode && e.key === 'Delete' && selectedCells.size > 0) {
        e.preventDefault()
        void setNullSelectedCells()
        return
      }

      // Ctrl+C: copy selected cells as TSV grid
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedCells.size > 0) {
        e.preventDefault()
        const colNames = orderedColumns.map((c) => c.name)
        const cellEntries = [...selectedCells].map((key) => {
          const sep = key.indexOf(':')
          return { rowIdx: parseInt(key.slice(0, sep), 10), colName: key.slice(sep + 1) }
        })
        const rowIdxs = [...new Set(cellEntries.map((c) => c.rowIdx))].sort((a, b) => a - b)
        const colSet = new Set(cellEntries.map((c) => c.colName))
        const colIdxs = colNames.map((_, i) => i).filter((i) => colSet.has(colNames[i]!))
        const text = rowIdxs.map((r) =>
          colIdxs.map((ci) => {
            const val = rows[r]?.[colNames[ci]!]
            return val === null || val === undefined ? '' : String(val)
          }).join('\t')
        ).join('\n')
        void navigator.clipboard.writeText(text)
        return
      }

      // Ctrl+V: paste clipboard value to selected cells (table mode only)
      if (isTableMode && (e.ctrlKey || e.metaKey) && e.key === 'v' && selectedCells.size > 0) {
        e.preventDefault()
        void navigator.clipboard.readText().then(pasteToSelectedCells)
        return
      }

      if (selectedCells.size === 0 && !anchorCellRef.current) return

      if (!NAV_KEYS.includes(e.key)) return

      const anchor = anchorCellRef.current
      if (!anchor) return

      const colNames = orderedColumns.map((c) => c.name)
      const maxRow = rows.length - 1
      const maxCol = colNames.length - 1

      // With Shift: move cursor from its current position, keep anchor fixed
      // Without Shift: move both anchor and cursor together
      const from = e.shiftKey ? (cursorCellRef.current ?? anchor) : anchor
      const fromColIdx = colNames.indexOf(from.colName)
      if (fromColIdx < 0) return

      let newRow = from.rowIdx
      let newColIdx = fromColIdx

      e.preventDefault()
      switch (e.key) {
        case 'ArrowUp':    newRow = Math.max(0, newRow - 1); break
        case 'ArrowDown':  newRow = Math.min(maxRow, newRow + 1); break
        case 'ArrowLeft':  newColIdx = Math.max(0, newColIdx - 1); break
        case 'ArrowRight': newColIdx = Math.min(maxCol, newColIdx + 1); break
        case 'Home':  newColIdx = 0; if (e.ctrlKey) newRow = 0; break
        case 'End':   newColIdx = maxCol; if (e.ctrlKey) newRow = maxRow; break
        case 'PageUp':   newRow = Math.max(0, newRow - pageSize); break
        case 'PageDown': newRow = Math.min(maxRow, newRow + pageSize); break
      }

      const newColName = colNames[newColIdx]!
      cursorCellRef.current = { rowIdx: newRow, colName: newColName }

      if (e.shiftKey) {
        setSelectedCells(selectRect(anchor, newRow, newColName))
      } else {
        anchorCellRef.current = { rowIdx: newRow, colName: newColName }
        setSelectedCells(new Set([cellKey(newRow, newColName)]))
      }

      requestAnimationFrame(() => {
        document.querySelector(`[data-cell-key="${newRow}:${newColName}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTableMode, editingCell, rows, orderedColumns, pageSize, selectedCells, setNullSelectedCells, pasteToSelectedCells])

  const handleCellMouseDown = useCallback((rowIdx: number, colName: string, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    isDraggingRef.current = true

    if (e.shiftKey && anchorCellRef.current) {
      setSelectedCells(selectRect(anchorCellRef.current, rowIdx, colName))
    } else if (e.ctrlKey || e.metaKey) {
      anchorCellRef.current = { rowIdx, colName }
      const key = cellKey(rowIdx, colName)
      setSelectedCells((prev) => {
        const next = new Set(prev)
        next.has(key) ? next.delete(key) : next.add(key)
        return next
      })
    } else {
      anchorCellRef.current = { rowIdx, colName }
      cursorCellRef.current = { rowIdx, colName }
      setSelectedCells(new Set([cellKey(rowIdx, colName)]))
    }
  }, [selectRect])

  const handleCellMouseEnter = useCallback((rowIdx: number, colName: string) => {
    if (!isDraggingRef.current || !anchorCellRef.current) return
    setSelectedCells(selectRect(anchorCellRef.current, rowIdx, colName))
  }, [selectRect])


  const handleApplyFilter = useCallback(() => {
    if (!tableName) return
    const valid = filters.filter((f) => f.column && f.operator)
    let sql = `SELECT * FROM ${tableName}`
    if (valid.length > 0) {
      const clauses = valid.map((f) => {
        if (f.operator === 'IS NULL') return `${f.column} IS NULL`
        if (f.operator === 'IS NOT NULL') return `${f.column} IS NOT NULL`
        return `${f.column} ${f.operator} '${f.value.replace(/'/g, "''")}'`
      })
      sql += ` WHERE ${clauses.join(' AND ')}`
    }
    setTabFilters(filters)
    useEditorStore.getState().setSql(sql)
    void executeQuery(true)
    setTabState({ showFilter: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, tableName, executeQuery, activeTabId, setTabFilters])

  // ── Apply multi-sort ────────────────────
  const handleApplySort = useCallback(() => {
    if (sorts.length === 0) return
    void sortByMulti(sorts)
    setTabState({ showSort: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorts, sortByMulti, activeTabId])

  // ── Selection actions ───────────────────
  const selectedRows = useMemo(() => Array.from(selected).map((i) => rows[i]!), [selected, rows])
  const handleDeleteSelected = useCallback(async () => {
    if (!tableName || selectedRows.length === 0) return
    const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]; if (!pkCol) return
    const ids = selectedRows.map((r) => { const v = r[pkCol.name]; return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'` })
    useEditorStore.getState().setSql(`DELETE FROM ${tableName} WHERE ${pkCol.name} IN (${ids.join(', ')})`)
    await executeQuery(true)
    useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`); await executeQuery(true)
    setTabState({ selected: new Set() })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, selectedRows, columns, executeQuery, activeTabId])

  const handleCopy = useCallback((fmt: 'csv' | 'json' | 'sql') => {
    const data = selectedRows.length > 0 ? selectedRows : rows
    const text = fmt === 'csv' ? rowsToCsv(data, orderedColumns) : fmt === 'json' ? rowsToJson(data, orderedColumns) : rowsToSql(data, orderedColumns, tableName || 'table')
    navigator.clipboard.writeText(text)
  }, [selectedRows, rows, orderedColumns, tableName])

  const handleExport = useCallback((fmt: 'csv' | 'json' | 'sql') => {
    const data = selectedRows.length > 0 ? selectedRows : rows; const name = tableName || 'export'
    if (fmt === 'csv') downloadBlob(rowsToCsv(data, orderedColumns), `${name}.csv`, 'text/csv')
    else if (fmt === 'json') downloadBlob(rowsToJson(data, orderedColumns), `${name}.json`, 'application/json')
    else downloadBlob(rowsToSql(data, orderedColumns, name), `${name}.sql`, 'text/sql')
  }, [selectedRows, rows, orderedColumns, tableName])

  const checkboxColW = isTableMode ? 36 : 48
  const totalWidth = checkboxColW + orderedColumns.reduce((sum, col) => sum + getColWidth(col.name), 0)

  // Sticky left offsets for pinned columns (header + cells)
  const pinnedLeftOffsets = (() => {
    const offsets: Record<string, number> = {}
    let left = checkboxColW
    for (const col of orderedColumns) {
      if (pinnedCols.includes(col.name)) { offsets[col.name] = left; left += getColWidth(col.name) }
    }
    return offsets
  })()

  // ── Empty / loading / error states ──────
  if (status === 'idle' && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted bg-background">
        <TableIcon className="h-8 w-8 opacity-20" /><span className="text-xs">{t('editor.resultsHere')}</span>
        <span className="text-[11px] text-text-muted/60">{t('editor.ctrlEnter')}</span>
      </div>
    )
  }
  if (status === 'running' && rows.length === 0) {
    return (<div className="flex items-center justify-center h-full gap-2 text-muted-foreground bg-background"><Loader2 className="h-4 w-4 animate-spin text-primary" /><span className="text-xs">{t('editor.running')}</span></div>)
  }
  if (status === 'error') {
    return (<div className="flex items-center justify-center h-full gap-2 px-6 bg-background"><AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" /><span className="text-xs text-destructive">{error ?? t('results.error')}</span></div>)
  }

  // INSERT / UPDATE / DELETE success — no columns/rows returned
  if (status === 'done' && columns.length === 0 && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 bg-background">
        <CheckCircle2 className="h-8 w-8 text-success opacity-40" />
        <span className="text-sm text-muted-foreground">
          {t('results.success')}
        </span>
        <span className="text-xs text-text-muted tabular-nums">
          {rowCount} {rowCount !== 1 ? t('results.affected_plural') : t('results.affected')} · {durationMs} ms
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Status / Action bar */}
      <div className="flex items-center gap-2 h-8 px-3 border-b border-border-subtle bg-surface flex-shrink-0">
        {isTableMode && someSelected ? (<>
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDeleteMultiConfirm({ count: selected.size, action: handleDeleteSelected })}>
            <Trash2 className="h-3 w-3" />{t('sel.delete')} {selected.size} {selected.size !== 1 ? t('sel.deleteLines') : t('sel.deleteLine')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-6 text-xs gap-1"><Copy className="h-3 w-3" />{t('sel.copy')}<ChevronDown className="h-3 w-3 opacity-50" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem className="text-xs" onClick={() => handleCopy('csv')}>{t('sel.copyAsCsv')}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleCopy('json')}>{t('sel.copyAsJson')}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleCopy('sql')}>{t('sel.copyAsSql')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-6 text-xs gap-1"><Download className="h-3 w-3" />{t('sel.export')}<ChevronDown className="h-3 w-3 opacity-50" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem className="text-xs" onClick={() => handleExport('csv')}>{t('sel.exportAsCsv')}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleExport('json')}>{t('sel.exportAsJson')}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleExport('sql')}>{t('sel.exportAsSql')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>) : (<>
          {status === 'done' && (<>
            <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground tabular-nums">{(totalCount ?? rowCount).toLocaleString('fr-FR')} {(totalCount ?? rowCount) !== 1 ? t('results.lines_plural') : t('results.lines')}</span>
            <span className="text-[11px] text-text-muted tabular-nums">{durationMs} ms</span>
          </>)}
          {status === 'running' && (<div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /><span className="tabular-nums">{rows.length} {t('editor.rowsReceived')}</span></div>)}
          {status === 'done' && (
            <div className="ml-auto flex items-center gap-1">
              {hiddenCols.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground">
                      <Eye className="h-3 w-3" />{t('col.showHidden', { count: String(hiddenCols.length) })}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {columns.filter((c) => hiddenCols.includes(c.name)).map((c) => (
                      <DropdownMenuItem key={c.name} className="gap-2 text-xs"
                        onClick={() => setTabState({ hiddenCols: getTabState().hiddenCols.filter((h) => h !== c.name) })}>
                        <Eye className="h-3.5 w-3.5" />{c.name}
                      </DropdownMenuItem>
                    ))}
                    {hiddenCols.length > 1 && (<>
                      <div className="h-px bg-border mx-1 my-1" />
                      <DropdownMenuItem className="gap-2 text-xs text-muted-foreground"
                        onClick={() => setTabState({ hiddenCols: [] })}>
                        <Eye className="h-3.5 w-3.5" />{t('col.showAll')}
                      </DropdownMenuItem>
                    </>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {isTableMode && (
                <Button variant={showFilter ? 'default' : 'ghost'} size="sm" className="h-6 text-xs gap-1"
                  onClick={() => setTabState({ showFilter: !showFilter, showSort: false })}>
                  <Filter className="h-3 w-3" />{t('table.filter')}
                  {filters.length > 0 && <span className="ml-0.5 bg-primary/20 text-primary rounded px-1 text-[10px]">{filters.length}</span>}
                </Button>
              )}
              <Button variant={showSort ? 'default' : 'ghost'} size="sm" className="h-6 text-xs gap-1"
                onClick={() => setTabState({ showSort: !showSort, showFilter: false })}>
                <ArrowDownUp className="h-3 w-3" />{t('table.sort')}
                {sorts.length > 0 && <span className="ml-0.5 bg-primary/20 text-primary rounded px-1 text-[10px]">{sorts.length}</span>}
              </Button>
              {(() => {
                const isExplaining = /^EXPLAIN\s/i.test(result?.executedSql?.trim() ?? '')
                return (
                  <Button
                    variant={isExplaining ? 'default' : 'ghost'}
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => {
                      if (isExplaining) {
                        const original = result!.executedSql!.trim().replace(/^EXPLAIN\s+/i, '')
                        if (original) void executeSql(original)
                      } else {
                        const raw = result?.executedSql ?? tab?.sql
                        const sql = raw?.trim()
                        if (sql) void executeSql(`EXPLAIN ${sql}`)
                      }
                    }}
                  >
                    <ScanSearch className="h-3 w-3" />{t('results.explain')}
                  </Button>
                )
              })()}
              {isTableMode && (<>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1"><Plus className="h-3 w-3" />{t('table.insert')}<ChevronDown className="h-3 w-3 opacity-50" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem className="text-xs gap-2" onClick={() => setSheetState({ mode: 'row' })}><ListPlus className="h-3.5 w-3.5" />{t('table.insertRow')}</DropdownMenuItem>
                    <DropdownMenuItem className="text-xs gap-2" onClick={() => setSheetState({ mode: 'csv' })}><Upload className="h-3.5 w-3.5" />{t('table.importCsv')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>)}
            </div>
          )}
        </>)}
      </div>

      {/* Filter panel */}
      {isTableMode && showFilter && (
        <FilterPanel columns={columns} filters={filters}
          setFilters={(f) => setTabState({ filters: f })} onApply={handleApplyFilter}
          onClear={() => {
            setTabState({ filters: [], showFilter: false })
            setTabFilters([])
            if (!tableName) return
            useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
            void executeQuery(true)
          }} />
      )}

      {/* Sort panel */}
      {showSort && (
        <SortPanel columns={columns} sorts={sorts}
          setSorts={(s) => setTabState({ sorts: s })} onApply={handleApplySort}
          onClear={() => {
            setTabState({ sorts: [], showSort: false })
            void sortByMulti([])
          }} />
      )}

      {/* Table */}
      {orderedColumns.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto select-none">
          <div style={{ minWidth: totalWidth }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedColumns.map((c) => c.name)} strategy={horizontalListSortingStrategy}>
                <div className="sticky top-0 z-10 flex border-b border-border-strong bg-surface-raised" style={{ height: 32 }}>
                  <div
                    className={cn('flex-shrink-0 flex items-center justify-center border-r border-border-subtle bg-surface-raised', isTableMode ? 'w-9' : 'w-12')}
                    style={pinnedCols.length > 0 ? { position: 'sticky', left: 0, zIndex: 12 } : undefined}>
                    {isTableMode ? <Checkbox checked={allSelected} onCheckedChange={toggleAll} className="h-3.5 w-3.5" /> : <span className="text-[10px] text-text-muted font-mono">#</span>}
                  </div>
                  {orderedColumns.map((col) => (
                    <SortableColumnHeader key={col.name} col={col} width={getColWidth(col.name)} sortBy={sortBy ?? null}
                      sortMulti={result?.sortMulti ?? []}
                      onSort={(e) => sortByColumn(col.name, e.shiftKey)} onResize={(delta) => handleResize(col.name, delta)}
                      isPinned={pinnedCols.includes(col.name)}
                      hiddenCount={hiddenCols.length}
                      {...(pinnedLeftOffsets[col.name] !== undefined ? { stickyLeft: pinnedLeftOffsets[col.name] } : {})}
                      onAddFilter={() => setTabState({ filters: [...getTabState().filters, { column: col.name, operator: '=', value: '' }], showFilter: true, showSort: false })}
                      onPin={() => togglePin(col.name)}
                      onHide={() => hideCol(col.name)}
                      onFitWidth={() => fitColWidth(col.name)}
                      onShowHidden={() => setTabState({ hiddenCols: [] })} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {rows.map((row, i) => {
              const rowContent = (
                <div
                  className={cn('flex border-b border-border-subtle hover:bg-surface-raised/60 transition-colors', i % 2 === 1 && 'bg-surface/30', selected.has(i) && 'bg-primary/5 hover:bg-primary/10')}
                  style={{ height: 30 }}>
                  <div
                    className={cn('flex-shrink-0 flex items-center justify-center border-r border-border-subtle', isTableMode ? 'w-9' : 'w-12', pinnedCols.length > 0 && 'bg-card')}
                    style={pinnedCols.length > 0 ? { position: 'sticky', left: 0, zIndex: 3 } : undefined}>
                    {isTableMode ? <Checkbox checked={selected.has(i)} onCheckedChange={() => toggleRow(i)} className="h-3.5 w-3.5" />
                      : <span className="text-[10px] text-text-muted font-mono tabular-nums">{page * pageSize + i + 1}</span>}
                  </div>
                  {orderedColumns.map((col) => {
                    const val = row?.[col.name]
                    const isEditing = isTableMode && editingCell?.rowIdx === i && editingCell?.colName === col.name
                    const isCellSelected = selectedCells.has(cellKey(i, col.name))
                    return (
                      <div key={col.name}
                        data-cell-key={cellKey(i, col.name)}
                        className={cn(
                          'flex items-center px-3 border flex-shrink-0 overflow-hidden transition-colors',
                          isEditing ? 'border-primary p-0' :
                          isCellSelected ? 'border-primary/50 bg-primary/5' :
                          'border-transparent hover:border-primary/30',
                          pinnedLeftOffsets[col.name] !== undefined && !isCellSelected && !isEditing && 'bg-card',
                        )}
                        style={{ width: getColWidth(col.name), ...(pinnedLeftOffsets[col.name] !== undefined ? { position: 'sticky', left: pinnedLeftOffsets[col.name], zIndex: 2 } : {}) }}
                        onMouseDown={(e) => handleCellMouseDown(i, col.name, e)}
                        onMouseEnter={() => handleCellMouseEnter(i, col.name)}
                        onMouseUp={() => { isDraggingRef.current = false }}
                        onDoubleClick={() => startEditing(i, col.name)}
                        onContextMenu={() => setCtxCell({ row, colName: col.name })}>
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void commitEdit() }
                              if (e.key === 'Escape') cancelEdit()
                              if (e.key === 'Tab') { e.preventDefault(); void commitEdit() }
                            }}
                            onBlur={() => void commitEdit()}
                            className="w-full h-full text-[12px] font-mono bg-background px-3 py-1 outline-none border-none"
                          />
                        ) : (
                          <span className="text-[12px] font-mono truncate">
                            {val === null ? <span className="text-text-muted italic">NULL</span>
                              : val === undefined ? <span className="text-text-muted/40">—</span>
                              : typeof val === 'object' ? <span className="text-muted-foreground">{JSON.stringify(val)}</span>
                              : <span className="text-foreground">{String(val)}</span>}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )

              if (!isTableMode) return (
                <ContextMenu key={page * pageSize + i}>
                  <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
                  {(() => {
                    const ctxColName = ctxCell?.row === row ? ctxCell.colName : ''
                    const isMultiCellSel = selectedCells.size > 1 && selectedCells.has(cellKey(i, ctxColName))
                    const cellSelRowIdxs = isMultiCellSel
                      ? [...new Set(Array.from(selectedCells).map((k) => parseInt(k.split(':')[0]!, 10)))].sort((a, b) => a - b)
                      : []
                    const cellSelRows = cellSelRowIdxs.map((r) => rows[r]).filter(Boolean) as Record<string, unknown>[]
                    const colNames = orderedColumns.map((c) => c.name)
                    const selCols = isMultiCellSel ? colNames.filter((cn) => cellSelRowIdxs.some((r) => selectedCells.has(cellKey(r, cn)))) : []

                    const copyCell = () => {
                      if (isMultiCellSel) {
                        const text = cellSelRowIdxs.map((r) => selCols.map((cn) => {
                          if (!selectedCells.has(cellKey(r, cn))) return ''
                          const v = rows[r]?.[cn]; return v === null ? 'NULL' : v === undefined ? '' : String(v)
                        }).join('\t')).join('\n')
                        navigator.clipboard.writeText(text)
                      } else {
                        const val = ctxCell?.row === row ? row[ctxCell.colName] : undefined
                        const text = val === null ? 'NULL' : val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                        navigator.clipboard.writeText(text)
                      }
                    }
                    const copyRow = () => {
                      const rowsToCopy = isMultiCellSel ? cellSelRows : [row]
                      const text = rowsToCopy.map((r) => orderedColumns.map((c) => { const v = r[c.name]; return v === null ? 'NULL' : v === undefined ? '' : String(v) }).join('\t')).join('\n')
                      navigator.clipboard.writeText(text)
                    }
                    return (
                      <ContextMenuContent className="w-52">
                        <ContextMenuItem className="gap-2 text-xs" onClick={copyCell}>
                          <ClipboardCopy className="h-3.5 w-3.5" />
                          {isMultiCellSel ? t('ctx.copyCells', { rows: String(cellSelRowIdxs.length), cols: String(selCols.length) }) : t('ctx.copyCell')}
                        </ContextMenuItem>
                        <ContextMenuItem className="gap-2 text-xs" onClick={copyRow}>
                          <Copy className="h-3.5 w-3.5" />
                          {isMultiCellSel ? t('ctx.copyRows', { count: String(cellSelRows.length) }) : t('ctx.copyRow')}
                        </ContextMenuItem>
                        {ctxCell?.row === row && (<>
                          <ContextMenuSeparator />
                          <ContextMenuItem disabled={isMultiCellSel} className="gap-2 text-xs" onClick={() => togglePin(ctxCell.colName)}>
                            {pinnedCols.includes(ctxCell.colName) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                            {pinnedCols.includes(ctxCell.colName) ? t('col.unpin') : t('col.pin')}
                          </ContextMenuItem>
                          <ContextMenuItem disabled={isMultiCellSel} className="gap-2 text-xs" onClick={() => fitColWidth(ctxCell.colName)}>
                            <ArrowLeftRight className="h-3.5 w-3.5" />{t('col.fitWidth')}
                          </ContextMenuItem>
                          <ContextMenuItem disabled={isMultiCellSel} className="gap-2 text-xs" onClick={() => hideCol(ctxCell.colName)}>
                            <EyeOff className="h-3.5 w-3.5" />{t('col.hide')}
                          </ContextMenuItem>
                          {hiddenCols.length > 0 && (
                            <ContextMenuItem className="gap-2 text-xs" onClick={() => setTabState({ hiddenCols: [] })}>
                              <Eye className="h-3.5 w-3.5" />{t('col.showHidden', { count: String(hiddenCols.length) })}
                            </ContextMenuItem>
                          )}
                        </>)}
                      </ContextMenuContent>
                    )
                  })()}
                </ContextMenu>
              )

              return (
                <ContextMenu key={page * pageSize + i}>
                  <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
                  {(() => {
                    const isMultiRowSel = selected.has(i) && selected.size > 1
                    const ctxColName = ctxCell?.row === row ? ctxCell.colName : ''
                    const isMultiCellSel = selectedCells.size > 1 && selectedCells.has(cellKey(i, ctxColName))
                    const isMulti = isMultiRowSel || isMultiCellSel

                    // Rows implied by cell selection
                    const cellSelRowIdxs = isMultiCellSel
                      ? [...new Set(Array.from(selectedCells).map((k) => parseInt(k.split(':')[0]!, 10)))].sort((a, b) => a - b)
                      : []
                    const cellSelRows = cellSelRowIdxs.map((r) => rows[r]).filter(Boolean) as Record<string, unknown>[]
                    const colNames = orderedColumns.map((c) => c.name)
                    const selCols = isMultiCellSel ? colNames.filter((cn) => cellSelRowIdxs.some((r) => selectedCells.has(cellKey(r, cn)))) : []

                    const copyCell = () => {
                      if (isMultiCellSel) {
                        const text = cellSelRowIdxs.map((r) => selCols.map((cn) => {
                          if (!selectedCells.has(cellKey(r, cn))) return ''
                          const v = rows[r]?.[cn]
                          return v === null ? 'NULL' : v === undefined ? '' : String(v)
                        }).join('\t')).join('\n')
                        navigator.clipboard.writeText(text)
                      } else {
                        const val = ctxCell?.row === row ? row[ctxCell.colName] : undefined
                        const text = val === null ? 'NULL' : val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                        navigator.clipboard.writeText(text)
                      }
                    }

                    const copyRows = () => {
                      const rowsToCopy = isMultiRowSel ? selectedRows : isMultiCellSel ? cellSelRows : [row]
                      const text = rowsToCopy.map((r) => orderedColumns.map((c) => { const v = r[c.name]; return v === null ? 'NULL' : v === undefined ? '' : String(v) }).join('\t')).join('\n')
                      navigator.clipboard.writeText(text)
                    }

                    const deleteRows = () => {
                      if (isMultiRowSel) {
                        setDeleteMultiConfirm({ count: selected.size, action: handleDeleteSelected })
                        return
                      }
                      if (isMultiCellSel) {
                        setDeleteMultiConfirm({
                          count: cellSelRows.length,
                          action: async () => {
                            const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]; if (!pkCol) return
                            const ids = cellSelRows.map((r) => { const v = r[pkCol.name]; return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'` })
                            useEditorStore.getState().setSql(`DELETE FROM ${tableName} WHERE ${pkCol.name} IN (${ids.join(', ')})`)
                            await executeQuery(true)
                            useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`); await executeQuery(true)
                            setTabState({ selected: new Set() })
                          },
                        })
                        return
                      }
                      setDeleteConfirmRow(row)
                    }

                    const deleteLabel = isMultiRowSel
                      ? t('ctx.deleteRecords', { count: String(selected.size) })
                      : isMultiCellSel
                        ? t('ctx.deleteRecords', { count: String(cellSelRows.length) })
                        : t('ctx.deleteRecord')

                    return (
                      <ContextMenuContent className="w-52">
                        <ContextMenuItem className="gap-2 text-xs" onClick={copyCell}>
                          <ClipboardCopy className="h-3.5 w-3.5" />
                          {isMultiCellSel ? t('ctx.copyCells', { rows: String(cellSelRowIdxs.length), cols: String(selCols.length) }) : t('ctx.copyCell')}
                        </ContextMenuItem>
                        <ContextMenuItem className="gap-2 text-xs" onClick={copyRows}>
                          <Copy className="h-3.5 w-3.5" />
                          {isMultiRowSel ? t('ctx.copyRows', { count: String(selected.size) }) : isMultiCellSel ? t('ctx.copyRows', { count: String(cellSelRows.length) }) : t('ctx.copyRow')}
                        </ContextMenuItem>
                        {ctxCell?.row === row && (<>
                          <ContextMenuSeparator />
                          <ContextMenuItem disabled={isMulti} className="gap-2 text-xs" onClick={() => {
                            const colName = ctxCell.colName
                            const val = row[colName]
                            const op = val === null ? 'IS NULL' : '='
                            const filterValue = val === null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                            const ts = getTabState()
                            setTabState({ filters: [...ts.filters, { column: colName, operator: op, value: filterValue }], showFilter: true, showSort: false })
                          }}>
                            <Filter className="h-3.5 w-3.5" />
                            {t('ctx.addAsFilter')}
                          </ContextMenuItem>
                        </>)}
                        <ContextMenuSeparator />
                        <ContextMenuItem disabled={isMulti} className="gap-2 text-xs" onClick={() => setSheetState({ mode: 'edit', editRow: row })}>
                          <Pencil className="h-3.5 w-3.5" />
                          {t('ctx.editRecord')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="gap-2 text-xs text-destructive focus:text-destructive" onClick={deleteRows}>
                          <Trash2 className="h-3.5 w-3.5" />
                          {deleteLabel}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    )
                  })()}
                </ContextMenu>
              )
            })}
          </div>
        </div>
      )}

      {(rows.length > 0 || page > 0) && (
        <PaginationBar page={page} totalPages={totalPages} pageSize={pageSize} totalRows={total}
          onPage={goToPage} onPageSize={setResultPageSize} onRefresh={reloadTab} onExport={handleExport} />
      )}

      {/* Record sheet (insert / edit) */}
      {isTableMode && sheetState && (
        <RecordSheet open mode={sheetState.mode} {...(sheetState.editRow ? { editRow: sheetState.editRow } : {})}
          onClose={() => setSheetState(null)} columns={columns} />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmRow !== null} onOpenChange={(o) => { if (!o) setDeleteConfirmRow(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('ctx.deleteRecordTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('ctx.deleteRecordConfirm')}
          </p>
          <SlideToConfirm
            label={t('admin.slideToDelete')}
            onConfirm={async () => {
              if (!deleteConfirmRow || !tableName) return
              const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]
              if (!pkCol) return
              const v = deleteConfirmRow[pkCol.name]
              const pkLit = typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
              useEditorStore.getState().setSql(`DELETE FROM ${tableName} WHERE ${pkCol.name} = ${pkLit}`)
              await executeQuery(true)
              useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
              await executeQuery(true)
              setDeleteConfirmRow(null)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Multi-row delete confirmation dialog */}
      <Dialog open={deleteMultiConfirm !== null} onOpenChange={(o) => { if (!o) setDeleteMultiConfirm(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('ctx.deleteRecordTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('ctx.deleteRecordsConfirm', { count: String(deleteMultiConfirm?.count ?? 0) })}
          </p>
          <SlideToConfirm
            label={t('ctx.slideToDelete', { count: String(deleteMultiConfirm?.count ?? 0) })}
            onConfirm={async () => {
              if (!deleteMultiConfirm) return
              await deleteMultiConfirm.action()
              setDeleteMultiConfirm(null)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

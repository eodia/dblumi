import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
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
  ChevronDown, Pencil, ClipboardCopy, CalendarIcon,
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
  DialogFooter,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useEditorStore, type QueryColumn, type SortBy, type SortEntry } from '@/stores/editor.store'
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

type FilterRow = { column: string; operator: string; value: string }

// ── Per-tab state that persists across tab switches ─
type TabLocalState = {
  showFilter: boolean
  showSort: boolean
  filters: FilterRow[]
  sorts: SortEntry[]
  selected: Set<number>
  colWidths: Record<string, number>
  colOrder: string[] | null
}

// Module-level map so it survives component unmount/remount
const _tabStates = new Map<string, TabLocalState>()

function defaultTabState(): TabLocalState {
  return { showFilter: false, showSort: false, filters: [], sorts: [], selected: new Set(), colWidths: {}, colOrder: null }
}

// ── Pagination bar ───────────────────────────────
export function PaginationBar({
  page, totalPages, pageSize, totalRows, onPage, onPageSize, onRefresh, onExport,
}: {
  page: number; totalPages: number; pageSize: number; totalRows: number
  onPage: (p: number) => void; onPageSize: (s: number) => void; onRefresh?: () => void
  onExport?: (format: 'csv' | 'json' | 'sql') => void
}) {
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
        <span className="text-[11px] text-text-muted whitespace-nowrap hidden sm:block">Lignes par page</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 w-16 px-2 text-xs justify-between">
              {pageSize}<ChevronRight className="h-3 w-3 rotate-90 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[4rem]">
            {PAGE_SIZE_OPTIONS.map((s) => (
              <DropdownMenuItem key={s} className={cn('text-xs', s === pageSize && 'text-primary font-medium')}
                onClick={() => { onPageSize(s); onPage(0) }}>{s}</DropdownMenuItem>
            ))}
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
              <DropdownMenuItem className="text-xs" onClick={() => onExport('csv')}>Exporter en CSV</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => onExport('json')}>Exporter en JSON</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => onExport('sql')}>Exporter en SQL</DropdownMenuItem>
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
function SortableColumnHeader({ col, width, sortBy, onSort, onResize }: {
  col: QueryColumn; width: number; sortBy: SortBy; onSort: () => void; onResize: (delta: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.name })
  return (
    <div ref={setNodeRef}
      className="relative flex items-center gap-0.5 border-r border-border-subtle flex-shrink-0 select-none"
      style={{ width, transform: CSS.Transform.toString(transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 30 : undefined }}>
      <span {...attributes} {...listeners}
        className="flex items-center justify-center w-5 flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-text-muted/70 transition-colors"
        onClick={(e) => e.stopPropagation()}>
        <GripVertical className="h-3 w-3" />
      </span>
      <button type="button" onClick={onSort} className="flex items-center gap-1 min-w-0 flex-1 pr-2 hover:text-foreground transition-colors">
        <span className="text-[11px] font-semibold text-muted-foreground truncate">{col.name}</span>
        <span className="text-[10px] text-text-muted/50 font-mono flex-shrink-0">{col.dataType}</span>
        {sortBy?.column === col.name ? (
          sortBy.direction === 'asc' ? <ArrowUp className="h-3 w-3 text-primary flex-shrink-0" /> : <ArrowDown className="h-3 w-3 text-primary flex-shrink-0" />
        ) : (
          <ArrowUpDown className="h-3 w-3 text-text-muted/20 flex-shrink-0" />
        )}
      </button>
      <ResizeHandle onResize={onResize} />
    </div>
  )
}

// ── Filter Panel ─────────────────────────────────
function FilterPanel({ columns, filters, setFilters, onApply, onClear }: {
  columns: QueryColumn[]; filters: FilterRow[]; setFilters: (f: FilterRow[]) => void; onApply: () => void; onClear: () => void
}) {
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
            <Input value={f.value} onChange={(e) => updateFilter(i, { value: e.target.value })} placeholder="Saisir une valeur" className="h-7 text-xs flex-1 min-w-[120px]"
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onApply() } }} />
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeFilter(i)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addFilter}><Plus className="h-3 w-3" />Ajouter un filtre</Button>
        <div className="flex-1" />
        {filters.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={onClear} title="Supprimer et appliquer">Supprimer les filtres</Button>
        )}
        <Button size="sm" className="h-7 text-xs" onClick={onApply} title="Ctrl+Enter">Appliquer les filtres</Button>
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
function SortPanel({ columns, sorts, setSorts, onApply }: {
  columns: QueryColumn[]; sorts: SortEntry[]; setSorts: (s: SortEntry[]) => void; onApply: () => void
}) {
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
                  <span className="text-text-muted flex-shrink-0">{i === 0 ? 'trier par' : 'puis par'}</span>
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
                  <span className="text-text-muted flex-shrink-0">croissant :</span>
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
              Ajouter une colonne de tri
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
        <Button size="sm" className="h-7 text-xs" onClick={onApply} disabled={sorts.length === 0} title="Ctrl+Enter">Appliquer le tri</Button>
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

function TypedField({ col, value, onChange }: { col: QueryColumn; value: string; onChange: (v: string) => void }) {
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
              {dateVal ? format(dateVal, displayFormat, { locale: fr }) : <span className="text-text-muted">Choisir une date</span>}
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

  if (isNumericType(dt)) {
    return <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder="NULL" className="h-8 text-xs" />
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
  const initialValues = useMemo(() => {
    if (mode !== 'edit' || !editRow) return {}
    return Object.fromEntries(columns.map((c) => [c.name, editRow[c.name] === null || editRow[c.name] === undefined ? '' : String(editRow[c.name])]))
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

  const titles: Record<string, string> = { row: 'Nouvelle ligne', column: 'Nouvelle colonne', csv: 'Importer CSV', edit: 'Modifier l\'enregistrement' }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md bg-card flex flex-col overflow-hidden">
        <SheetHeader><SheetTitle>{titles[mode]}</SheetTitle></SheetHeader>
        <div className="mt-4 flex-1 overflow-y-auto px-0.5 space-y-3">
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
              <div className="space-y-1"><Label className="text-xs">Nom de la colonne</Label><Input value={colName} onChange={(e) => setColName(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Type</Label><Input value={colType} onChange={(e) => setColType(e.target.value)} placeholder="text" className="h-8 text-xs" /></div>
            </div>
          )}
          {mode === 'csv' && (
            <div className="space-y-1">
              <Label className="text-xs">Données CSV (première ligne = en-têtes)</Label>
              <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)}
                placeholder={"name,email,age\nAlice,alice@example.com,30\nBob,bob@example.com,25"}
                className="w-full h-40 rounded-md border border-border-subtle bg-surface-overlay p-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          )}
        </div>
        <SheetFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
          {mode === 'row' && <Button size="sm" onClick={handleInsertRow}>Insérer la ligne</Button>}
          {mode === 'edit' && <Button size="sm" onClick={handleUpdateRow}>Enregistrer</Button>}
          {mode === 'column' && <Button size="sm" onClick={handleAddColumn} disabled={!colName.trim()}>Ajouter la colonne</Button>}
          {mode === 'csv' && <Button size="sm" onClick={handleImportCsv} disabled={!csvText.trim()}>Importer</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Main component ───────────────────────────────
export function ResultsTable() {
  const { tabs, activeTabId, goToPage, setResultPageSize, reloadTab, sortByColumn, sortByMulti, executeQuery } = useEditorStore()
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
    if (!_tabStates.has(activeTabId)) _tabStates.set(activeTabId, defaultTabState())
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
  const { showFilter, showSort, filters, sorts, selected, colWidths, colOrder } = ts

  const getColWidth = (name: string) => colWidths[name] ?? DEFAULT_COL_W
  const handleResize = useCallback((colName: string, delta: number) => {
    setTabState({ colWidths: { ...getTabState().colWidths, [colName]: Math.max(MIN_COL_W, (getTabState().colWidths[colName] ?? DEFAULT_COL_W) + delta) } })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  const orderedColumns = colOrder
    ? colOrder.map((name) => columns.find((c) => c.name === name)).filter(Boolean) as QueryColumn[]
    : columns

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
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<Record<string, unknown> | null>(null)
  const [ctxCell, setCtxCell] = useState<{ row: Record<string, unknown>; colName: string } | null>(null)

  // ── Apply filter → build WHERE ──────────
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
    useEditorStore.getState().setSql(sql)
    void executeQuery(true)
    setTabState({ showFilter: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, tableName, executeQuery, activeTabId])

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

  const checkboxColW = 36
  const totalWidth = (isTableMode ? checkboxColW : 48) + orderedColumns.reduce((sum, col) => sum + getColWidth(col.name), 0)

  // ── Empty / loading / error states ──────
  if (status === 'idle' && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted bg-background">
        <TableIcon className="h-8 w-8 opacity-20" /><span className="text-xs">Les résultats apparaîtront ici</span>
        <span className="text-[11px] text-text-muted/60">Ctrl+Enter pour exécuter</span>
      </div>
    )
  }
  if (status === 'running' && rows.length === 0) {
    return (<div className="flex items-center justify-center h-full gap-2 text-muted-foreground bg-background"><Loader2 className="h-4 w-4 animate-spin text-primary" /><span className="text-xs">Exécution en cours...</span></div>)
  }
  if (status === 'error') {
    return (<div className="flex items-center justify-center h-full gap-2 px-6 bg-background"><AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" /><span className="text-xs text-destructive">{error ?? 'Erreur inconnue'}</span></div>)
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Status / Action bar */}
      <div className="flex items-center gap-2 h-8 px-3 border-b border-border-subtle bg-surface flex-shrink-0">
        {isTableMode && someSelected ? (<>
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleDeleteSelected}>
            <Trash2 className="h-3 w-3" />Supprimer {selected.size} ligne{selected.size > 1 ? 's' : ''}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-6 text-xs gap-1"><Copy className="h-3 w-3" />Copier<ChevronDown className="h-3 w-3 opacity-50" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem className="text-xs" onClick={() => handleCopy('csv')}>Copier en CSV</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleCopy('json')}>Copier en JSON</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleCopy('sql')}>Copier en SQL</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-6 text-xs gap-1"><Download className="h-3 w-3" />Exporter<ChevronDown className="h-3 w-3 opacity-50" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem className="text-xs" onClick={() => handleExport('csv')}>Exporter en CSV</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleExport('json')}>Exporter en JSON</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => handleExport('sql')}>Exporter en SQL</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>) : (<>
          {status === 'done' && (<>
            <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground tabular-nums">{(totalCount ?? rowCount).toLocaleString('fr-FR')} ligne{(totalCount ?? rowCount) !== 1 ? 's' : ''}</span>
            <span className="text-[11px] text-text-muted tabular-nums">{durationMs} ms</span>
            {sortBy && <span className="text-[11px] text-primary tabular-nums">ORDER BY {sortBy.column} {sortBy.direction.toUpperCase()}</span>}
          </>)}
          {status === 'running' && (<div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /><span className="tabular-nums">{rows.length} lignes reçues...</span></div>)}
          {isTableMode && status === 'done' && (
            <div className="ml-auto flex items-center gap-1">
              <Button variant={showFilter ? 'default' : 'ghost'} size="sm" className="h-6 text-xs gap-1"
                onClick={() => setTabState({ showFilter: !showFilter, showSort: false })}>
                <Filter className="h-3 w-3" />Filtrer
                {filters.length > 0 && <span className="ml-0.5 bg-primary/20 text-primary rounded px-1 text-[10px]">{filters.length}</span>}
              </Button>
              <Button variant={showSort ? 'default' : 'ghost'} size="sm" className="h-6 text-xs gap-1"
                onClick={() => setTabState({ showSort: !showSort, showFilter: false })}>
                <ArrowDownUp className="h-3 w-3" />Trier
                {sorts.length > 0 && <span className="ml-0.5 bg-primary/20 text-primary rounded px-1 text-[10px]">{sorts.length}</span>}
              </Button>
              <div className="w-px h-4 bg-border-subtle mx-1" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1"><Plus className="h-3 w-3" />Insérer<ChevronDown className="h-3 w-3 opacity-50" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem className="text-xs gap-2" onClick={() => setSheetState({ mode: 'row' })}>Nouvelle ligne</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs gap-2" onClick={() => setSheetState({ mode: 'column' })}>Nouvelle colonne</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs gap-2" onClick={() => setSheetState({ mode: 'csv' })}>Importer CSV</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
            if (!tableName) return
            useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
            void executeQuery(true)
          }} />
      )}

      {/* Sort panel */}
      {isTableMode && showSort && (
        <SortPanel columns={columns} sorts={sorts}
          setSorts={(s) => setTabState({ sorts: s })} onApply={handleApplySort} />
      )}

      {/* Table */}
      {orderedColumns.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div style={{ minWidth: totalWidth }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedColumns.map((c) => c.name)} strategy={horizontalListSortingStrategy}>
                <div className="sticky top-0 z-10 flex border-b border-border-strong bg-surface-raised" style={{ height: 32 }}>
                  <div className={cn('flex-shrink-0 flex items-center justify-center border-r border-border-subtle', isTableMode ? 'w-9' : 'w-12')}>
                    {isTableMode ? <Checkbox checked={allSelected} onCheckedChange={toggleAll} className="h-3.5 w-3.5" /> : <span className="text-[10px] text-text-muted font-mono">#</span>}
                  </div>
                  {orderedColumns.map((col) => (
                    <SortableColumnHeader key={col.name} col={col} width={getColWidth(col.name)} sortBy={sortBy ?? null}
                      onSort={() => sortByColumn(col.name)} onResize={(delta) => handleResize(col.name, delta)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {rows.map((row, i) => {
              const rowContent = (
                <div
                  className={cn('flex border-b border-border-subtle hover:bg-surface-raised/60 transition-colors', i % 2 === 1 && 'bg-surface/30', selected.has(i) && 'bg-primary/5 hover:bg-primary/10')}
                  style={{ height: 30 }}>
                  <div className={cn('flex-shrink-0 flex items-center justify-center border-r border-border-subtle', isTableMode ? 'w-9' : 'w-12')}>
                    {isTableMode ? <Checkbox checked={selected.has(i)} onCheckedChange={() => toggleRow(i)} className="h-3.5 w-3.5" />
                      : <span className="text-[10px] text-text-muted font-mono tabular-nums">{page * pageSize + i + 1}</span>}
                  </div>
                  {orderedColumns.map((col) => {
                    const val = row?.[col.name]
                    return (
                      <div key={col.name} className="flex items-center px-3 border-r border-border-subtle flex-shrink-0 overflow-hidden" style={{ width: getColWidth(col.name) }}
                        onContextMenu={() => setCtxCell({ row, colName: col.name })}>
                        <span className="text-[12px] font-mono truncate">
                          {val === null ? <span className="text-text-muted italic">NULL</span>
                            : val === undefined ? <span className="text-text-muted/40">—</span>
                            : typeof val === 'object' ? <span className="text-muted-foreground">{JSON.stringify(val)}</span>
                            : <span className="text-foreground">{String(val)}</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )

              if (!isTableMode) return <div key={page * pageSize + i}>{rowContent}</div>

              return (
                <ContextMenu key={page * pageSize + i}>
                  <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem className="gap-2 text-xs" onClick={() => {
                      const val = ctxCell?.row === row ? row[ctxCell.colName] : undefined
                      const text = val === null ? 'NULL' : val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                      navigator.clipboard.writeText(text)
                    }}>
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copier la cellule
                    </ContextMenuItem>
                    <ContextMenuItem className="gap-2 text-xs" onClick={() => {
                      const text = orderedColumns.map((c) => { const v = row[c.name]; return v === null ? 'NULL' : v === undefined ? '' : String(v) }).join('\t')
                      navigator.clipboard.writeText(text)
                    }}>
                      <Copy className="h-3.5 w-3.5" />
                      Copier la ligne
                    </ContextMenuItem>
                    {isTableMode && ctxCell?.row === row && (<>
                      <ContextMenuSeparator />
                      <ContextMenuItem className="gap-2 text-xs" onClick={() => {
                        const colName = ctxCell.colName
                        const val = row[colName]
                        const op = val === null ? 'IS NULL' : '='
                        const filterValue = val === null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                        const ts = getTabState()
                        setTabState({
                          filters: [...ts.filters, { column: colName, operator: op, value: filterValue }],
                          showFilter: true,
                          showSort: false,
                        })
                      }}>
                        <Filter className="h-3.5 w-3.5" />
                        Ajouter comme filtre
                      </ContextMenuItem>
                    </>)}
                    <ContextMenuSeparator />
                    <ContextMenuItem className="gap-2 text-xs" onClick={() => setSheetState({ mode: 'edit', editRow: row })}>
                      <Pencil className="h-3.5 w-3.5" />
                      Modifier l'enregistrement
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="gap-2 text-xs text-destructive focus:text-destructive" onClick={() => setDeleteConfirmRow(row)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Supprimer l'enregistrement
                    </ContextMenuItem>
                  </ContextMenuContent>
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
          <DialogHeader><DialogTitle className="text-base">Supprimer l'enregistrement</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Êtes-vous sûr de vouloir supprimer cet enregistrement ? Cette action est irréversible.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmRow(null)}>Annuler</Button>
            <Button variant="destructive" size="sm" onClick={async () => {
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
            }}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState, useCallback, useRef, useMemo } from 'react'
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
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Loader2, AlertCircle, CheckCircle2, TableIcon,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, GripVertical,
  Filter, ArrowDownUp, Plus, Trash2, Copy, Download, X,
  ChevronDown,
} from 'lucide-react'
import { useEditorStore, type QueryColumn, type SortBy } from '@/stores/editor.store'
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

// ── Pagination bar ───────────────────────────────
export function PaginationBar({
  page,
  totalPages,
  pageSize,
  totalRows,
  onPage,
  onPageSize,
  onRefresh,
}: {
  page: number
  totalPages: number
  pageSize: number
  totalRows: number
  onPage: (p: number) => void
  onPageSize: (s: number) => void
  onRefresh?: () => void
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
              {pageSize}
              <ChevronRight className="h-3 w-3 rotate-90 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[4rem]">
            {PAGE_SIZE_OPTIONS.map((s) => (
              <DropdownMenuItem
                key={s}
                className={cn('text-xs', s === pageSize && 'text-primary font-medium')}
                onClick={() => { onPageSize(s); onPage(0) }}
              >
                {s}
              </DropdownMenuItem>
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
        {onRefresh && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 mr-1" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          disabled={page === 0} onClick={() => onPage(0)}>
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          disabled={page === 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {page > 0 && (
          <Button variant="ghost" size="sm"
            className="h-6 min-w-6 px-1.5 text-xs text-text-muted"
            onClick={() => onPage(page - 1)}>
            {page}
          </Button>
        )}
        <Input
          className="h-6 w-10 text-center text-xs px-1 tabular-nums"
          value={inputValue !== '' ? inputValue : String(page + 1)}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commitInput(); (e.target as HTMLInputElement).blur() }
            if (e.key === 'Escape') { setInputValue(''); (e.target as HTMLInputElement).blur() }
          }}
          onFocus={(e) => { setInputValue(String(page + 1)); e.target.select() }}
        />
        {page < totalPages - 1 && (
          <Button variant="ghost" size="sm"
            className="h-6 min-w-6 px-1.5 text-xs text-text-muted"
            onClick={() => onPage(page + 1)}>
            {page + 2}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          disabled={page >= totalPages - 1} onClick={() => onPage(totalPages - 1)}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] text-text-muted tabular-nums ml-1 hidden sm:block">
          / {totalPages}
        </span>
      </div>
    </div>
  )
}

// ── Column resize handle ─────────────────────────
function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const startX = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      startX.current = e.clientX
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        onResize(ev.clientX - startX.current)
        startX.current = ev.clientX
      }
      const onUp = () => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [onResize],
  )

  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 hover:bg-primary/30 active:bg-primary/50 transition-colors"
    />
  )
}

// ── Sortable column header ───────────────────────
function SortableColumnHeader({
  col,
  width,
  sortBy,
  onSort,
  onResize,
}: {
  col: QueryColumn
  width: number
  sortBy: SortBy
  onSort: () => void
  onResize: (delta: number) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.name })

  return (
    <div
      ref={setNodeRef}
      className="relative flex items-center gap-0.5 border-r border-border-subtle flex-shrink-0 select-none"
      style={{
        width,
        transform: CSS.Transform.toString(transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <span
        {...attributes}
        {...listeners}
        className="flex items-center justify-center w-5 flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-text-muted/70 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3" />
      </span>
      <button
        type="button"
        onClick={onSort}
        className="flex items-center gap-1 min-w-0 flex-1 pr-2 hover:text-foreground transition-colors"
      >
        <span className="text-[11px] font-semibold text-muted-foreground truncate">{col.name}</span>
        <span className="text-[10px] text-text-muted/50 font-mono flex-shrink-0">{col.dataType}</span>
        {sortBy?.column === col.name ? (
          sortBy.direction === 'asc' ? (
            <ArrowUp className="h-3 w-3 text-primary flex-shrink-0" />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary flex-shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-text-muted/20 flex-shrink-0" />
        )}
      </button>
      <ResizeHandle onResize={onResize} />
    </div>
  )
}

// ── Filter Panel ─────────────────────────────────
function FilterPanel({
  columns,
  filters,
  setFilters,
  onApply,
}: {
  columns: QueryColumn[]
  filters: FilterRow[]
  setFilters: (f: FilterRow[]) => void
  onApply: () => void
}) {
  const addFilter = () => setFilters([...filters, { column: columns[0]?.name ?? '', operator: '=', value: '' }])
  const removeFilter = (i: number) => setFilters(filters.filter((_, j) => j !== i))
  const updateFilter = (i: number, patch: Partial<FilterRow>) =>
    setFilters(filters.map((f, j) => j === i ? { ...f, ...patch } : f))

  const noValue = (op: string) => op === 'IS NULL' || op === 'IS NOT NULL'

  return (
    <div className="px-3 py-2 border-b border-border-subtle bg-surface space-y-2">
      {filters.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 min-w-[100px] px-2 text-xs justify-between">
                {f.column}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-56 overflow-y-auto">
              {columns.map((col) => (
                <DropdownMenuItem key={col.name} className="text-xs" onClick={() => updateFilter(i, { column: col.name })}>
                  {col.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-20 px-2 text-xs justify-between">
                {f.operator}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {FILTER_OPERATORS.map((op) => (
                <DropdownMenuItem key={op.value} className="text-xs" onClick={() => updateFilter(i, { operator: op.value })}>
                  {op.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {!noValue(f.operator) && (
            <Input
              value={f.value}
              onChange={(e) => updateFilter(i, { value: e.target.value })}
              placeholder="Enter a value"
              className="h-7 text-xs flex-1 min-w-[120px]"
            />
          )}

          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeFilter(i)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addFilter}>
          <Plus className="h-3 w-3" />
          Add filter
        </Button>
        <div className="flex-1" />
        <Button size="sm" className="h-7 text-xs" onClick={onApply}>
          Apply filter
        </Button>
      </div>
    </div>
  )
}

// ── Sort Panel ───────────────────────────────────
function SortPanel({
  columns,
  sortCol,
  setSortCol,
  sortAsc,
  setSortAsc,
  onApply,
}: {
  columns: QueryColumn[]
  sortCol: string
  setSortCol: (c: string) => void
  sortAsc: boolean
  setSortAsc: (a: boolean) => void
  onApply: () => void
}) {
  return (
    <div className="px-3 py-2 border-b border-border-subtle bg-surface space-y-2">
      {sortCol && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">sort by</span>
          <span className="font-semibold">{sortCol}</span>
          <div className="flex-1" />
          <span className="text-text-muted">ascending:</span>
          <Switch checked={sortAsc} onCheckedChange={setSortAsc} className="scale-75" />
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSortCol('')}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              Pick a column to sort by
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-56 overflow-y-auto">
            {columns.map((col) => (
              <DropdownMenuItem key={col.name} className="text-xs" onClick={() => setSortCol(col.name)}>
                {col.name}
                <span className="ml-auto text-text-muted/50 font-mono text-[10px]">{col.dataType}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <Button size="sm" className="h-7 text-xs" onClick={onApply} disabled={!sortCol}>
          Apply sorting
        </Button>
      </div>
    </div>
  )
}

// ── Clipboard / Export helpers ────────────────────
function rowsToCsv(rows: Record<string, unknown>[], columns: QueryColumn[]): string {
  const header = columns.map((c) => c.name).join(',')
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = r[c.name]
      if (v === null || v === undefined) return ''
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  ).join('\n')
  return `${header}\n${body}`
}

function rowsToJson(rows: Record<string, unknown>[], columns: QueryColumn[]): string {
  const filtered = rows.map((r) => Object.fromEntries(columns.map((c) => [c.name, r[c.name] ?? null])))
  return JSON.stringify(filtered, null, 2)
}

function rowsToSql(rows: Record<string, unknown>[], columns: QueryColumn[], tableName: string): string {
  return rows.map((r) => {
    const vals = columns.map((c) => {
      const v = r[c.name]
      if (v === null || v === undefined) return 'NULL'
      if (typeof v === 'number') return String(v)
      return `'${String(v).replace(/'/g, "''")}'`
    })
    return `INSERT INTO ${tableName} (${columns.map((c) => c.name).join(', ')}) VALUES (${vals.join(', ')});`
  }).join('\n')
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Insert Sheet ─────────────────────────────────
function InsertSheet({
  open,
  onClose,
  columns,
}: {
  open: boolean
  onClose: () => void
  columns: QueryColumn[]
}) {
  const [mode, setMode] = useState<'row' | 'column' | 'csv'>('row')
  const [rowValues, setRowValues] = useState<Record<string, string>>({})
  const [colName, setColName] = useState('')
  const [colType, setColType] = useState('text')
  const [csvText, setCsvText] = useState('')

  const { tabs, activeTabId, activeConnectionId, executeQuery } = useEditorStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  const tableName = tab?.kind === 'table' ? tab.name : ''

  const handleInsertRow = async () => {
    if (!activeConnectionId || !tableName) return
    const cols = Object.keys(rowValues).filter((k) => rowValues[k] !== '')
    if (cols.length === 0) return
    const vals = cols.map((k) => {
      const v = rowValues[k]
      return v === 'NULL' ? 'NULL' : `'${v!.replace(/'/g, "''")}'`
    })
    const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${vals.join(', ')})`
    // Execute via store — temporarily set SQL and run
    useEditorStore.getState().setSql(sql)
    await executeQuery(true)
    // Reload original table
    useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
    await executeQuery(true)
    setRowValues({})
    onClose()
  }

  const handleAddColumn = async () => {
    if (!activeConnectionId || !tableName || !colName.trim()) return
    const sql = `ALTER TABLE ${tableName} ADD COLUMN ${colName.trim()} ${colType}`
    useEditorStore.getState().setSql(sql)
    await executeQuery(true)
    useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
    await executeQuery(true)
    setColName('')
    onClose()
  }

  const handleImportCsv = async () => {
    if (!activeConnectionId || !tableName || !csvText.trim()) return
    const lines = csvText.trim().split('\n')
    if (lines.length < 2) return
    const headers = lines[0]!.split(',').map((h) => h.trim())
    const stmts = lines.slice(1).map((line) => {
      const vals = line.split(',').map((v) => {
        const trimmed = v.trim()
        return trimmed === '' || trimmed.toUpperCase() === 'NULL' ? 'NULL' : `'${trimmed.replace(/'/g, "''")}'`
      })
      return `INSERT INTO ${tableName} (${headers.join(', ')}) VALUES (${vals.join(', ')})`
    })
    for (const stmt of stmts) {
      useEditorStore.getState().setSql(stmt)
      await executeQuery(true)
    }
    useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
    await executeQuery(true)
    setCsvText('')
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md bg-card">
        <SheetHeader>
          <SheetTitle>Insérer des données</SheetTitle>
        </SheetHeader>

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-md bg-surface-overlay p-1 mt-4">
          {(['row', 'column', 'csv'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                mode === m
                  ? 'bg-card text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              {m === 'row' ? 'Nouvelle ligne' : m === 'column' ? 'Nouvelle colonne' : 'Importer CSV'}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {mode === 'row' && (
            <>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {columns.map((col) => (
                  <div key={col.name} className="space-y-1">
                    <Label className="text-xs">
                      {col.name} <span className="text-text-muted/50 font-mono">{col.dataType}</span>
                    </Label>
                    <Input
                      value={rowValues[col.name] ?? ''}
                      onChange={(e) => setRowValues((p) => ({ ...p, [col.name]: e.target.value }))}
                      placeholder="NULL"
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>
              <Button size="sm" className="w-full" onClick={handleInsertRow}>
                Insérer la ligne
              </Button>
            </>
          )}

          {mode === 'column' && (
            <>
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nom de la colonne</Label>
                  <Input value={colName} onChange={(e) => setColName(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Input value={colType} onChange={(e) => setColType(e.target.value)} placeholder="text" className="h-8 text-xs" />
                </div>
              </div>
              <Button size="sm" className="w-full" onClick={handleAddColumn} disabled={!colName.trim()}>
                Ajouter la colonne
              </Button>
            </>
          )}

          {mode === 'csv' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Données CSV (première ligne = headers)</Label>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={"name,email,age\nAlice,alice@example.com,30\nBob,bob@example.com,25"}
                  className="w-full h-40 rounded-md border border-border-subtle bg-surface-overlay p-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <Button size="sm" className="w-full" onClick={handleImportCsv} disabled={!csvText.trim()}>
                Importer
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Main component ───────────────────────────────
export function ResultsTable() {
  const { tabs, activeTabId, goToPage, setResultPageSize, reloadTab, sortByColumn, executeQuery } = useEditorStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  const result = tab?.result
  const isTableMode = tab?.kind === 'table'
  const tableName = isTableMode ? tab.name : ''
  const { status, columns, rows, rowCount, totalCount, page, pageSize, durationMs, error, sortBy } =
    result ?? {
      status: 'idle' as const,
      columns: [],
      rows: [],
      rowCount: 0,
      totalCount: null,
      page: 0,
      pageSize: 100,
      durationMs: 0,
      error: null,
      guardrail: null,
      sortBy: null,
    }

  const total = totalCount ?? rowCount
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // ── Column widths ───────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const getColWidth = (name: string) => colWidths[name] ?? DEFAULT_COL_W
  const handleResize = useCallback((colName: string, delta: number) => {
    setColWidths((prev) => ({
      ...prev,
      [colName]: Math.max(MIN_COL_W, (prev[colName] ?? DEFAULT_COL_W) + delta),
    }))
  }, [])

  // ── Column order ────────────────────────
  const [colOrder, setColOrder] = useState<string[] | null>(null)
  const orderedColumns = colOrder
    ? colOrder.map((name) => columns.find((c) => c.name === name)).filter(Boolean) as QueryColumn[]
    : columns

  const colKey = columns.map((c) => c.name).join(',')
  const prevColKey = useRef(colKey)
  if (colKey !== prevColKey.current) {
    prevColKey.current = colKey
    if (colOrder) setColOrder(null)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const current = colOrder ?? columns.map((c) => c.name)
    const fromIdx = current.indexOf(String(active.id))
    const toIdx = current.indexOf(String(over.id))
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...current]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved!)
    setColOrder(next)
  }, [colOrder, columns])

  // ── Table mode: filter / sort panels ────
  const [showFilter, setShowFilter] = useState(false)
  const [showSort, setShowSort] = useState(false)
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [panelSortCol, setPanelSortCol] = useState('')
  const [panelSortAsc, setPanelSortAsc] = useState(true)

  // ── Table mode: selection ───────────────
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const allSelected = rows.length > 0 && selected.size === rows.length
  const someSelected = selected.size > 0

  const toggleRow = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((_, i) => i)))
    }
  }, [allSelected, rows])

  // Reset selection on page/data change
  const rowsRef = useRef(rows)
  if (rows !== rowsRef.current) {
    rowsRef.current = rows
    if (selected.size > 0) setSelected(new Set())
  }

  // ── Table mode: insert sheet ────────────
  const [insertOpen, setInsertOpen] = useState(false)

  // ── Table mode: apply filter ────────────
  const handleApplyFilter = useCallback(() => {
    if (!tableName) return
    const validFilters = filters.filter((f) => f.column && f.operator)
    let sql = `SELECT * FROM ${tableName}`
    if (validFilters.length > 0) {
      const clauses = validFilters.map((f) => {
        if (f.operator === 'IS NULL') return `${f.column} IS NULL`
        if (f.operator === 'IS NOT NULL') return `${f.column} IS NOT NULL`
        return `${f.column} ${f.operator} '${f.value.replace(/'/g, "''")}'`
      })
      sql += ` WHERE ${clauses.join(' AND ')}`
    }
    useEditorStore.getState().setSql(sql)
    void executeQuery(true)
    setShowFilter(false)
  }, [filters, tableName, executeQuery])

  // ── Table mode: apply sort ──────────────
  const handleApplySort = useCallback(() => {
    if (!panelSortCol) return
    void sortByColumn(panelSortCol)
    // If current sort matches but direction differs, toggle again
    if (sortBy?.column === panelSortCol) {
      const wantAsc = panelSortAsc
      const isAsc = sortBy.direction === 'asc'
      if (wantAsc !== isAsc) void sortByColumn(panelSortCol)
    }
    setShowSort(false)
  }, [panelSortCol, panelSortAsc, sortBy, sortByColumn])

  // ── Selection actions ───────────────────
  const selectedRows = useMemo(() => Array.from(selected).map((i) => rows[i]!), [selected, rows])

  const handleDeleteSelected = useCallback(async () => {
    // We can't generically delete without knowing PK. Use a simple approach for table mode.
    // For now, show a message — this needs backend support for proper delete.
    if (!tableName || selectedRows.length === 0) return
    // Attempt to find a primary key-like column (id, or first column)
    const pkCol = columns.find((c) => c.name.toLowerCase() === 'id') ?? columns[0]
    if (!pkCol) return
    const ids = selectedRows.map((r) => {
      const v = r[pkCol.name]
      return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
    })
    const sql = `DELETE FROM ${tableName} WHERE ${pkCol.name} IN (${ids.join(', ')})`
    useEditorStore.getState().setSql(sql)
    await executeQuery(true)
    useEditorStore.getState().setSql(`SELECT * FROM ${tableName}`)
    await executeQuery(true)
    setSelected(new Set())
  }, [tableName, selectedRows, columns, executeQuery])

  const handleCopy = useCallback((format: 'csv' | 'json' | 'sql') => {
    const data = selectedRows.length > 0 ? selectedRows : rows
    let text: string
    if (format === 'csv') text = rowsToCsv(data, orderedColumns)
    else if (format === 'json') text = rowsToJson(data, orderedColumns)
    else text = rowsToSql(data, orderedColumns, tableName || 'table')
    navigator.clipboard.writeText(text)
  }, [selectedRows, rows, orderedColumns, tableName])

  const handleExport = useCallback((format: 'csv' | 'json' | 'sql') => {
    const data = selectedRows.length > 0 ? selectedRows : rows
    const name = tableName || 'export'
    if (format === 'csv') downloadBlob(rowsToCsv(data, orderedColumns), `${name}.csv`, 'text/csv')
    else if (format === 'json') downloadBlob(rowsToJson(data, orderedColumns), `${name}.json`, 'application/json')
    else downloadBlob(rowsToSql(data, orderedColumns, name), `${name}.sql`, 'text/sql')
  }, [selectedRows, rows, orderedColumns, tableName])

  const checkboxColW = 36
  const totalWidth = (isTableMode ? checkboxColW : 48) + orderedColumns.reduce((sum, col) => sum + getColWidth(col.name), 0)

  // ── Empty state ─────────────────────────
  if (status === 'idle' && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted bg-background">
        <TableIcon className="h-8 w-8 opacity-20" />
        <span className="text-xs">Les résultats apparaîtront ici</span>
        <span className="text-[11px] text-text-muted/60">Ctrl+Enter pour exécuter</span>
      </div>
    )
  }

  if (status === 'running' && rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground bg-background">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-xs">Exécution en cours...</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center h-full gap-2 px-6 bg-background">
        <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
        <span className="text-xs text-destructive">{error ?? 'Erreur inconnue'}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Status / Action bar */}
      <div className="flex items-center gap-2 h-8 px-3 border-b border-border-subtle bg-surface flex-shrink-0">
        {isTableMode && someSelected ? (
          /* ── Selection actions ── */
          <>
            <Button variant="outline" size="sm" className="h-6 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleDeleteSelected}>
              <Trash2 className="h-3 w-3" />
              Supprimer {selected.size} ligne{selected.size > 1 ? 's' : ''}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
                  <Copy className="h-3 w-3" />
                  Copy
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem className="text-xs" onClick={() => handleCopy('csv')}>Copy as CSV</DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => handleCopy('json')}>Copy as JSON</DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => handleCopy('sql')}>Copy as SQL</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
                  <Download className="h-3 w-3" />
                  Export
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem className="text-xs" onClick={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => handleExport('json')}>Export as JSON</DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => handleExport('sql')}>Export as SQL</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          /* ── Normal status bar ── */
          <>
            {status === 'done' && (
              <>
                <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {(totalCount ?? rowCount).toLocaleString('fr-FR')} ligne{(totalCount ?? rowCount) !== 1 ? 's' : ''}
                </span>
                <span className="text-[11px] text-text-muted tabular-nums">{durationMs} ms</span>
                {sortBy && (
                  <span className="text-[11px] text-primary tabular-nums">
                    ORDER BY {sortBy.column} {sortBy.direction.toUpperCase()}
                  </span>
                )}
              </>
            )}
            {status === 'running' && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="tabular-nums">{rows.length} lignes reçues...</span>
              </div>
            )}

            {/* Table-mode toolbar: Filter / Sort / Insert */}
            {isTableMode && status === 'done' && (
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant={showFilter ? 'default' : 'ghost'}
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => { setShowFilter(!showFilter); setShowSort(false) }}
                >
                  <Filter className="h-3 w-3" />
                  Filter
                  {filters.length > 0 && (
                    <span className="ml-0.5 bg-primary/20 text-primary rounded px-1 text-[10px]">{filters.length}</span>
                  )}
                </Button>
                <Button
                  variant={showSort ? 'default' : 'ghost'}
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => { setShowSort(!showSort); setShowFilter(false) }}
                >
                  <ArrowDownUp className="h-3 w-3" />
                  Sort
                </Button>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setInsertOpen(true)}>
                  <Plus className="h-3 w-3" />
                  Insert
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Filter panel */}
      {isTableMode && showFilter && (
        <FilterPanel columns={columns} filters={filters} setFilters={setFilters} onApply={handleApplyFilter} />
      )}

      {/* Sort panel */}
      {isTableMode && showSort && (
        <SortPanel
          columns={columns}
          sortCol={panelSortCol}
          setSortCol={setPanelSortCol}
          sortAsc={panelSortAsc}
          setSortAsc={setPanelSortAsc}
          onApply={handleApplySort}
        />
      )}

      {/* Table */}
      {orderedColumns.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div style={{ minWidth: totalWidth }}>
            {/* Sticky header */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedColumns.map((c) => c.name)} strategy={horizontalListSortingStrategy}>
                <div className="sticky top-0 z-10 flex border-b border-border-strong bg-surface-raised" style={{ height: 32 }}>
                  {/* Checkbox / row number header */}
                  <div className={cn('flex-shrink-0 flex items-center justify-center border-r border-border-subtle', isTableMode ? 'w-9' : 'w-12')}>
                    {isTableMode ? (
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        className="h-3.5 w-3.5"
                      />
                    ) : (
                      <span className="text-[10px] text-text-muted font-mono">#</span>
                    )}
                  </div>
                  {orderedColumns.map((col) => (
                    <SortableColumnHeader
                      key={col.name}
                      col={col}
                      width={getColWidth(col.name)}
                      sortBy={sortBy ?? null}
                      onSort={() => sortByColumn(col.name)}
                      onResize={(delta) => handleResize(col.name, delta)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Rows */}
            {rows.map((row, i) => (
              <div
                key={page * pageSize + i}
                className={cn(
                  'flex border-b border-border-subtle hover:bg-surface-raised/60 transition-colors',
                  i % 2 === 1 && 'bg-surface/30',
                  selected.has(i) && 'bg-primary/5 hover:bg-primary/10',
                )}
                style={{ height: 30 }}
              >
                <div className={cn('flex-shrink-0 flex items-center justify-center border-r border-border-subtle', isTableMode ? 'w-9' : 'w-12')}>
                  {isTableMode ? (
                    <Checkbox
                      checked={selected.has(i)}
                      onCheckedChange={() => toggleRow(i)}
                      className="h-3.5 w-3.5"
                    />
                  ) : (
                    <span className="text-[10px] text-text-muted font-mono tabular-nums">
                      {page * pageSize + i + 1}
                    </span>
                  )}
                </div>
                {orderedColumns.map((col) => {
                  const val = row?.[col.name]
                  return (
                    <div key={col.name} className="flex items-center px-3 border-r border-border-subtle flex-shrink-0 overflow-hidden" style={{ width: getColWidth(col.name) }}>
                      <span className="text-[12px] font-mono truncate">
                        {val === null ? (
                          <span className="text-text-muted italic">NULL</span>
                        ) : val === undefined ? (
                          <span className="text-text-muted/40">—</span>
                        ) : typeof val === 'object' ? (
                          <span className="text-muted-foreground">{JSON.stringify(val)}</span>
                        ) : (
                          <span className="text-foreground">{String(val)}</span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {(rows.length > 0 || page > 0) && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={total}
          onPage={goToPage}
          onPageSize={setResultPageSize}
          onRefresh={reloadTab}
        />
      )}

      {/* Insert Sheet (table mode only) */}
      {isTableMode && <InsertSheet open={insertOpen} onClose={() => setInsertOpen(false)} columns={columns} />}
    </div>
  )
}

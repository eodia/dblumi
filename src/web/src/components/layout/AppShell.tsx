import { useState, useEffect, useRef, useCallback } from 'react'
import { useThemeStore } from '@/stores/theme.store'
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  LayoutDashboard,
  Table2,
  TerminalSquare,
  Database,
  LogOut,
  ChevronsUpDown,
  Plus,
  Check,
  ChevronRight,
  ChevronDown,
  Key,
  Columns3,
  RefreshCw,
  Search,
  FileCode2,
  X,
  Play,
  Loader2,
  Save,
  Pencil,
  Trash2,
  MoreHorizontal,
  Sparkles,
  Languages,
  Eye,
  Braces,
  Settings2,
  Upload,
  FileUp,
  KeyRound,
  Sun,
  Moon,
  Monitor,
  Download,
  ArrowLeftRight,
} from 'lucide-react'
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import logoDark from '@/assets/logo-dblumi.svg'
import logoLight from '@/assets/logo-dblumi-light.svg'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { connectionsApi, type Connection, type SchemaTable, type SchemaFunction } from '@/api/connections'
import { savedQueriesApi } from '@/api/saved-queries'
import { useAuthStore } from '@/stores/auth.store'
import { useEditorStore } from '@/stores/editor.store'
import { SchemaSidebar } from '@/components/schema/SchemaSidebar'
import { SqlEditor } from '@/components/editor/SqlEditor'
import { ResultsTable } from '@/components/results/ResultsTable'
import { GuardrailModal } from '@/components/results/GuardrailModal'
import { ConnectionModal } from '@/components/connections/ConnectionModal'
import { SaveQueryModal } from '@/components/saved-queries/SaveQueryModal'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { SavedQueriesPanel } from '@/components/saved-queries/SavedQueriesPanel'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { CollabChat } from '@/components/editor/CollabChat'
import { AdminPage } from '@/components/admin/AdminPage'
import { OverviewPage } from '@/components/overview/OverviewPage'
import { TableStructureEditor } from '@/components/schema/TableStructureEditor'
import { SlideToConfirm } from '@/components/ui/slide-to-confirm'
import { ImportDialog } from '@/components/import/ImportDialog'
import { SyncDialog } from '@/components/sync/SyncDialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useDynamicHead } from '@/hooks/use-dynamic-head'

type NavPage = 'overview' | 'tables' | 'sql-editor' | 'admin'

const NAV_ITEMS = [
  { id: 'overview' as NavPage, labelKey: 'nav.overview' as const, icon: LayoutDashboard },
  { id: 'tables' as NavPage, labelKey: 'nav.tables' as const, icon: Table2 },
  { id: 'sql-editor' as NavPage, labelKey: 'nav.sqlEditor' as const, icon: TerminalSquare },
]

import { DriverIcon } from '@/components/ui/driver-icon'

function EnvBadge({ env }: { env: string }) {
  let cls = 'bg-muted text-muted-foreground border-border'
  switch (env.toLowerCase()) {
    case 'prod':    cls = 'bg-destructive/15 text-destructive border-destructive/30'; break
    case 'staging': cls = 'bg-warning/15 text-warning border-warning/30'; break
    case 'dev':     cls = 'bg-primary/15 text-primary border-primary/30'; break
    case 'local':   cls = 'bg-muted text-muted-foreground border-border'; break
  }
  return (
    <span className={cn('px-1 py-px rounded text-[9px] font-bold uppercase tracking-widest border leading-none', cls)}>
      {env}
    </span>
  )
}

// ── Schema tree (shown inline in sidebar when Tables is selected) ───────
function SchemaNav({ connectionId, onImport, onSync }: { connectionId: string; onImport: () => void; onSync: () => void }) {
  const { openTable, openFunction, activeConnectionId, executeQuery, setSql, setPendingCsvImport } = useEditorStore()
  const { isMobile, setOpenMobile } = useSidebar()
  const { t } = useI18n()
  const { data: connListData } = useQuery({ queryKey: ['connections'], queryFn: connectionsApi.list, staleTime: 5 * 60 * 1000 })
  const isProd = connListData?.connections.find((c) => c.id === connectionId)?.environment?.toLowerCase() === 'prod'
  const qcSchema = useQueryClient()
  const [tableSearch, setTableSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sectionsOpen, setSectionsOpen] = useState<{ tables: boolean; views: boolean; functions: boolean }>({ tables: true, views: true, functions: true })
  const [dropTarget, setDropTarget] = useState<{ name: string; type: 'table' | 'view' | 'function' | 'procedure' } | null>(null)
  const [structureTable, setStructureTable] = useState<SchemaTable | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const handleDump = useCallback(async (tables: string[], includeData: boolean) => {
    try {
      const sql = await connectionsApi.dump(connectionId, tables, includeData)
      const blob = new Blob([sql], { type: 'text/sql' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = tables.length === 1 ? `${tables[0]}.sql` : 'dump.sql'
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* toast could go here */ }
  }, [connectionId])

  const lc = tableSearch.toLowerCase()
  const tables: SchemaTable[] | undefined = data?.tables.filter(
    (t) =>
      t.name.toLowerCase().includes(lc) ||
      t.columns.some((c) => c.name.toLowerCase().includes(lc)),
  )
  const functions: SchemaFunction[] = (data?.functions ?? []).filter(
    (f) => f.name.toLowerCase().includes(lc),
  )

  const toggle = (name: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })

  return (
    <>
      {/* search + refresh — hidden when sidebar is collapsed */}
      <div className="group-data-[collapsible=icon]:hidden flex items-center gap-1 px-2 pt-1 pb-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted pointer-events-none" />
          <Input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder={t('common.filterTables')}
            className="h-6 pl-6 pr-2 text-xs"
          />
        </div>
        <button
          onClick={() => void refetch()}
          className="p-1 rounded text-text-muted hover:text-foreground hover:bg-sidebar-accent transition-colors"
        >
          <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* table + view list — hidden when sidebar is collapsed */}
      <div className="group-data-[collapsible=icon]:hidden overflow-y-auto flex-1 px-1 pb-2">
        {isLoading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {(() => {
          const onlyTables = tables?.filter((item) => item.type !== 'view') ?? []
          const onlyViews = tables?.filter((item) => item.type === 'view') ?? []

          const handleDrop = async () => {
            if (!dropTarget) return
            const typeMap: Record<string, string> = { table: 'TABLE', view: 'VIEW', function: 'FUNCTION', procedure: 'PROCEDURE' }
            const keyword = typeMap[dropTarget.type] ?? 'TABLE'
            setSql(`DROP ${keyword} ${dropTarget.name}`)
            await executeQuery(true)
            setSql('')
            qcSchema.invalidateQueries({ queryKey: ['schema', connectionId] })
            setDropTarget(null)
          }

          const renderItem = (item: SchemaTable) => {
            const isOpen = expanded.has(item.name)
            const isView = item.type === 'view'
            return (
              <ContextMenu key={item.name}>
                <ContextMenuTrigger asChild>
                  <div>
                    <div className="flex items-center gap-0 rounded-md text-[12px] text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                      <button onClick={() => toggle(item.name)} className="flex items-center justify-center w-6 h-7 flex-shrink-0 rounded-l-md">
                        {isOpen ? <ChevronDown className="h-3 w-3 text-text-muted" /> : <ChevronRight className="h-3 w-3 text-text-muted" />}
                      </button>
                      <button onClick={() => { void openTable(item.name); if (isMobile) setOpenMobile(false) }} className="flex-1 flex items-center gap-1.5 py-[5px] pr-1.5 min-w-0">
                        {isView ? <Eye className={cn('h-3 w-3 flex-shrink-0', isProd ? 'text-destructive/70' : 'text-blue-400/70')} /> : <Table2 className={cn('h-3 w-3 flex-shrink-0', isProd ? 'text-destructive/70' : 'text-primary/70')} />}
                        <span className="truncate font-mono">{item.name}</span>
                        <span className="ml-auto text-[10px] text-text-muted opacity-60 flex-shrink-0 tabular-nums">{item.columns.length}</span>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="ml-3 pl-2 border-l border-sidebar-border">
                        {item.columns.map((col) => (
                          <div key={col.name} className="flex items-center gap-1.5 px-1.5 py-[3px] text-[11px] text-text-muted hover:text-muted-foreground transition-colors">
                            {col.primaryKey ? <Key className="h-2.5 w-2.5 text-warning flex-shrink-0" /> : <Columns3 className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />}
                            <span className="truncate font-mono">{col.name}</span>
                            <span className="ml-auto text-[10px] opacity-40 font-mono flex-shrink-0">{col.dataType}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem className="gap-2 text-xs" onClick={() => { void openTable(item.name); if (isMobile) setOpenMobile(false) }}>
                    <Table2 className="h-3.5 w-3.5" />
                    {t('sq.open')}
                  </ContextMenuItem>
                  {!isView && (<>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="gap-2 text-xs" onClick={() => setStructureTable(item)}>
                      <Settings2 className="h-3.5 w-3.5" />
                      {t('table.modifyStructure')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="gap-2 text-xs" onClick={() => { void openTable(item.name); setPendingCsvImport(item.name) }}>
                      <Upload className="h-3.5 w-3.5" />
                      {t('table.importCsv')}
                    </ContextMenuItem>
                    <ContextMenuItem className="gap-2 text-xs" onClick={onImport}>
                      <FileUp className="h-3.5 w-3.5" />
                      {t('import.title')}
                    </ContextMenuItem>
                  </>)}
                  <ContextMenuSeparator />
                  <ContextMenuSub>
                    <ContextMenuSubTrigger className="gap-2 text-xs">
                      <Download className="h-3.5 w-3.5" />
                      {t('dump.table')}
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-44">
                      <ContextMenuItem className="text-xs" onClick={() => void handleDump([item.name], false)}>
                        {t('dump.structureOnly')}
                      </ContextMenuItem>
                      <ContextMenuItem className="text-xs" onClick={() => void handleDump([item.name], true)}>
                        {t('dump.structureAndData')}
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem className="gap-2 text-xs text-destructive focus:text-destructive"
                    onClick={() => setDropTarget({ name: item.name, type: isView ? 'view' : 'table' })}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('common.delete')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          }

          const toggleSection = (key: 'tables' | 'views' | 'functions') =>
            setSectionsOpen((s) => ({ ...s, [key]: !s[key] }))

          return (
            <>
              {/* Tables accordion */}
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div>
                    <div className="flex items-center gap-0 px-2 pt-2 pb-1">
                      <button onClick={() => toggleSection('tables')}
                        className="flex-1 flex items-center gap-1.5 hover:bg-sidebar-accent rounded-md transition-colors py-0.5">
                        {sectionsOpen.tables ? <ChevronDown className="h-3 w-3 text-text-muted" /> : <ChevronRight className="h-3 w-3 text-text-muted" />}
                        <Table2 className={cn('h-3 w-3', isProd ? 'text-destructive/50' : 'text-primary/50')} />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Tables</span>
                        <span className="text-[10px] text-text-muted/50 tabular-nums">{onlyTables.length}</span>
                      </button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={() => setStructureTable({ name: '', type: 'table', columns: [] })}
                            className="p-1 rounded text-text-muted hover:text-foreground hover:bg-sidebar-accent transition-colors">
                            <Plus className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{t('table.newTable')}</TooltipContent>
                      </Tooltip>
                    </div>
                    {sectionsOpen.tables && onlyTables.map(renderItem)}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem className="gap-2 text-xs" onClick={() => setStructureTable({ name: '', type: 'table', columns: [] })}>
                    <Plus className="h-3.5 w-3.5" />
                    {t('table.newTable')}
                  </ContextMenuItem>
                  <ContextMenuItem className="gap-2 text-xs" onClick={onImport}>
                    <FileUp className="h-3.5 w-3.5" />
                    {t('import.title')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem className="gap-2 text-xs" onClick={onSync}>
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    {t('sync.title')}
                  </ContextMenuItem>
                  {onlyTables.length > 0 && (<>
                    <ContextMenuSeparator />
                    <ContextMenuSub>
                      <ContextMenuSubTrigger className="gap-2 text-xs">
                        <Download className="h-3.5 w-3.5" />
                        {t('dump.allTables')}
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent className="w-44">
                        <ContextMenuItem className="text-xs" onClick={() => void handleDump(onlyTables.map((t) => t.name), false)}>
                          {t('dump.structureOnly')}
                        </ContextMenuItem>
                        <ContextMenuItem className="text-xs" onClick={() => void handleDump(onlyTables.map((t) => t.name), true)}>
                          {t('dump.structureAndData')}
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </>)}
                </ContextMenuContent>
              </ContextMenu>

              {/* Views accordion */}
              {onlyViews.length > 0 && (
                <div>
                  <button onClick={() => toggleSection('views')}
                    className="w-full flex items-center gap-1.5 px-2 pt-2 pb-1 hover:bg-sidebar-accent rounded-md transition-colors">
                    {sectionsOpen.views ? <ChevronDown className="h-3 w-3 text-text-muted" /> : <ChevronRight className="h-3 w-3 text-text-muted" />}
                    <Eye className={cn('h-3 w-3', isProd ? 'text-destructive/50' : 'text-blue-400/50')} />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Views</span>
                    <span className="text-[10px] text-text-muted/50 tabular-nums">{onlyViews.length}</span>
                  </button>
                  {sectionsOpen.views && onlyViews.map(renderItem)}
                </div>
              )}

              {/* Functions & Procedures accordion */}
              {functions.length > 0 && (
                <div>
                  <button onClick={() => toggleSection('functions')}
                    className="w-full flex items-center gap-1.5 px-2 pt-2 pb-1 hover:bg-sidebar-accent rounded-md transition-colors">
                    {sectionsOpen.functions ? <ChevronDown className="h-3 w-3 text-text-muted" /> : <ChevronRight className="h-3 w-3 text-text-muted" />}
                    <Braces className={cn('h-3 w-3', isProd ? 'text-destructive/50' : 'text-orange-400/50')} />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Functions</span>
                    <span className="text-[10px] text-text-muted/50 tabular-nums">{functions.length}</span>
                  </button>
                  {sectionsOpen.functions && functions.map((fn, idx) => (
                    <ContextMenu key={`${fn.kind}-${fn.name}-${idx}`}>
                      <ContextMenuTrigger asChild>
                        <button
                          onClick={async () => {
                            if (!activeConnectionId) return
                            try {
                              const res = await connectionsApi.getFunction(activeConnectionId, fn.name)
                              openFunction(res.function.name, res.function.source ?? '', res.function.params ?? [])
                            } catch { /* ignore */ }
                          }}
                          className="w-full flex items-center gap-1.5 px-1.5 py-[5px] ml-1 rounded-md text-[12px] text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                        >
                          <Braces className={cn('h-3 w-3 flex-shrink-0', fn.kind === 'procedure' ? 'text-purple-400/70' : isProd ? 'text-destructive/70' : 'text-orange-400/70')} />
                          <span className="truncate font-mono">{fn.name}</span>
                          <span className="ml-auto text-[10px] text-text-muted/40 font-mono flex-shrink-0 truncate max-w-[80px]">
                            {fn.kind === 'procedure' ? 'proc' : fn.return_type || 'fn'}
                          </span>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        <ContextMenuItem className="gap-2 text-xs" onClick={async () => {
                          if (!activeConnectionId) return
                          try {
                            const res = await connectionsApi.getFunction(activeConnectionId, fn.name)
                            openFunction(res.function.name, res.function.source ?? '', res.function.params ?? [])
                          } catch { /* ignore */ }
                        }}>
                          <Braces className="h-3.5 w-3.5" />
                          {t('sq.open')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="gap-2 text-xs text-destructive focus:text-destructive"
                          onClick={() => setDropTarget({ name: fn.name, type: fn.kind === 'procedure' ? 'procedure' : 'function' })}>
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('common.delete')}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              )}

              {onlyTables.length === 0 && onlyViews.length === 0 && functions.length === 0 && !isLoading && (
                <p className="px-3 py-2 text-xs text-text-muted">{t('common.noTableFound')}</p>
              )}

              {/* Drop confirmation dialog */}
              <Dialog open={dropTarget !== null} onOpenChange={(o) => { if (!o) setDropTarget(null) }}>
                <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
                  <DialogHeader>
                    <DialogTitle className="text-base">
                      {dropTarget?.type === 'view' ? 'DROP VIEW' : 'DROP TABLE'}
                    </DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    {dropTarget?.type === 'view'
                      ? <>{t('common.dropView')} <span className="font-semibold text-foreground font-mono">{dropTarget?.name}</span> {t('common.dropViewConfirm')}</>
                      : <>{t('common.dropTable')} <span className="font-semibold text-foreground font-mono">{dropTarget?.name}</span> {t('common.dropTableConfirm')}</>
                    }
                  </p>
                  <DialogFooter className="flex-col gap-2 sm:flex-col">
                    <SlideToConfirm
                      variant="destructive"
                      label={dropTarget?.type === 'view' ? 'DROP VIEW' : 'DROP TABLE'}
                      onConfirm={handleDrop}
                    />
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setDropTarget(null)}>{t('common.cancel')}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )
        })()}
      </div>

      {/* Table structure Sheet */}
      <Sheet open={structureTable !== null} onOpenChange={(o) => { if (!o) setStructureTable(null) }}>
        <SheetContent className="sm:max-w-2xl bg-card flex flex-col overflow-hidden">
          <SheetHeader>
            <SheetTitle>{t('table.modifyStructure')}</SheetTitle>
          </SheetHeader>
          {structureTable && (
            <TableStructureEditor
              table={structureTable}
              connectionId={activeConnectionId!}
              driver={(connListData?.connections.find((c) => c.id === connectionId)?.driver ?? 'postgresql') as 'postgresql' | 'mysql'}
              onClose={() => {
                setStructureTable(null)
                qcSchema.invalidateQueries({ queryKey: ['schema', connectionId] })
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}


// ── Sortable single tab ───────────────────────────────────────────────────
function SortableTab({
  tab,
  isActive,
  isProd,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToLeft,
  onCloseToRight,
  onCloseAll,
}: {
  tab: import('@/stores/editor.store').QueryTab
  isActive: boolean
  isProd?: boolean
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToLeft: () => void
  onCloseToRight: () => void
  onCloseAll: () => void
}) {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })
  const connCache = useQueryClient().getQueryData<{ connections: Connection[] }>(['connections'])
  const connColor = tab.connectionId ? connCache?.connections.find((c) => c.id === tab.connectionId)?.color ?? undefined : undefined

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
          className={cn(
            'group flex items-center gap-1.5 px-3 h-full text-xs border-r border-border-subtle select-none flex-shrink-0 transition-colors',
            isActive
              ? cn('bg-background text-foreground border-b-2 -mb-px', isProd ? 'border-b-destructive' : 'border-b-primary')
              : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised',
            isDragging && 'opacity-50',
          )}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose() } }}
        >
          <div
            {...attributes}
            {...listeners}
            onClick={onActivate}
            className="flex items-center gap-1.5 cursor-pointer"
          >
            {tab.kind === 'table' ? <Table2 className="h-3 w-3 flex-shrink-0 opacity-70" style={connColor ? { color: connColor } : undefined} />
              : tab.kind === 'function' ? <Braces className="h-3 w-3 flex-shrink-0 opacity-70" style={connColor ? { color: connColor } : undefined} />
              : <TerminalSquare className="h-3 w-3 flex-shrink-0 opacity-70" style={connColor ? { color: connColor } : undefined} />
            }
            <span className={cn('truncate max-w-[120px]', tab.kind === 'table' && 'font-mono')}>
              {tab.kind !== 'table' && tab.originalSql !== undefined && tab.sql !== tab.originalSql && <span className="text-muted-foreground mr-0.5">*</span>}{tab.name}
            </span>
            {tab.unreadChat > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
            )}
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="opacity-0 group-hover:opacity-100 rounded p-px hover:bg-surface-overlay text-text-muted hover:text-foreground transition-all"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onClose}>
          {t('tab.close')} <ContextMenuShortcut>Alt+W</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>{t('tab.closeOthers')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseToLeft}>{t('tab.closeLeft')}</ContextMenuItem>
        <ContextMenuItem onClick={onCloseToRight}>{t('tab.closeRight')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseAll} className="text-destructive focus:text-destructive">
          {t('tab.closeAll')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── Unified tab bar (query + table tabs together) ────────────────────────
function UnifiedTabBar({ onSave, onSaveAs, onToggleCopilot, copilotOpen }: { onSave: () => void; onSaveAs: () => void; onToggleCopilot: () => void; copilotOpen: boolean }) {
  const { t } = useI18n()
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, closeOthers, closeToLeft, closeToRight, closeAll, reorderTabs, executeQuery, executeSelection, selection, activeConnectionId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isRunning = activeTab?.result.status === 'running'
  const connCache = useQueryClient().getQueryData<{ connections: Connection[] }>(['connections'])
  const isProdEnv = connCache?.connections.find((c) => c.id === activeConnectionId)?.environment?.toLowerCase() === 'prod'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (over && active.id !== over.id) {
      reorderTabs(String(active.id), String(over.id))
    }
  }

  return (
    <div className="flex items-stretch h-9 border-b border-border-subtle bg-surface flex-shrink-0">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          <div
            className="flex items-stretch min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
            onWheel={(e) => {
              if (e.deltaY !== 0) {
                e.currentTarget.scrollLeft += e.deltaY
                e.preventDefault()
              }
            }}
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                isProd={isProdEnv}
                onActivate={() => setActiveTab(tab.id)}
                onClose={() => closeTab(tab.id)}
                onCloseOthers={() => closeOthers(tab.id)}
                onCloseToLeft={() => closeToLeft(tab.id)}
                onCloseToRight={() => closeToRight(tab.id)}
                onCloseAll={closeAll}
              />
            ))}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={addTab}
                  className="flex items-center justify-center px-2 text-text-muted hover:text-foreground hover:bg-surface-raised transition-colors flex-shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('tab.newTooltip')}</TooltipContent>
            </Tooltip>
          </div>
        </SortableContext>
      </DndContext>

      {/* Right-side actions */}
      <div className="flex items-center gap-1 px-2 border-l border-border-subtle flex-shrink-0">
        {!activeConnectionId && (
          <span className="text-[11px] text-text-muted hidden sm:block mr-1">{t('editor.selectConnection')}</span>
        )}
        {(activeTab?.kind === 'query' || activeTab?.kind === 'function') && (
          <div className="flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onSave}
                  className={cn('gap-1.5 h-6 px-2 text-xs', (activeTab.savedQueryId || activeTab.kind === 'function') && 'rounded-r-none')}>
                  <Save className="h-3 w-3" />
                  <span className="hidden sm:inline">{t('editor.save')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('editor.saveTooltip')}</TooltipContent>
            </Tooltip>
            {(activeTab.savedQueryId || activeTab.kind === 'function') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm"
                    className="h-6 w-6 p-0 rounded-l-none border-l border-border-subtle">
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="gap-2 text-xs" onClick={onSaveAs}>
                    <Save className="h-3.5 w-3.5" />
                    {t('editor.saveAs')}
                    <span className="ml-auto text-text-muted text-[10px]">{t('editor.saveAsTooltip')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {(activeTab?.kind === 'query' || activeTab?.kind === 'function') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={() => {
                  if (activeTab?.kind === 'function') {
                    const args = activeTab.functionParams.map((p) => {
                      if (p.value === '' || p.value.toUpperCase() === 'NULL') return 'NULL'
                      if (['int', 'integer', 'bigint', 'numeric', 'float', 'double'].some((t) => p.type.toLowerCase().includes(t))) return p.value
                      return `'${p.value.replace(/'/g, "''")}'`
                    }).join(', ')
                    void useEditorStore.getState().executeSql(`SELECT * FROM ${activeTab.name}(${args})`)
                  } else {
                    selection ? executeSelection() : executeQuery()
                  }
                }}
                disabled={!activeConnectionId || isRunning}
                className="gap-1.5 h-6 px-2.5 text-xs"
              >
                {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                <span className="hidden sm:inline">{selection ? t('editor.executeSelection') : t('editor.execute')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{activeConnectionId ? t('editor.executeTooltip') : t('editor.selectConnection')}</TooltipContent>
          </Tooltip>
        )}

        {/* Copilot toggle */}
        <div className="w-px h-4 bg-border-subtle" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={copilotOpen ? 'default' : 'ghost'}
              size="sm"
              onClick={onToggleCopilot}
              className="gap-1.5 h-6 px-2 text-xs"
            >
              <Sparkles className="h-3 w-3" />
              <span className="hidden sm:inline">{t('copilot.title')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('copilot.tooltip')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

// ── Unified editor area — tab bar + content ──────────────────────────────
// ── Function editor with parameters panel ───────────────────────────────
function FunctionEditor() {
  const { t } = useI18n()
  const { tabs, activeTabId, activeConnectionId, executeSql, setFunctionParams } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const params = activeTab?.functionParams ?? []
  const funcName = activeTab?.name ?? ''

  const updateParam = (i: number, value: string) => {
    const next = [...params]
    next[i] = { ...next[i]!, value }
    setFunctionParams(next)
  }

  const addParam = () => {
    setFunctionParams([...params, { name: `param_${params.length + 1}`, type: 'text', value: '' }])
  }

  const removeParam = (i: number) => {
    setFunctionParams(params.filter((_, j) => j !== i))
  }

  const buildFunctionSql = useCallback(() => {
    const args = params.map((p) => {
      if (p.value === '' || p.value.toUpperCase() === 'NULL') return 'NULL'
      if (p.type.toLowerCase().includes('int') || p.type.toLowerCase().includes('numeric') || p.type.toLowerCase().includes('float') || p.type.toLowerCase().includes('double')) {
        return p.value
      }
      return `'${p.value.replace(/'/g, "''")}'`
    }).join(', ')
    return `SELECT * FROM ${funcName}(${args})`
  }, [params, funcName])

  // Intercept Ctrl+Enter to execute function with params
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!activeConnectionId) return
        void executeSql(buildFunctionSql())
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeConnectionId, buildFunctionSql, executeSql])

  const updateParamType = (i: number, type: string) => {
    const next = [...params]
    next[i] = { ...next[i]!, type }
    setFunctionParams(next)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Parameters panel */}
      <div className="border-b border-border-subtle bg-surface px-3 py-2 space-y-2 flex-shrink-0">
        {params.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted font-mono min-w-[80px] truncate">{p.name}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-mono text-text-muted/70 gap-1 min-w-[70px] justify-between">
                  {p.type}
                  <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {['text', 'integer', 'bigint', 'numeric', 'boolean', 'date', 'timestamp', 'uuid', 'jsonb'].map((t) => (
                  <DropdownMenuItem key={t} className="text-xs font-mono" onClick={() => updateParamType(i, t)}>{t}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              value={p.value}
              onChange={(e) => updateParam(i, e.target.value)}
              placeholder="NULL"
              className="h-7 text-xs flex-1 min-w-[100px]"
            />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeParam(i)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addParam}>
            <Plus className="h-3 w-3" />
            {t('fn.addParam')}
          </Button>
        </div>
      </div>

      {/* SQL source (read-only view) */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SqlEditor />
      </div>
    </div>
  )
}

function UnifiedEditorArea({ onSaveNew, onSaveAs }: { onSaveNew: () => void; onSaveAs: () => void }) {
  const { t } = useI18n()
  const { tabs, activeTabId, activeConnectionId, addTab, closeTab, reloadTab } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const qcRef = useRef(useQueryClient())

  const handleSave = useCallback(() => {
    if (activeTab?.kind === 'function') {
      // Function → execute CREATE OR REPLACE to update in DB
      if (!activeConnectionId || !activeTab.sql.trim()) return
      useEditorStore.getState().executeSql(activeTab.sql).then(() => {
        qcRef.current.invalidateQueries({ queryKey: ['schema', activeConnectionId] })
        toast.success(t('sq.saved'))
      })
      return
    }
    if (activeTab?.kind !== 'query') return
    if (activeTab.savedQueryId) {
      savedQueriesApi.update(activeTab.savedQueryId, { sql: activeTab.sql }).then(() => {
        qcRef.current.invalidateQueries({ queryKey: ['saved-queries'] })
        useEditorStore.getState().markSaved()
        toast.success(t('sq.saved'))
      })
    } else {
      onSaveNew()
    }
  }, [activeTab, activeConnectionId, onSaveNew])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // Alt+N → new tab, Alt+W → close tab
      if (e.altKey && e.key === 'n') { e.preventDefault(); addTab(); return }
      if (e.altKey && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); return }

      if (!ctrl) return
      if (e.key === 's' || e.key === 'S') {
        if (activeTab?.kind !== 'query' && activeTab?.kind !== 'function') return
        e.preventDefault()
        if (e.shiftKey) {
          onSaveAs()
        } else {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab, activeTabId, activeConnectionId, handleSave, onSaveAs, reloadTab, closeTab, addTab])

  const [copilotOpen, setCopilotOpen] = useState(false)
  const chatOpen = useEditorStore((s) => s.chatOpen)
  const setChatOpen = useEditorStore((s) => s.setChatOpen)

  useEffect(() => {
    if (chatOpen) setCopilotOpen(false)
  }, [chatOpen])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <UnifiedTabBar onSave={handleSave} onSaveAs={onSaveAs} onToggleCopilot={() => {
        setCopilotOpen((o) => {
          if (!o) setChatOpen(false)
          return !o
        })
      }} copilotOpen={copilotOpen} />

      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" autoSaveId={(copilotOpen || chatOpen) ? 'dblumi-h-split' : 'dblumi-h'}>
          <ResizablePanel defaultSize={(copilotOpen || chatOpen) ? 70 : 100} minSize={40} id="main-area">
            {activeTab?.kind === 'query' && (
              <ResizablePanelGroup direction="vertical" autoSaveId="dblumi-v">
                <ResizablePanel defaultSize={50} minSize={20} id="editor">
                  <SqlEditor onSave={handleSave} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={15} id="results">
                  <ResultsTable />
                </ResizablePanel>
              </ResizablePanelGroup>
            )}

            {activeTab?.kind === 'table' && (
              <ResultsTable />
            )}

            {activeTab?.kind === 'function' && (
              <ResizablePanelGroup direction="vertical" autoSaveId="dblumi-fn-v">
                <ResizablePanel defaultSize={50} minSize={20} id="fn-editor">
                  <FunctionEditor />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={15} id="fn-results">
                  <ResultsTable />
                </ResizablePanel>
              </ResizablePanelGroup>
            )}

            {!activeTab && (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {t('editor.createOrExplore')}
              </div>
            )}
          </ResizablePanel>

          {(copilotOpen || chatOpen) && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={30} minSize={20} maxSize={50} id="right-panel">
                {copilotOpen && <CopilotPanel onClose={() => setCopilotOpen(false)} />}
                {chatOpen && !copilotOpen && (
                  <CollabChat
                    queryId={activeTab?.savedQueryId ?? ''}
                    queryName={activeTab?.name ?? ''}
                    onClose={() => setChatOpen(false)}
                  />
                )}
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

// ── Inner shell — needs useSidebar() which requires SidebarProvider ─────
// ── Database switcher (shown below connection selector) ──────────────────
function DatabaseSwitcher({ connectionId }: { connectionId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [selectedDb, setSelectedDb] = useState<string>('')
  const [dbSearch, setDbSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newDbName, setNewDbName] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['databases', connectionId],
    queryFn: () => connectionsApi.databases(connectionId),
    staleTime: 60 * 1000,
  })

  const handleSwitch = async (db: string) => {
    if (db === selectedDb) return
    await connectionsApi.switchDatabase(connectionId, db)
    setSelectedDb(db)
    setDbSearch('')
    qc.invalidateQueries({ queryKey: ['schema', connectionId] })
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => connectionsApi.createDatabase(connectionId, name),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ['databases', connectionId] })
      await handleSwitch(data.name)
      toast.success(t('db.createSuccess', { name: data.name }))
      setCreateOpen(false)
      setNewDbName('')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('db.createError'))
    },
  })

  const databases = data?.databases ?? []
  const displayDb = selectedDb || databases[0] || 'default'
  const lc = dbSearch.toLowerCase()
  const filtered = lc ? databases.filter((db) => db.toLowerCase().includes(lc)) : databases

  return (
    <div className="group-data-[collapsible=icon]:hidden px-3 pb-1">
      <DropdownMenu onOpenChange={(open) => { if (!open) setDbSearch('') }}>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors">
            <Database className="h-3 w-3 flex-shrink-0 opacity-50" />
            <span className="font-mono truncate">{displayDb}</span>
            <ChevronDown className="h-3 w-3 ml-auto flex-shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <div className="px-2 py-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted pointer-events-none" />
              <Input
                value={dbSearch}
                onChange={(e) => setDbSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t('conn.search')}
                className="h-7 pl-7 pr-2 text-xs"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {isLoading && (
              <div className="px-2 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <RefreshCw className="h-3 w-3 animate-spin" /> {t('common.loading')}
              </div>
            )}
            {filtered.map((db) => (
              <DropdownMenuItem key={db} className="gap-2 text-xs font-mono cursor-pointer" onClick={() => handleSwitch(db)}>
                {db}
                {db === displayDb && <Check className="h-3 w-3 ml-auto text-primary" />}
              </DropdownMenuItem>
            ))}
            {filtered.length === 0 && !isLoading && (
              <div className="px-2 py-2 text-xs text-muted-foreground text-center">{t('table.noResults')}</div>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={() => { setNewDbName(''); setCreateOpen(true) }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('db.createTooltip')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xs bg-card border-border-subtle">
          <DialogHeader>
            <DialogTitle className="text-base">{t('db.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              placeholder={t('db.createPlaceholder')}
              className="text-sm font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newDbName.trim()) createMutation.mutate(newDbName.trim())
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button
              size="sm"
              disabled={!newDbName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(newDbName.trim())}
            >
              {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {t('db.createConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AppShellInner({
  connections,
  page,
  setPage,
  saveOpen,
  setSaveOpen,
  connModalOpen,
  setConnModalOpen,
}: {
  connections: Connection[]
  page: NavPage
  setPage: (p: NavPage) => void
  saveOpen: boolean
  setSaveOpen: (v: boolean) => void
  connModalOpen: boolean
  setConnModalOpen: (v: boolean) => void
}) {
  const { user, logout: rawLogout } = useAuthStore()
  const { activeConnectionId, setActiveConnection } = useEditorStore()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const isCollapsed = state === 'collapsed'
  const { t, locale, setLocale } = useI18n()
  const theme = useThemeStore((s) => s.theme)
  const preference = useThemeStore((s) => s.preference)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const qc = useQueryClient()

  const logout = useCallback(async () => {
    await rawLogout()
    qc.clear()
    setActiveConnection(null)
  }, [rawLogout, qc, setActiveConnection])

  const [connSearch, setConnSearch] = useState('')
  const [editingConn, setEditingConn] = useState<Connection | undefined>()
  const [deleteConfirmConn, setDeleteConfirmConn] = useState<Connection | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => connectionsApi.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      if (activeConnectionId === id) setActiveConnection(null)
      setDeleteConfirmConn(null)
    },
  })

  const active = connections.find((c) => c.id === activeConnectionId)
  const filteredConns = connSearch
    ? connections.filter(
        (c) =>
          c.name.toLowerCase().includes(connSearch.toLowerCase()) ||
          c.database.toLowerCase().includes(connSearch.toLowerCase()),
      )
    : connections

  return (
    <>
      <Sidebar collapsible="icon">
        {/* ═══ Header — Connection switcher ═══ */}
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    {active ? (
                      <>
                        <DriverIcon driver={active.driver} environment={active.environment} />
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-semibold">
                            {active.name}
                          </span>
                          <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            {active.environment && <EnvBadge env={active.environment} />}
                            {active.database}@{active.host}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-overlay text-text-muted flex-shrink-0">
                          <Database className="h-3.5 w-3.5" />
                        </span>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-semibold text-muted-foreground">
                            {t('conn.none')}
                          </span>
                          <span className="truncate text-xs text-text-muted">
                            {t('conn.selectOrCreate')}
                          </span>
                        </div>
                      </>
                    )}
                    <ChevronsUpDown className="ml-auto flex-shrink-0" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                  className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
                  align="start"
                  sideOffset={4}
                >
                  {/* Search input */}
                  {connections.length > 0 && (
                    <div className="px-2 py-1.5">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                        <Input
                          value={connSearch}
                          onChange={(e) => setConnSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          placeholder={t('conn.search')}
                          className="h-7 pl-7 pr-2 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t('conn.label')}
                  </DropdownMenuLabel>

                  {filteredConns.map((conn) => (
                    <div key={conn.id} className="group/conn relative">
                      <DropdownMenuItem
                        onClick={() => setActiveConnection(conn.id)}
                        className={cn(
                          'gap-2 cursor-pointer group-hover/conn:bg-black/20',
                          conn.id === activeConnectionId && 'border border-primary/60',
                        )}
                      >
                        <span className="flex-shrink-0">
                          <DriverIcon driver={conn.driver} environment={conn.environment} />
                        </span>
                        <span className="flex-1 truncate text-sm">{conn.name}</span>
                        {conn.environment && (
                          <span className="ml-auto group-hover/conn:opacity-0 transition-opacity">
                            <EnvBadge env={conn.environment} />
                          </span>
                        )}
                      </DropdownMenuItem>
                      {(conn.createdBy === user?.id || user?.role === 'admin') && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/conn:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingConn(conn)
                              setConnModalOpen(true)
                            }}
                            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteConfirmConn(conn)
                            }}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {filteredConns.length === 0 && connSearch && (
                    <div className="px-2 py-2 text-xs text-muted-foreground text-center">
                      {t('conn.none')}
                    </div>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setConnModalOpen(true)} className="gap-2 cursor-pointer">
                    <Plus className="h-4 w-4" />
                    <span className="text-sm">{t('conn.new')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* ═══ Database switcher — only for server-level connections (no database configured) ═══ */}
        {activeConnectionId && active && !active.database && (
          <DatabaseSwitcher connectionId={activeConnectionId} />
        )}

        {/* ═══ Content — Navigation + inline schema/queries ═══ */}
        <SidebarContent className="overflow-hidden">
          {/* Nav items */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={page === item.id}
                      onClick={() => setPage(item.id)}
                      tooltip={t(item.labelKey)}
                    >
                      <item.icon />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* ── Tables: schema tree inline ── */}
          {page === 'tables' && activeConnectionId && (
            <SidebarGroup className="flex-1 min-h-0 overflow-hidden">
              <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
                {t('common.schema')}
              </SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <SchemaNav connectionId={activeConnectionId} onImport={() => setImportOpen(true)} onSync={() => setSyncOpen(true)} />
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {page === 'tables' && !activeConnectionId && (
            <div className="group-data-[collapsible=icon]:hidden px-4 py-3 text-xs text-text-muted">
              {t('editor.selectConnection')}
            </div>
          )}

          {/* ── SQL Editor: saved queries inline ── */}
          {page === 'sql-editor' && (
            <SidebarGroup className="flex-1 min-h-0 overflow-hidden">
              <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden flex items-center justify-between">
                {t('sq.title')}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => useEditorStore.getState().addTab()}
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t('tab.new')}</TooltipContent>
                </Tooltip>
              </SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <SavedQueriesPanel />
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        {/* ═══ Footer — User ═══ */}
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary flex-shrink-0">
                      {user?.name?.charAt(0).toUpperCase() ?? '?'}
                    </span>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{user?.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
                  side="top"
                  align="start"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    <div>{user?.email}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">{t(`user.role.${user?.role ?? 'viewer'}` as 'user.role.admin')}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2 cursor-pointer">
                      <Languages className="h-4 w-4" />
                      {t('user.language')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => setLocale('fr')} className="gap-2 cursor-pointer">
                        🇫🇷 {t('user.french')}
                        {locale === 'fr' && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocale('en')} className="gap-2 cursor-pointer">
                        🇬🇧 {t('user.english')}
                        {locale === 'en' && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2 cursor-pointer">
                      {preference === 'system' ? <Monitor className="h-4 w-4" /> : theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                      {t('user.theme')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => setTheme('system')} className="gap-2 cursor-pointer">
                        <Monitor className="h-4 w-4" />
                        {t('user.theme.system')}
                        {preference === 'system' && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTheme('dark')} className="gap-2 cursor-pointer">
                        <Moon className="h-4 w-4" />
                        {t('user.theme.dark')}
                        {preference === 'dark' && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTheme('light')} className="gap-2 cursor-pointer">
                        <Sun className="h-4 w-4" />
                        {t('user.theme.light')}
                        {preference === 'light' && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {user?.hasPassword && (
                    <DropdownMenuItem onClick={() => setChangePasswordOpen(true)} className="gap-2 cursor-pointer">
                      <KeyRound className="h-4 w-4" />
                      {t('auth.changePassword.title')}
                    </DropdownMenuItem>
                  )}
                  {user?.role === 'admin' && (
                    <DropdownMenuItem onClick={() => setPage('admin')} className="gap-2 cursor-pointer">
                      <Settings2 className="h-4 w-4" />
                      {t('admin.title')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="gap-2 cursor-pointer">
                    <LogOut className="h-4 w-4" />
                    {t('auth.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      {/* ═══ Main content area ═══ */}
      <SidebarInset className="min-w-0 overflow-hidden h-svh flex flex-col">
        {/* Top bar */}
        <header className="flex items-center h-10 px-3 gap-2 border-b border-border-subtle flex-shrink-0">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <img src={theme === 'light' ? logoLight : logoDark} alt="dblumi" className="h-5" />
        </header>

        {/* Page content */}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          {page === 'admin' && user?.role === 'admin' ? (
            <AdminPage />
          ) : page === 'overview' ? (
            <OverviewPage onNavigate={setPage} />
          ) : (
            <TooltipProvider delayDuration={300}>
              <UnifiedEditorArea onSaveNew={() => setSaveOpen(true)} onSaveAs={() => setSaveOpen(true)} />
            </TooltipProvider>
          )}
        </div>

        {/* Command palette */}
        <CommandPalette
          connections={connections}
          onSaveNew={() => setSaveOpen(true)}
          onSaveAs={() => setSaveOpen(true)}
          onNewConnection={() => setConnModalOpen(true)}
          onImport={() => setImportOpen(true)}
          onSync={() => setSyncOpen(true)}
          setPage={setPage}
        />

        {/* Modals */}
        <GuardrailModal />
        {saveOpen && <SaveQueryModal onClose={() => setSaveOpen(false)} />}
        <ConnectionModal
          key={editingConn?.id ?? 'new'}
          open={connModalOpen}
          onClose={() => { setConnModalOpen(false); setEditingConn(undefined) }}
          editing={editingConn}
        />
        {activeConnectionId && (
          <ImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            connectionId={activeConnectionId}
            onComplete={() => {
              qc.invalidateQueries({ queryKey: ['schema', activeConnectionId] })
            }}
          />
        )}
        <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} />

        {/* Delete connection confirmation */}
        <Dialog open={deleteConfirmConn !== null} onOpenChange={(o) => { if (!o) setDeleteConfirmConn(null) }}>
          <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
            <DialogHeader>
              <DialogTitle className="text-base">{t('conn.delete')}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t('conn.deleteAction')} <span className="font-semibold text-foreground">{deleteConfirmConn?.name}</span> ?
              {t('conn.deleteConfirm')}
            </p>
            <div className="pt-2">
              <SlideToConfirm
                label={t('admin.slideToDelete')}
                confirmLabel={t('common.delete')}
                variant="destructive"
                disabled={deleteMutation.isPending}
                onConfirm={() => deleteConfirmConn && deleteMutation.mutate(deleteConfirmConn.id)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmConn(null)}>
                {t('common.cancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </>
  )
}

// ── Root export ─────────────────────────────────────────────────────────
export function AppShell() {
  useDynamicHead()
  const [page, setPage] = useState<NavPage>('sql-editor')
  const [saveOpen, setSaveOpen] = useState(false)
  const [connModalOpen, setConnModalOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
  })
  const connections = data?.connections ?? []

  return (
    <SidebarProvider>
      <AppShellInner
        connections={connections}
        page={page}
        setPage={setPage}
        saveOpen={saveOpen}
        setSaveOpen={setSaveOpen}
        connModalOpen={connModalOpen}
        setConnModalOpen={setConnModalOpen}
      />
    </SidebarProvider>
  )
}

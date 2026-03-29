import { useState, useEffect } from 'react'
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
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
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
import { connectionsApi, type Connection, type SchemaTable } from '@/api/connections'
import { savedQueriesApi } from '@/api/saved-queries'
import { useAuthStore } from '@/stores/auth.store'
import { useEditorStore } from '@/stores/editor.store'
import { SchemaSidebar } from '@/components/schema/SchemaSidebar'
import { SqlEditor } from '@/components/editor/SqlEditor'
import { ResultsTable } from '@/components/results/ResultsTable'
import { GuardrailModal } from '@/components/results/GuardrailModal'
import { ConnectionModal } from '@/components/connections/ConnectionModal'
import { SaveQueryModal } from '@/components/saved-queries/SaveQueryModal'
import { SavedQueriesPanel } from '@/components/saved-queries/SavedQueriesPanel'
import { cn } from '@/lib/utils'

type NavPage = 'overview' | 'tables' | 'sql-editor'

const NAV_ITEMS: { id: NavPage; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Project Overview', icon: LayoutDashboard },
  { id: 'tables', label: 'Tables', icon: Table2 },
  { id: 'sql-editor', label: 'SQL Editor', icon: TerminalSquare },
]

function DriverIcon({ driver }: { driver: string }) {
  if (driver === 'postgresql') return <span className="text-xs">🐘</span>
  return <span className="text-xs">🐬</span>
}

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
function SchemaNav({ connectionId }: { connectionId: string }) {
  const { openTable } = useEditorStore()
  const { isMobile, setOpenMobile } = useSidebar()
  const [tableSearch, setTableSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const lc = tableSearch.toLowerCase()
  const tables: SchemaTable[] | undefined = data?.tables.filter(
    (t) =>
      t.name.toLowerCase().includes(lc) ||
      t.columns.some((c) => c.name.toLowerCase().includes(lc)),
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
      <div className="group-data-[collapsible=icon]:hidden flex items-center gap-1 px-2 pb-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted pointer-events-none" />
          <Input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Filtrer les tables..."
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

      {/* table list — hidden when sidebar is collapsed */}
      <div className="group-data-[collapsible=icon]:hidden overflow-y-auto flex-1 px-1 pb-2">
        {isLoading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Chargement...
          </div>
        )}

        {tables?.map((table) => {
          const isOpen = expanded.has(table.name)
          return (
            <div key={table.name}>
              <div className="flex items-center gap-0 rounded-md text-[12px] text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                {/* Arrow — toggles expand only */}
                <button
                  onClick={() => toggle(table.name)}
                  className="flex items-center justify-center w-6 h-7 flex-shrink-0 rounded-l-md"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 text-text-muted" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-text-muted" />
                  )}
                </button>
                {/* Table name — opens the tab */}
                <button
                  onClick={() => { void openTable(table.name); if (isMobile) setOpenMobile(false) }}
                  className="flex-1 flex items-center gap-1.5 py-[5px] pr-1.5 min-w-0"
                >
                  <Table2 className="h-3 w-3 flex-shrink-0 text-primary/70" />
                  <span className="truncate font-mono">{table.name}</span>
                  <span className="ml-auto text-[10px] text-text-muted opacity-60 flex-shrink-0 tabular-nums">
                    {table.columns.length}
                  </span>
                </button>
              </div>

              {isOpen && (
                <div className="ml-3 pl-2 border-l border-sidebar-border">
                  {table.columns.map((col) => (
                    <div
                      key={col.name}
                      className="flex items-center gap-1.5 px-1.5 py-[3px] text-[11px] text-text-muted hover:text-muted-foreground transition-colors"
                    >
                      {col.primaryKey ? (
                        <Key className="h-2.5 w-2.5 text-warning flex-shrink-0" />
                      ) : (
                        <Columns3 className="h-2.5 w-2.5 opacity-30 flex-shrink-0" />
                      )}
                      <span className="truncate font-mono">{col.name}</span>
                      <span className="ml-auto text-[10px] opacity-40 font-mono flex-shrink-0">
                        {col.dataType}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {tables?.length === 0 && !isLoading && (
          <p className="px-3 py-2 text-xs text-text-muted">Aucune table trouvée.</p>
        )}
      </div>
    </>
  )
}



// ── Sortable single tab ───────────────────────────────────────────────────
function SortableTab({
  tab,
  isActive,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToLeft,
  onCloseToRight,
  onCloseAll,
}: {
  tab: import('@/stores/editor.store').QueryTab
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToLeft: () => void
  onCloseToRight: () => void
  onCloseAll: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
          className={cn(
            'group flex items-center gap-1.5 px-3 h-full text-xs border-r border-border-subtle select-none flex-shrink-0 transition-colors',
            isActive
              ? 'bg-background text-foreground border-b-2 border-b-primary -mb-px'
              : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised',
            isDragging && 'opacity-50',
          )}
        >
          <div
            {...attributes}
            {...listeners}
            onClick={onActivate}
            className="flex items-center gap-1.5 cursor-pointer"
          >
            {tab.kind === 'table'
              ? <Table2 className="h-3 w-3 flex-shrink-0 opacity-60" />
              : <TerminalSquare className="h-3 w-3 flex-shrink-0 opacity-60" />
            }
            <span className={cn('truncate max-w-[120px]', tab.kind === 'table' && 'font-mono')}>
              {tab.name}
            </span>
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
          Close <ContextMenuShortcut>Ctrl+W</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>Close Others</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseToLeft}>Close to the Left</ContextMenuItem>
        <ContextMenuItem onClick={onCloseToRight}>Close to the Right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseAll} className="text-destructive focus:text-destructive">
          Close All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── Unified tab bar (query + table tabs together) ────────────────────────
function UnifiedTabBar({ onSave }: { onSave: () => void }) {
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, closeOthers, closeToLeft, closeToRight, closeAll, reorderTabs, executeQuery, activeConnectionId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isRunning = activeTab?.result.status === 'running'

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
    <div className="flex items-stretch h-9 border-b border-border-subtle bg-surface flex-shrink-0 overflow-x-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex items-stretch min-w-0 flex-1">
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
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
              <TooltipContent>Nouvelle requête</TooltipContent>
            </Tooltip>
          </div>
        </SortableContext>
      </DndContext>

      {/* Right-side actions */}
      <div className="flex items-center gap-1 px-2 border-l border-border-subtle flex-shrink-0">
        {!activeConnectionId && (
          <span className="text-[11px] text-text-muted hidden sm:block mr-1">Sélectionnez une connexion</span>
        )}
        {activeTab?.kind === 'query' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onSave} className="gap-1.5 h-6 px-2 text-xs">
                <Save className="h-3 w-3" />
                <span className="hidden sm:inline">Sauvegarder</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sauvegarder · Ctrl+S</TooltipContent>
          </Tooltip>
        )}
        {activeTab?.kind === 'query' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={() => executeQuery()}
                disabled={!activeConnectionId || isRunning}
                className="gap-1.5 h-6 px-2.5 text-xs"
              >
                {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                <span className="hidden sm:inline">Exécuter</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{activeConnectionId ? 'Ctrl+Enter' : 'Sélectionnez une connexion'}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

// ── Unified editor area — tab bar + content ──────────────────────────────
function UnifiedEditorArea({ onSave }: { onSave: () => void }) {
  const { tabs, activeTabId, activeConnectionId, addTab, closeTab, reloadTab } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return

      if (e.key === 's') {
        if (activeTab?.kind === 'query') { e.preventDefault(); onSave() }
      } else if (e.key === 'w') {
        e.preventDefault(); closeTab(activeTabId)
      } else if (e.key === 't') {
        e.preventDefault(); addTab()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab, activeTabId, activeConnectionId, onSave, reloadTab, closeTab, addTab])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <UnifiedTabBar onSave={onSave} />

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab?.kind === 'query' && (
          <ResizablePanelGroup direction="vertical" autoSaveId="dblumi-v">
            <ResizablePanel defaultSize={50} minSize={20} id="editor">
              <SqlEditor onSave={onSave} />
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

        {!activeTab && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Créez une requête ou explorez une table
          </div>
        )}
      </div>
    </div>
  )
}

// ── Inner shell — needs useSidebar() which requires SidebarProvider ─────
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
  const { user, logout } = useAuthStore()
  const { activeConnectionId, setActiveConnection } = useEditorStore()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const isCollapsed = state === 'collapsed'
  const qc = useQueryClient()

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
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-md text-xs flex-shrink-0"
                          style={{
                            backgroundColor: (active.color ?? '#71717A') + '20',
                            color: active.color ?? '#71717A',
                          }}
                        >
                          <DriverIcon driver={active.driver} />
                        </span>
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
                            Aucune connexion
                          </span>
                          <span className="truncate text-xs text-text-muted">
                            Sélectionnez ou créez
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
                  {connections.length > 3 && (
                    <div className="px-2 py-1.5">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                        <Input
                          value={connSearch}
                          onChange={(e) => setConnSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          placeholder="Rechercher..."
                          className="h-7 pl-7 pr-2 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Connexions
                  </DropdownMenuLabel>

                  {filteredConns.map((conn) => (
                    <div key={conn.id} className="group/conn relative">
                      <DropdownMenuItem
                        onClick={() => setActiveConnection(conn.id)}
                        className="gap-2 cursor-pointer pr-8"
                      >
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded text-[10px] flex-shrink-0"
                          style={{ backgroundColor: (conn.color ?? '#71717A') + '20' }}
                        >
                          <DriverIcon driver={conn.driver} />
                        </span>
                        <span className="flex-1 truncate text-sm">{conn.name}</span>
                        {conn.environment && <EnvBadge env={conn.environment} />}
                        {conn.id === activeConnectionId && (
                          <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        )}
                      </DropdownMenuItem>
                      {/* Edit / Delete actions */}
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
                    </div>
                  ))}

                  {filteredConns.length === 0 && connSearch && (
                    <div className="px-2 py-2 text-xs text-muted-foreground text-center">
                      Aucun résultat
                    </div>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setConnModalOpen(true)}
                    className="gap-2 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="text-sm">Nouvelle connexion</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

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
                      tooltip={item.label}
                    >
                      <item.icon />
                      <span>{item.label}</span>
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
                Schema
              </SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <SchemaNav connectionId={activeConnectionId} />
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {page === 'tables' && !activeConnectionId && (
            <div className="group-data-[collapsible=icon]:hidden px-4 py-3 text-xs text-text-muted">
              Sélectionnez une connexion pour voir les tables.
            </div>
          )}

          {/* ── SQL Editor: saved queries inline ── */}
          {page === 'sql-editor' && (
            <SidebarGroup className="flex-1 min-h-0 overflow-hidden">
              <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
                Requêtes sauvegardées
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
                    {user?.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="gap-2 cursor-pointer">
                    <LogOut className="h-4 w-4" />
                    Se déconnecter
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
          <span className="text-sm font-extrabold tracking-tight">
            db<span className="text-primary glow-primary">lumi</span>
          </span>
          {active && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: active.color ?? '#71717A' }}
                />
                <span className="font-mono text-foreground">{active.name}</span>
                <span className="text-text-muted">·</span>
                <span className="font-mono">{active.database}</span>
                {active.environment && <EnvBadge env={active.environment} />}
              </div>
            </>
          )}
        </header>

        {/* Page content */}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          {page === 'overview' && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Project Overview — à venir
            </div>
          )}

          {/* Tables collapsed (desktop only): full schema page */}
          {page === 'tables' && isCollapsed && !isMobile && (
            <SchemaSidebar connections={connections} />
          )}

          {/* Unified editor area: sql-editor, tables expanded, or mobile (sidebar overlays) */}
          {(page === 'sql-editor' || (page === 'tables' && (!isCollapsed || isMobile))) && (
            <TooltipProvider delayDuration={300}>
              <UnifiedEditorArea onSave={() => setSaveOpen(true)} />
            </TooltipProvider>
          )}
        </div>

        {/* Modals */}
        <GuardrailModal />
        {saveOpen && <SaveQueryModal onClose={() => setSaveOpen(false)} />}
        <ConnectionModal
          key={editingConn?.id ?? 'new'}
          open={connModalOpen}
          onClose={() => { setConnModalOpen(false); setEditingConn(undefined) }}
          editing={editingConn}
        />

        {/* Delete connection confirmation */}
        <Dialog open={deleteConfirmConn !== null} onOpenChange={(o) => { if (!o) setDeleteConfirmConn(null) }}>
          <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
            <DialogHeader>
              <DialogTitle className="text-base">Supprimer la connexion</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Supprimer <span className="font-semibold text-foreground">{deleteConfirmConn?.name}</span> ?
              Les requêtes sauvegardées liées à cette connexion perdront leur association.
            </p>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmConn(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteConfirmConn && deleteMutation.mutate(deleteConfirmConn.id)}
              >
                {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Supprimer'}
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

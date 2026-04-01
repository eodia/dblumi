import { useState } from 'react'
import { useI18n } from '@/i18n'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  ChevronRight,
  ChevronDown,
  Table2,
  Key,
  Columns3,
  Plus,
  Search,
  RefreshCw,
  Settings2,
  Database,
  Pencil,
  Trash2,
  Unplug,
  Copy,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { connectionsApi, type Connection, type SchemaTable } from '@/api/connections'
import { useEditorStore } from '@/stores/editor.store'
import { ConnectionModal } from '@/components/connections/ConnectionModal'
import { cn } from '@/lib/utils'

type Props = { connections: Connection[] }

import { DriverIcon } from '@/components/ui/driver-icon'

export function SchemaSidebar({ connections }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { activeConnectionId, setActiveConnection, setSql } = useEditorStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState<Connection | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => connectionsApi.delete(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      if (activeConnectionId === id) setActiveConnection(null)
      setDeleteTarget(null)
    },
  })

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  const { data: schema, isLoading, error, refetch } = useQuery({
    queryKey: ['schema', activeConnectionId],
    queryFn: () => connectionsApi.schema(activeConnectionId!),
    enabled: !!activeConnectionId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const toggle = (name: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })

  const lc = search.toLowerCase()
  const tables: SchemaTable[] | undefined = schema?.tables.filter(
    (t) =>
      t.name.toLowerCase().includes(lc) ||
      t.columns.some((c) => c.name.toLowerCase().includes(lc)),
  )

  const handleSelectAll = (tableName: string) => {
    setSql(`SELECT * FROM ${tableName} LIMIT 100;`)
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex flex-col h-full bg-surface border-r border-border-subtle select-none">
        {/* ── Connections section ─────────────── */}
        <div className="px-2 pt-3 pb-1">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Connexions
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    setEditingConn(undefined)
                    setModalOpen(true)
                  }}
                  className="p-1 rounded-md text-text-muted hover:text-foreground hover:bg-surface-overlay transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Nouvelle connexion</TooltipContent>
            </Tooltip>
          </div>

          <div className="space-y-0.5">
            {connections.map((conn) => (
              <ContextMenu key={conn.id}>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={() => setActiveConnection(conn.id)}
                    className={cn(
                      'group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors',
                      activeConnectionId === conn.id
                        ? 'bg-surface-overlay text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised',
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: conn.color ?? '#71717A' }}
                    />
                    <DriverIcon driver={conn.driver} />
                    <span className="truncate flex-1 text-[13px]">{conn.name}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingConn(conn)
                        setModalOpen(true)
                      }}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-overlay text-text-muted hover:text-foreground transition-all cursor-pointer"
                    >
                      <Settings2 className="h-3 w-3" />
                    </span>
                  </button>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    className="gap-2 text-xs"
                    onClick={() => {
                      setEditingConn(conn)
                      setModalOpen(true)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Modifier
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="gap-2 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${conn.driver}://${conn.username}@${conn.host}:${conn.port}/${conn.database}`,
                      )
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copier la connection string
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="gap-2 text-xs"
                    onClick={() => {
                      setSql(`SELECT * FROM information_schema.tables WHERE table_schema = 'public' LIMIT 50;`)
                      setActiveConnection(conn.id)
                    }}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    Lister les tables
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="gap-2 text-xs text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(conn)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}

            {connections.length === 0 && (
              <button
                onClick={() => {
                  setEditingConn(undefined)
                  setModalOpen(true)
                }}
                className="w-full flex items-center gap-2 px-2 py-3 rounded-md text-sm text-text-muted hover:text-foreground hover:bg-surface-raised transition-colors border border-dashed border-border-strong"
              >
                <Database className="h-4 w-4" />
                Ajouter une connexion
              </button>
            )}
          </div>
        </div>

        <Separator className="my-1 bg-border-subtle" />

        {/* ── Schema section ──────────────────── */}
        {activeConnectionId && (
          <>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
                Schema
              </span>
              {activeConn && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-text-muted truncate max-w-16 font-mono">
                    {activeConn.database}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => refetch()}
                        className="p-0.5 rounded text-text-muted hover:text-foreground hover:bg-surface-overlay transition-colors"
                      >
                        <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Actualiser le schema</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>

            {/* Search */}
            <div className="px-2 pb-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('common.filterTables')}
                  className="h-7 pl-7 pr-2 text-xs"
                />
              </div>
            </div>

            {/* Tree */}
            <ScrollArea className="flex-1">
              <div className="px-1 py-0.5">
                {isLoading && (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {t('common.loading')}
                  </div>
                )}

                {error && (
                  <div className="px-3 py-2 text-xs text-destructive">
                    Impossible de charger le schema.
                    <button onClick={() => refetch()} className="ml-1 underline">
                      Reessayer
                    </button>
                  </div>
                )}

                {tables?.map((table) => {
                  const isOpen = expanded.has(table.name)
                  return (
                    <div key={table.name}>
                      <button
                        onClick={() => toggle(table.name)}
                        onDoubleClick={() => handleSelectAll(table.name)}
                        className="group w-full flex items-center gap-1.5 px-1.5 py-[5px] rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3 w-3 flex-shrink-0 text-text-muted" />
                        ) : (
                          <ChevronRight className="h-3 w-3 flex-shrink-0 text-text-muted" />
                        )}
                        <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
                        <span className="truncate font-mono text-[12px]">{table.name}</span>
                        <span className="ml-auto text-[10px] text-text-muted opacity-60 flex-shrink-0 tabular-nums">
                          {table.columns.length}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="ml-3 pl-2 border-l border-border-subtle">
                          {table.columns.map((col) => (
                            <div
                              key={col.name}
                              className="flex items-center gap-1.5 px-1.5 py-[3px] text-[12px] text-text-muted hover:text-muted-foreground transition-colors"
                            >
                              {col.primaryKey ? (
                                <Key className="h-3 w-3 text-warning flex-shrink-0" />
                              ) : (
                                <Columns3 className="h-3 w-3 opacity-30 flex-shrink-0" />
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
                  <p className="px-3 py-3 text-xs text-text-muted">{t('common.noTableFound')}</p>
                )}
              </div>
            </ScrollArea>
          </>
        )}

        {!activeConnectionId && (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-xs text-text-muted text-center leading-relaxed">
              Selectionnez une connexion
              <br />
              pour voir le schema
            </p>
          </div>
        )}

        <ConnectionModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editingConn} />

        {/* ── Delete confirmation dialog ────── */}
        <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
            <DialogHeader>
              <DialogTitle className="text-base">Supprimer la connexion</DialogTitle>
              <DialogDescription>
                La connexion <span className="font-semibold text-foreground">{deleteTarget?.name}</span> sera
                definitivement supprimee. Cette action est irreversible.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              >
                {deleteMutation.isPending ? (
                  <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}

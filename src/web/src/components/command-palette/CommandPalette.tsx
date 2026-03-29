import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command'
import {
  TerminalSquare, Table2, Plus, Save, Play,
  Database, LogOut, RefreshCw, Download,
} from 'lucide-react'
import { useEditorStore } from '@/stores/editor.store'
import { useAuthStore } from '@/stores/auth.store'
import { savedQueriesApi, type SavedQuery } from '@/api/saved-queries'
import { connectionsApi, type Connection } from '@/api/connections'

type Props = {
  connections: Connection[]
  onSaveNew: () => void
  onSaveAs: () => void
  onNewConnection: () => void
  setPage: (p: 'overview' | 'tables' | 'sql-editor') => void
}

export function CommandPalette({ connections, onSaveNew, onSaveAs, onNewConnection, setPage }: Props) {
  const [open, setOpen] = useState(false)
  const { activeConnectionId, setActiveConnection, addTab, tabs, activeTabId, executeQuery, executeSelection, selection, reloadTab } = useEditorStore()
  const { logout } = useAuthStore()
  const qc = useQueryClient()

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Saved queries from cache
  const savedQueries: SavedQuery[] = qc.getQueryData<{ savedQueries: SavedQuery[] }>(['saved-queries'])?.savedQueries ?? []
  const connectionQueries = savedQueries.filter((q) => q.connectionId === activeConnectionId)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const run = (fn: () => void) => {
    fn()
    setOpen(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Rechercher une action, une table, une requête..." />
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(addTab)}>
            <Plus className="h-4 w-4" />
            Nouvelle requête
            <CommandShortcut>Alt+N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => {
            if (activeTab?.kind === 'query') {
              if (activeTab.savedQueryId) {
                savedQueriesApi.update(activeTab.savedQueryId, { sql: activeTab.sql }).then(() => {
                  qc.invalidateQueries({ queryKey: ['saved-queries'] })
                  toast.success('Requête sauvegardée')
                })
              } else {
                onSaveNew()
              }
            }
          })}>
            <Save className="h-4 w-4" />
            Sauvegarder
            <CommandShortcut>Ctrl+S</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(onSaveAs)}>
            <Save className="h-4 w-4" />
            Enregistrer sous…
            <CommandShortcut>Ctrl+Shift+S</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => selection ? executeSelection() : executeQuery())}>
            <Play className="h-4 w-4" />
            {selection ? 'Exécuter la sélection' : 'Exécuter la requête'}
            <CommandShortcut>Ctrl+Enter</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => void reloadTab())}>
            <RefreshCw className="h-4 w-4" />
            Rafraîchir les résultats
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => setPage('sql-editor'))}>
            <TerminalSquare className="h-4 w-4" />
            Éditeur SQL
          </CommandItem>
          <CommandItem onSelect={() => run(() => setPage('tables'))}>
            <Table2 className="h-4 w-4" />
            Tables
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Connections */}
        <CommandGroup heading="Connexions">
          {connections.map((conn) => (
            <CommandItem key={conn.id} onSelect={() => run(() => setActiveConnection(conn.id))}>
              <Database className="h-4 w-4" />
              {conn.name}
              <span className="ml-1 text-xs text-muted-foreground">{conn.database}@{conn.host}</span>
              {conn.id === activeConnectionId && <span className="ml-auto text-[10px] text-primary">actif</span>}
            </CommandItem>
          ))}
          <CommandItem onSelect={() => run(onNewConnection)}>
            <Plus className="h-4 w-4" />
            Nouvelle connexion
          </CommandItem>
        </CommandGroup>

        {/* Saved queries */}
        {connectionQueries.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Requêtes sauvegardées">
              {connectionQueries.map((q) => (
                <CommandItem key={q.id} onSelect={() => run(() => useEditorStore.getState().openQuery(q.sql, q.name, q.id))}>
                  <TerminalSquare className="h-4 w-4" />
                  {q.name}
                  {q.folder && <span className="ml-1 text-xs text-muted-foreground">{q.folder}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        {/* Session */}
        <CommandGroup heading="Session">
          <CommandItem onSelect={() => run(logout)}>
            <LogOut className="h-4 w-4" />
            Se déconnecter
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

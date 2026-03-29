import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Search } from 'lucide-react'
import { savedQueriesApi, type SavedQuery } from '@/api/saved-queries'
import { useEditorStore } from '@/stores/editor.store'
import { cn } from '@/lib/utils'

type Props = { onClose: () => void }

export function SaveQueryModal({ onClose }: Props) {
  const qc = useQueryClient()
  const { tabs, activeTabId, activeConnectionId, loadQuery } = useEditorStore()
  const sql = tabs.find((t) => t.id === activeTabId)?.sql ?? ''

  const [mode, setMode] = useState<'new' | 'overwrite'>('new')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [search, setSearch] = useState('')
  const [selectedQuery, setSelectedQuery] = useState<SavedQuery | null>(null)

  const { data } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: savedQueriesApi.list,
  })

  // Only show queries tied to the current connection
  const connectionQueries = (data?.savedQueries ?? []).filter(
    (q) => q.connectionId === activeConnectionId,
  )

  const filtered = connectionQueries.filter((q) =>
    q.name.toLowerCase().includes(search.toLowerCase()),
  )

  const mutation = useMutation({
    mutationFn: () => {
      if (mode === 'overwrite' && selectedQuery) {
        return savedQueriesApi.update(selectedQuery.id, { sql })
      }
      const payload: Parameters<typeof savedQueriesApi.create>[0] = { name, sql }
      if (description) payload.description = description
      if (activeConnectionId) payload.connectionId = activeConnectionId
      return savedQueriesApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-queries'] })
      // Rename the active tab to reflect the saved query name
      if (mode === 'new' && name.trim()) {
        loadQuery(sql, name.trim())
      } else if (mode === 'overwrite' && selectedQuery) {
        loadQuery(sql, selectedQuery.name)
      }
      onClose()
    },
  })

  const canSubmit = mode === 'new' ? name.trim().length > 0 : selectedQuery !== null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
        <DialogHeader>
          <DialogTitle className="text-base">Sauvegarder la requête</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-md bg-surface-overlay p-1">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={cn(
              'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'new'
                ? 'bg-card text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary',
            )}
          >
            Nouvelle requête
          </button>
          <button
            type="button"
            onClick={() => setMode('overwrite')}
            className={cn(
              'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'overwrite'
                ? 'bg-card text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary',
            )}
          >
            Écraser existante
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
          className="space-y-4"
        >
          {mode === 'new' ? (
            <>
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Active users count"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Description <span className="text-text-muted font-normal">(optionnel)</span>
                </Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description courte..."
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label>Choisir une requête à écraser</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher..."
                  className="pl-8 h-8 text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border-subtle divide-y divide-border-subtle">
                {filtered.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-text-muted text-center">
                    {connectionQueries.length === 0
                      ? 'Aucune requête sauvegardée pour cette connexion'
                      : 'Aucun résultat'}
                  </p>
                ) : (
                  filtered.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setSelectedQuery(q)}
                      className={cn(
                        'w-full text-left px-3 py-2 text-xs transition-colors',
                        selectedQuery?.id === q.id
                          ? 'bg-accent-green/10 text-text-primary'
                          : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
                      )}
                    >
                      <span className="font-medium">{q.name}</span>
                      {q.folder && (
                        <span className="ml-2 text-text-muted">{q.folder}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
              {selectedQuery && (
                <p className="text-xs text-text-muted">
                  Le SQL de{' '}
                  <span className="font-medium text-text-secondary">«{selectedQuery.name}»</span>{' '}
                  sera remplacé.
                </p>
              )}
            </div>
          )}

          {/* SQL preview */}
          <div className="rounded-md border border-border-subtle bg-surface-overlay p-2.5">
            <pre className="text-[11px] font-mono text-text-muted line-clamp-3 whitespace-pre-wrap">
              {sql}
            </pre>
          </div>

          {mutation.error && (
            <p className="text-xs text-destructive">{(mutation.error as Error).message}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending || !canSubmit}>
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === 'overwrite' ? 'Écraser' : 'Sauvegarder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

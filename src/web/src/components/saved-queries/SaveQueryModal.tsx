import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { savedQueriesApi } from '@/api/saved-queries'
import { useEditorStore } from '@/stores/editor.store'

type Props = { onClose: () => void }

export function SaveQueryModal({ onClose }: Props) {
  const qc = useQueryClient()
  const { tabs, activeTabId, activeConnectionId, loadQuery, setSavedQueryId } = useEditorStore()
  const sql = tabs.find((t) => t.id === activeTabId)?.sql ?? ''

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof savedQueriesApi.create>[0] = { name, sql }
      if (description) payload.description = description
      if (activeConnectionId) payload.connectionId = activeConnectionId
      return savedQueriesApi.create(payload)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['saved-queries'] })
      loadQuery(sql, name.trim())
      setSavedQueryId(data.savedQuery.id)
      toast.success('Requête sauvegardée')
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
        <DialogHeader>
          <DialogTitle className="text-base">Sauvegarder la requête</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) mutation.mutate()
          }}
          className="space-y-4"
        >
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
            <Button type="submit" size="sm" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Sauvegarder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

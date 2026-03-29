import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, AlertOctagon, ShieldAlert, Skull } from 'lucide-react'
import { useEditorStore } from '@/stores/editor.store'

const LEVEL = {
  1: { icon: AlertTriangle, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Modification' },
  2: { icon: AlertOctagon, color: 'text-warning', bg: 'bg-warning/10 border-warning/20', label: 'Avertissement' },
  3: { icon: ShieldAlert, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', label: 'Danger' },
  4: { icon: Skull, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20', label: 'Critique' },
} as const

export function GuardrailModal() {
  const { tabs, activeTabId, clearGuardrail, executeQuery } = useEditorStore()
  const guardrail = tabs.find((t) => t.id === activeTabId)?.result.guardrail ?? null
  if (!guardrail) return null

  const cfg = LEVEL[guardrail.level]
  const Icon = cfg.icon

  const handleConfirm = () => {
    clearGuardrail()
    executeQuery(true)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && clearGuardrail()}>
      <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon className={`h-5 w-5 ${cfg.color}`} />
            {cfg.label}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {guardrail.message}
          </DialogDescription>
        </DialogHeader>

        <div className={`rounded-md border p-3 text-xs text-muted-foreground ${cfg.bg}`}>
          {guardrail.details}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={clearGuardrail}>
            Annuler
          </Button>
          <Button
            variant={guardrail.level >= 3 ? 'destructive' : 'default'}
            size="sm"
            onClick={handleConfirm}
          >
            Confirmer et executer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

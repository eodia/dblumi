import { useEditorStore, type TabResult } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Loader2, CheckCircle2, AlertCircle, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

function StatusIcon({ status }: { status: TabResult['status'] }) {
  if (status === 'running') return <Loader2 className="h-3 w-3 animate-spin text-primary" />
  if (status === 'done') return <CheckCircle2 className="h-3 w-3 text-success" />
  if (status === 'error') return <AlertCircle className="h-3 w-3 text-destructive" />
  return <Circle className="h-3 w-3 text-text-muted/40" />
}

type Props = {
  /**
   * `bar`    — full-width strip with its own border, used above empty / loading
   *            / error states where the regular status bar isn't rendered.
   * `inline` — bare flex row meant to be placed inside the existing status bar.
   */
  variant?: 'bar' | 'inline'
}

/**
 * Tabs for navigating between per-statement result panels of a multi-statement
 * query. Renders nothing for single-statement runs (`panels.length <= 1`).
 */
export function ResultsPanelTabs({ variant = 'bar' }: Props) {
  const { t } = useI18n()
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const setActivePanel = useEditorStore((s) => s.setActivePanel)
  const tab = tabs.find((x) => x.id === activeTabId)

  if (!tab || tab.panels.length <= 1) return null

  const containerClass =
    variant === 'bar'
      ? 'flex items-center gap-0.5 h-7 px-2 border-b border-border-subtle bg-surface flex-shrink-0 overflow-x-auto'
      : 'flex items-center gap-0.5 overflow-x-auto'

  return (
    <div className={containerClass}>
      {tab.panels.map((panel, i) => {
        const isActive = i === tab.activePanelIndex
        return (
          <button
            key={i}
            type="button"
            onClick={() => setActivePanel(i)}
            className={cn(
              'flex items-center gap-1.5 px-2 h-6 text-[11px] rounded-sm border whitespace-nowrap transition-colors',
              isActive
                ? 'bg-background border-border text-foreground'
                : 'bg-transparent border-transparent text-text-muted hover:text-foreground hover:bg-surface-overlay',
            )}
            title={panel.executedSql ?? undefined}
          >
            <StatusIcon status={panel.status} />
            <span className="font-medium tabular-nums">
              {t('results.statement', { n: i + 1 })}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// src/web/src/components/overview/OverviewPage.tsx
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { StatsCards } from './StatsCards'
import { ConnectionHealthCard } from './ConnectionHealthCard'
import { ActivityCard } from './ActivityCard'
import { QuickAccessCard } from './QuickAccessCard'
import { ErdDiagram } from './ErdDiagram'

export function OverviewPage() {
  const { t } = useI18n()
  const activeConnectionId = useEditorStore((s) => s.activeConnectionId)

  if (!activeConnectionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t('overview.noConnection')}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <StatsCards connectionId={activeConnectionId} />
      <ConnectionHealthCard connectionId={activeConnectionId} />
      <ActivityCard connectionId={activeConnectionId} />
      <QuickAccessCard connectionId={activeConnectionId} />
      <ErdDiagram connectionId={activeConnectionId} />
    </div>
  )
}

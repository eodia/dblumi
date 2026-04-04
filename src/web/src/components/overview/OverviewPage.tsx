// src/web/src/components/overview/OverviewPage.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi } from '@/api/connections'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { StatsCards } from './StatsCards'
import { ActivityCard } from './ActivityCard'
import { QuickAccessCard } from './QuickAccessCard'
import { ErdDiagram } from './ErdDiagram'
import { Server, RefreshCw, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { DriverIcon, envBadgeClass } from '@/components/ui/driver-icon'
import { dbUsersApi } from '@/api/db-users'
import { DbUsersModal } from './DbUsersModal'

type Props = { onNavigate: (page: 'sql-editor' | 'tables') => void }

function ConnectionStatusBar({ connectionId }: { connectionId: string }) {
  const { t } = useI18n()
  const [checking, setChecking] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)
  const [usersOpen, setUsersOpen] = useState(false)

  const { data: stats } = useQuery({
    queryKey: ['dbstats', connectionId],
    queryFn: () => connectionsApi.stats(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const { data: usersData } = useQuery({
    queryKey: ['db-users', connectionId],
    queryFn: () => dbUsersApi.list(connectionId),
    staleTime: 60_000,
    retry: false,
    enabled: false,  // only populated when modal opens; we just read the cached count
  })

  const handleCheck = async () => {
    setChecking(true)
    try {
      const r = await connectionsApi.test(connectionId)
      if (r.ok && r.latencyMs != null) setLatency(r.latencyMs)
    } catch {
      setLatency(null)
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Server className="h-3 w-3" />
          <span>{stats?.version ?? '—'}</span>
        </div>
        <div className="flex gap-2">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setUsersOpen(true)}
                  className="flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium transition-colors bg-surface-raised text-muted-foreground hover:text-foreground hover:bg-surface-overlay border border-border"
                >
                  <Users className="h-3 w-3" />
                  <span>{t('overview.dbUsers')}</span>
                  {usersData?.count != null && (
                    <span className="bg-indigo-500/20 text-indigo-400 rounded-full px-1.5 py-px text-[10px] font-semibold">
                      {usersData.count}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('overview.dbUsersTooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCheck}
                  disabled={checking}
                  className={cn(
                    'flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium transition-colors disabled:opacity-60',
                    latency != null
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                      : 'bg-surface-raised text-muted-foreground hover:text-foreground hover:bg-surface-overlay border border-border',
                  )}
                >
                  <RefreshCw className={cn('h-3 w-3', checking && 'animate-spin')} />
                  <span className="tabular-nums">
                    {latency != null ? `${latency} ms` : t('overview.latency')}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('overview.latencyTooltip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <DbUsersModal
        connectionId={connectionId}
        open={usersOpen}
        onOpenChange={setUsersOpen}
      />
    </>
  )
}

export function OverviewPage({ onNavigate }: Props) {
  const { t } = useI18n()
  const activeConnectionId = useEditorStore((s) => s.activeConnectionId)

  const { data: connList } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
    staleTime: 5 * 60_000,
  })
  const activeConn = connList?.connections.find((c) => c.id === activeConnectionId)

  if (!activeConnectionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t('overview.noConnection')}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-4">
      {/* Title */}
      <div className="flex items-center gap-3 px-1">
        {activeConn && (
          <DriverIcon driver={activeConn.driver} environment={activeConn.environment} />
        )}
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-semibold truncate">{activeConn?.name ?? '—'}</h1>
          {activeConn?.environment && (
            <span className={cn('px-1.5 py-px rounded text-[10px] font-bold uppercase tracking-widest border leading-none flex-shrink-0', envBadgeClass(activeConn.environment))}>
              {activeConn.environment}
            </span>
          )}
        </div>
        {activeConn && (
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
            {activeConn.database}@{activeConn.host}
          </span>
        )}
      </div>

      <ConnectionStatusBar connectionId={activeConnectionId} />
      <StatsCards connectionId={activeConnectionId} />
      <div className="grid grid-cols-2 gap-3">
        <QuickAccessCard connectionId={activeConnectionId} environment={activeConn?.environment} onNavigate={onNavigate} />
        <ActivityCard connectionId={activeConnectionId} environment={activeConn?.environment} onNavigate={onNavigate} />
      </div>
      <ErdDiagram connectionId={activeConnectionId} onNavigate={onNavigate} />
    </div>
  )
}

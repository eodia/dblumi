// src/web/src/components/overview/ConnectionHealthCard.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi } from '@/api/connections'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { CheckCircle, XCircle, RefreshCw, Server, Globe, Type } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = { connectionId: string }

export function ConnectionHealthCard({ connectionId }: Props) {
  const { t } = useI18n()
  const [checking, setChecking] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)

  const { data: stats } = useQuery({
    queryKey: ['dbstats', connectionId],
    queryFn: () => connectionsApi.stats(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const handleCheck = async () => {
    setChecking(true)
    try {
      const r = await connectionsApi.test(connectionId)
      setHealth(r)
    } catch {
      setHealth({ ok: false, error: 'Unreachable' })
    } finally {
      setChecking(false)
    }
  }

  const rows = [
    { icon: Server, label: t('overview.version'), value: stats?.version ?? '—' },
    { icon: Type, label: t('overview.encoding'), value: stats?.encoding ?? '—' },
    { icon: Globe, label: t('overview.timezone'), value: stats?.timezone ?? '—' },
  ]

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{t('overview.health')}</span>
        <div className="flex items-center gap-2">
          {health && (
            <span className={cn('text-xs flex items-center gap-1', health.ok ? 'text-emerald-400' : 'text-destructive')}>
              {health.ok
                ? <><CheckCircle className="h-3.5 w-3.5" />{t('overview.connected')} · {health.latencyMs}ms</>
                : <><XCircle className="h-3.5 w-3.5" />{health.error ?? t('overview.disconnected')}</>
              }
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCheck} disabled={checking}>
            <RefreshCw className={cn('h-3 w-3', checking && 'animate-spin')} />
            {t('overview.latency')}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-md bg-surface-raised px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
            </div>
            <p className="text-xs font-mono truncate" title={value}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

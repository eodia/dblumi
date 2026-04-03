// src/web/src/components/overview/ConnectionHealthCard.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi } from '@/api/connections'
import { useI18n } from '@/i18n'
import { Server, Globe, Type, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = { connectionId: string }

export function ConnectionHealthCard({ connectionId }: Props) {
  const { t } = useI18n()
  const [checking, setChecking] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)

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
      if (r.ok && r.latencyMs != null) setLatency(r.latencyMs)
    } catch {
      setLatency(null)
    } finally {
      setChecking(false)
    }
  }

  const items = [
    { icon: Server, label: t('overview.version'), value: stats?.version ?? '—', color: 'text-blue-400' },
    { icon: Type, label: t('overview.encoding'), value: stats?.encoding ?? '—', color: 'text-violet-400' },
    { icon: Globe, label: t('overview.timezone'), value: stats?.timezone ?? '—', color: 'text-emerald-400' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map(({ icon: Icon, label, value, color }) => (
        <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
          <Icon className={`h-8 w-8 ${color} flex-shrink-0 opacity-80`} />
          <div className="min-w-0">
            <p className="text-lg font-semibold truncate" title={value}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={handleCheck}
        disabled={checking}
        className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3 hover:bg-surface-raised transition-colors text-left w-full disabled:opacity-60"
      >
        <RefreshCw className={cn('h-8 w-8 text-amber-400 flex-shrink-0 opacity-80', checking && 'animate-spin')} />
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {latency != null ? `${latency}ms` : '—'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('overview.latency')}</p>
        </div>
      </button>
    </div>
  )
}

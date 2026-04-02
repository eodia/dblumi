// src/web/src/components/overview/StatsCards.tsx
import { useQuery } from '@tanstack/react-query'
import { connectionsApi, type SchemaTable, type DbStats } from '@/api/connections'
import { useI18n } from '@/i18n'
import { Table2, Eye, Zap, HardDrive } from 'lucide-react'

type Props = { connectionId: string }

export function StatsCards({ connectionId }: Props) {
  const { t } = useI18n()

  const { data: schema } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const { data: stats } = useQuery({
    queryKey: ['dbstats', connectionId],
    queryFn: () => connectionsApi.stats(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const tableCount = schema?.tables.filter((t: SchemaTable) => t.type !== 'view').length ?? '—'
  const viewCount = schema?.tables.filter((t: SchemaTable) => t.type === 'view').length ?? '—'
  const funcCount = schema?.functions?.length ?? '—'
  const dbSize = stats?.sizePretty ?? '—'

  const items = [
    { label: t('overview.tables'), value: tableCount, icon: Table2, color: 'text-blue-400' },
    { label: t('overview.views'), value: viewCount, icon: Eye, color: 'text-violet-400' },
    { label: t('overview.functions'), value: funcCount, icon: Zap, color: 'text-amber-400' },
    { label: t('overview.dbSize'), value: dbSize, icon: HardDrive, color: 'text-emerald-400' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
          <Icon className={`h-8 w-8 ${color} flex-shrink-0 opacity-80`} />
          <div>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

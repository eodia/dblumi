// src/web/src/components/overview/StatsCards.tsx
import { useQuery } from '@tanstack/react-query'
import { connectionsApi, type SchemaTable } from '@/api/connections'
import { useI18n } from '@/i18n'
import { Table2, Eye, Zap, HardDrive, Globe, Type } from 'lucide-react'

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

  return (
    <div className="grid grid-cols-4 gap-3">
      {/* Tables */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
        <Table2 className="h-8 w-8 text-blue-400 flex-shrink-0 opacity-80" />
        <div>
          <p className="text-2xl font-semibold tabular-nums">{tableCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('overview.tables')}</p>
        </div>
      </div>

      {/* Views + Functions merged */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-violet-400 opacity-80 flex-shrink-0" />
            <span className="text-sm font-semibold tabular-nums">{viewCount}</span>
            <span className="text-xs text-muted-foreground">{t('overview.views')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400 opacity-80 flex-shrink-0" />
            <span className="text-sm font-semibold tabular-nums">{funcCount}</span>
            <span className="text-xs text-muted-foreground">{t('overview.functions')}</span>
          </div>
        </div>
      </div>

      {/* DB Size */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
        <HardDrive className="h-8 w-8 text-emerald-400 flex-shrink-0 opacity-80" />
        <div>
          <p className="text-2xl font-semibold tabular-nums">{dbSize}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('overview.dbSize')}</p>
        </div>
      </div>

      {/* Health — encoding · timezone */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col justify-center gap-1.5">
        <div className="flex items-center gap-2">
          <Type className="h-3.5 w-3.5 text-violet-400 opacity-80 flex-shrink-0" />
          <span className="text-xs text-muted-foreground w-16 flex-shrink-0">{t('overview.encoding')}</span>
          <span className="text-xs font-medium truncate">{stats?.encoding ?? '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-emerald-400 opacity-80 flex-shrink-0" />
          <span className="text-xs text-muted-foreground w-16 flex-shrink-0">{t('overview.timezone')}</span>
          <span className="text-xs font-medium truncate">{stats?.timezone ?? '—'}</span>
        </div>
      </div>
    </div>
  )
}

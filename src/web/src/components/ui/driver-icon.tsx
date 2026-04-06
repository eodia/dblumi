import { cn } from '@/lib/utils'
import postgresqlSvg from '@/assets/icon-postgresql.svg'
import mysqlSvg from '@/assets/icon-mysql.svg'
import mongodbSvg from '@/assets/icon-mongodb.svg'
import oracleSvg from '@/assets/icon-oracle.svg'
import sqliteSvg from '@/assets/icon-sqlite.svg'

const driverIcons: Record<string, string> = {
  postgresql: postgresqlSvg,
  mysql: mysqlSvg,
  mongodb: mongodbSvg,
  oracle: oracleSvg,
  sqlite: sqliteSvg,
}

function envDotClass(env?: string | null): string {
  switch (env?.toLowerCase()) {
    case 'prod':    return 'bg-destructive'
    case 'staging': return 'bg-warning'
    case 'dev':     return 'bg-primary'
    default:        return 'bg-border'
  }
}

export function envIconClass(env?: string | null): string {
  switch (env?.toLowerCase()) {
    case 'prod':    return 'text-destructive'
    case 'staging': return 'text-warning'
    case 'dev':     return 'text-primary'
    default:        return 'text-muted-foreground'
  }
}

export function envBadgeClass(env?: string | null): string {
  switch (env?.toLowerCase()) {
    case 'prod':    return 'bg-destructive/15 text-destructive border-destructive/30'
    case 'staging': return 'bg-warning/15 text-warning border-warning/30'
    case 'dev':     return 'bg-primary/15 text-primary border-primary/30'
    default:        return 'bg-muted text-muted-foreground border-border'
  }
}

export function DriverIcon({ driver, className, environment }: { driver: string; className?: string; environment?: string | null }) {
  const src = driverIcons[driver] ?? mysqlSvg
  const icon = <img src={src} alt={driver} className={cn('h-4 w-4', className)} />

  if (environment !== undefined) {
    return (
      <span className="relative flex-shrink-0 inline-flex items-center justify-center rounded-md bg-white p-1 h-6 w-6">
        {icon}
        <span className={cn('absolute -bottom-1 -left-1 h-2 w-2 rounded-full ring-1 ring-background', envDotClass(environment))} />
      </span>
    )
  }

  return <>{icon}</>
}

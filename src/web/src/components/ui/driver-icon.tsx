import { cn } from '@/lib/utils'

function PostgresIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-4 w-4', className)} xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#336791" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="bold" fontFamily="system-ui, sans-serif" fill="white">P</text>
    </svg>
  )
}

function MysqlIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-4 w-4', className)} xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#00758F" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="bold" fontFamily="system-ui, sans-serif" fill="#F29111">M</text>
    </svg>
  )
}

export function DriverIcon({ driver, className }: { driver: string; className?: string }) {
  if (driver === 'postgresql') return <PostgresIcon className={className} />
  return <MysqlIcon className={className} />
}

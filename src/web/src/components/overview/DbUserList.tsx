import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DbUser } from '@/api/db-users'
import type { DbDriver } from '@/api/connections'

type Props = {
  users: DbUser[]
  driver: DbDriver
  selectedUser: DbUser | null
  onSelect: (user: DbUser) => void
  onCreateNew: () => void
}

export function DbUserList({ users, driver, selectedUser, onSelect, onCreateNew }: Props) {
  const { t } = useI18n()

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="flex-1 overflow-auto">
        {users.length === 0 && (
          <p className="text-xs text-muted-foreground p-4 text-center">{t('dbusers.noUsers')}</p>
        )}
        {users.map((user) => {
          const isSelected =
            user.username === selectedUser?.username &&
            (driver !== 'mysql' || user.host === selectedUser?.host)
          return (
            <button
              key={`${user.username}@${user.host ?? ''}`}
              type="button"
              onClick={() => onSelect(user)}
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-surface-raised border-b border-border/50',
                isSelected && 'bg-surface-raised',
              )}
            >
              <p className="font-medium truncate">{user.username}</p>
              {driver === 'mysql' && user.host && (
                <p className="text-[11px] text-muted-foreground truncate">@{user.host}</p>
              )}
              {driver === 'mysql' && user.plugin && (
                <p className="text-[10px] text-muted-foreground/70 truncate">{user.plugin}</p>
              )}
              {driver === 'oracle' && user.status && (
                <p className="text-[11px] text-muted-foreground truncate">{user.status}</p>
              )}
            </button>
          )
        })}
      </div>
      <div className="p-3 border-t border-border">
        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={onCreateNew}>
          <Plus className="h-3.5 w-3.5" />
          {t('dbusers.createUser')}
        </Button>
      </div>
    </div>
  )
}

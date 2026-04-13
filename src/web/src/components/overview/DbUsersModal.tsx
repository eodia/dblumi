import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { dbUsersApi } from '@/api/db-users'
import { connectionsApi } from '@/api/connections'
import type { DbUser } from '@/api/db-users'
import { DbUserList } from './DbUserList'
import { DbUserForm } from './DbUserForm'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  connectionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DbUsersModal({ connectionId, open, onOpenChange }: Props) {
  const { t } = useI18n()
  const [selectedUser, setSelectedUser] = useState<DbUser | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Get driver from cached connections list
  const { data: connList } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
    staleTime: 5 * 60_000,
  })
  const driver = connList?.connections.find((c) => c.id === connectionId)?.driver ?? 'mysql'

  const { data, isLoading } = useQuery({
    queryKey: ['db-users', connectionId],
    queryFn: () => dbUsersApi.list(connectionId),
    enabled: open,
    retry: false,
    staleTime: 30_000,
  })

  const handleSelect = (user: DbUser) => {
    setSelectedUser(user)
    setIsCreating(false)
  }

  const handleCreateNew = () => {
    setSelectedUser(null)
    setIsCreating(true)
  }

  const handleSaved = () => {
    setIsCreating(false)
  }

  const handleDropped = () => {
    setSelectedUser(null)
    setIsCreating(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-base">{t('dbusers.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left panel — user list */}
          <div className="w-56 flex-shrink-0 overflow-hidden">
            {isLoading ? (
              <div className="relative h-full">
                <div className="space-y-2 p-3">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5">
                      <Skeleton className="h-6 w-6 rounded-full" />
                      <Skeleton className="h-3 flex-1" style={{ maxWidth: `${60 + ((i * 11) % 35)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              </div>
            ) : (
              <DbUserList
                users={data?.users ?? []}
                driver={driver}
                selectedUser={selectedUser}
                onSelect={handleSelect}
                onCreateNew={handleCreateNew}
              />
            )}
          </div>

          {/* Right panel — form */}
          <div className="flex-1 overflow-hidden">
            <DbUserForm
              connectionId={connectionId}
              driver={driver}
              selectedUser={selectedUser}
              isCreating={isCreating}
              onSaved={handleSaved}
              onDropped={handleDropped}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

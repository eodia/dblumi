import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Shield, Users, Database, Pencil, Trash2, ChevronDown,
  Loader2, Settings2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { adminApi, type AdminUser } from '@/api/admin'
import { connectionsApi, type Connection } from '@/api/connections'
import { ConnectionModal } from '@/components/connections/ConnectionModal'
import { useAuthStore } from '@/stores/auth.store'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { DriverIcon } from '@/components/ui/driver-icon'
import { SlideToConfirm } from '@/components/ui/slide-to-confirm'

const ROLES = ['admin', 'editor', 'viewer'] as const
const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-destructive/15 text-destructive border-destructive/30',
  editor: 'bg-primary/15 text-primary border-primary/30',
  viewer: 'bg-muted text-muted-foreground border-border',
}

// ── User row ────────────────────────────────────
function UserRow({ user, onEdit, onDelete, isSelf }: {
  user: AdminUser; onEdit: () => void; onDelete: () => void; isSelf: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle hover:bg-surface-raised/50 transition-colors">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
        {user.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{user.name}</span>
          {isSelf && <span className="text-[10px] text-text-muted bg-surface-overlay px-1.5 py-0.5 rounded">vous</span>}
        </div>
        <span className="text-xs text-muted-foreground truncate block">{user.email}</span>
      </div>
      <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border', ROLE_COLORS[user.role] ?? ROLE_COLORS.viewer)}>
        {t(`user.role.${user.role}` as 'user.role.admin')}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {!isSelf && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Connection row ──────────────────────────────
function ConnectionRow({ conn, onEdit, onDelete }: {
  conn: Connection; onEdit: () => void; onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle hover:bg-surface-raised/50 transition-colors">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: conn.color ?? '#71717A' }} />
      <DriverIcon driver={conn.driver} className="h-3.5 w-3.5" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">{conn.name}</span>
        <span className="text-xs text-muted-foreground font-mono truncate block">
          {conn.database ? `${conn.database}@${conn.host}` : conn.host}:{conn.port}
        </span>
      </div>
      {conn.environment && (
        <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border',
          conn.environment === 'prod' ? 'bg-destructive/15 text-destructive border-destructive/30' :
          conn.environment === 'staging' ? 'bg-warning/15 text-warning border-warning/30' :
          'bg-primary/15 text-primary border-primary/30'
        )}>{conn.environment}</span>
      )}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  )
}

// ── Main admin page ─────────────────────────────
export function AdminPage() {
  const { t } = useI18n()
  const { user: currentUser } = useAuthStore()
  const qc = useQueryClient()

  const [tab, setTab] = useState<'users' | 'connections'>('users')
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)
  const [editConn, setEditConn] = useState<Connection | undefined>()
  const [connModalOpen, setConnModalOpen] = useState(false)
  const [deleteConn, setDeleteConn] = useState<Connection | null>(null)

  // Edit user form state
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<string>('viewer')

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: adminApi.listUsers,
  })

  const { data: connsData, isLoading: connsLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
  })

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof adminApi.updateUser>[1] }) => adminApi.updateUser(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('admin.userSaved'))
      setEditUser(null)
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('admin.userDeleted'))
      setDeleteUser(null)
    },
  })

  const deleteConnMutation = useMutation({
    mutationFn: (id: string) => connectionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      setDeleteConn(null)
    },
  })

  const users = usersData?.users ?? []
  const connections = connsData?.connections ?? []

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 h-12 px-6 border-b border-border-subtle bg-surface flex-shrink-0">
        <Shield className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-semibold">{t('admin.title')}</h1>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border-subtle bg-surface flex-shrink-0">
        <button onClick={() => setTab('users')}
          className={cn('flex items-center gap-2 px-5 py-2.5 text-xs font-medium border-b-2 transition-colors',
            tab === 'users' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          <Users className="h-3.5 w-3.5" />
          {t('admin.users')}
          <span className="text-[10px] bg-surface-overlay px-1.5 py-0.5 rounded tabular-nums">{users.length}</span>
        </button>
        <button onClick={() => setTab('connections')}
          className={cn('flex items-center gap-2 px-5 py-2.5 text-xs font-medium border-b-2 transition-colors',
            tab === 'connections' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          <Database className="h-3.5 w-3.5" />
          {t('admin.connections')}
          <span className="text-[10px] bg-surface-overlay px-1.5 py-0.5 rounded tabular-nums">{connections.length}</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'users' && (
          <div>
            {usersLoading && <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div>}
            {users.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === currentUser?.id}
                onEdit={() => { setEditUser(u); setEditName(u.name); setEditEmail(u.email); setEditRole(u.role) }}
                onDelete={() => setDeleteUser(u)} />
            ))}
            {users.length === 0 && !usersLoading && <p className="p-6 text-sm text-muted-foreground">{t('admin.noUsers')}</p>}
          </div>
        )}

        {tab === 'connections' && (
          <div>
            <div className="flex items-center justify-end px-4 py-2 border-b border-border-subtle">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setEditConn(undefined); setConnModalOpen(true) }}>
                <Database className="h-3 w-3" />
                {t('conn.new')}
              </Button>
            </div>
            {connsLoading && <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div>}
            {connections.map((conn) => (
              <ConnectionRow key={conn.id} conn={conn}
                onEdit={() => { setEditConn(conn); setConnModalOpen(true) }}
                onDelete={() => setDeleteConn(conn)} />
            ))}
          </div>
        )}
      </div>

      {/* Edit user dialog */}
      <Dialog open={editUser !== null} onOpenChange={(o) => { if (!o) setEditUser(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.editUser')}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (editUser) updateUserMutation.mutate({ id: editUser.id, data: { name: editName, email: editEmail, role: editRole } }) }} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">{t('auth.register.name')}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Email</Label>
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" className="h-8 text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.role')}</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full h-8 justify-between text-sm">
                    {t(`user.role.${editRole}` as 'user.role.admin')}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full">
                  {ROLES.map((r) => (
                    <DropdownMenuItem key={r} className="text-xs" onClick={() => setEditRole(r)}>
                      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border mr-2', ROLE_COLORS[r])}>{r}</span>
                      {t(`user.role.${r}` as 'user.role.admin')}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditUser(null)}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm" disabled={updateUserMutation.isPending}>
                {updateUserMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('sheet.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete user dialog */}
      <Dialog open={deleteUser !== null} onOpenChange={(o) => { if (!o) setDeleteUser(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.deleteUser')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('admin.deleteUserConfirm')}
          </p>
          <p className="text-sm font-semibold">{deleteUser?.name} ({deleteUser?.email})</p>
          <div className="pt-2">
            <SlideToConfirm
              label={t('admin.slideToDelete')}
              confirmLabel={t('common.delete')}
              variant="destructive"
              disabled={deleteUserMutation.isPending}
              onConfirm={() => deleteUser && deleteUserMutation.mutate(deleteUser.id)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteUser(null)}>{t('common.cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete connection dialog */}
      <Dialog open={deleteConn !== null} onOpenChange={(o) => { if (!o) setDeleteConn(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('conn.delete')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('conn.deleteConfirm')}
          </p>
          <p className="text-sm font-semibold">{deleteConn?.name}</p>
          <div className="pt-2">
            <SlideToConfirm
              label={t('admin.slideToDelete')}
              confirmLabel={t('common.delete')}
              variant="destructive"
              disabled={deleteConnMutation.isPending}
              onConfirm={() => deleteConn && deleteConnMutation.mutate(deleteConn.id)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteConn(null)}>{t('common.cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connection modal */}
      <ConnectionModal
        key={editConn?.id ?? 'new'}
        open={connModalOpen}
        onClose={() => { setConnModalOpen(false); setEditConn(undefined) }}
        editing={editConn}
      />
    </div>
  )
}

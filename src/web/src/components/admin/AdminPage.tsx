import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Shield, Users, Database, Pencil, Trash2, ChevronDown,
  Loader2, Plus, UsersRound, X,
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
import { adminApi, type AdminUser, type Group } from '@/api/admin'
import { connectionsApi, type Connection } from '@/api/connections'
import { ConnectionModal } from '@/components/connections/ConnectionModal'
import { ComboboxChips } from '@/components/ui/combobox-chips'
import { SlideToConfirm } from '@/components/ui/slide-to-confirm'
import { DriverIcon } from '@/components/ui/driver-icon'
import { useAuthStore } from '@/stores/auth.store'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const ROLES = ['admin', 'editor', 'viewer'] as const
const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-destructive/15 text-destructive border-destructive/30',
  editor: 'bg-primary/15 text-primary border-primary/30',
  viewer: 'bg-muted text-muted-foreground border-border',
}
const GROUP_COLORS = ['#41cd2a', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

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
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
        {!isSelf && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
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
      <DriverIcon driver={conn.driver} environment={conn.environment} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">{conn.name}</span>
        <span className="text-xs text-muted-foreground font-mono truncate block">{conn.database ? `${conn.database}@${conn.host}` : conn.host}:{conn.port}</span>
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

// ── Group row ───────────────────────────────────
function GroupRow({ group, onEdit, onDelete, onManageMembers }: {
  group: Group; onEdit: () => void; onDelete: () => void; onManageMembers: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle hover:bg-surface-raised/50 transition-colors">
      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color ?? '#71717A' }} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">{group.name}</span>
        {group.description && <span className="text-xs text-muted-foreground truncate block">{group.description}</span>}
      </div>
      <button onClick={onManageMembers} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface-overlay transition-colors">
        <Users className="h-3 w-3" />
        <span className="tabular-nums">{group.memberCount}</span>
      </button>
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

  const [tab, setTab] = useState<'groups' | 'users' | 'connections'>('groups')

  // ── Users state ──
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<string>('viewer')
  const [editUserGroupIds, setEditUserGroupIds] = useState<string[]>([])

  // ── Groups state ──
  const [editGroup, setEditGroup] = useState<Group | null>(null)
  const [deleteGroup, setDeleteGroup] = useState<Group | null>(null)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupDesc, setGroupDesc] = useState('')
  const [groupColor, setGroupColor] = useState(GROUP_COLORS[0]!)
  const [membersGroupId, setMembersGroupId] = useState<string | null>(null)

  // ── Connections state ──
  const [editConn, setEditConn] = useState<Connection | undefined>()
  const [connModalOpen, setConnModalOpen] = useState(false)
  const [deleteConn, setDeleteConn] = useState<Connection | null>(null)

  // ── Queries ──
  const { data: usersData, isLoading: usersLoading } = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.listUsers })
  const { data: groupsData, isLoading: groupsLoading } = useQuery({ queryKey: ['admin', 'groups'], queryFn: adminApi.listGroups })
  const { data: connsData, isLoading: connsLoading } = useQuery({ queryKey: ['connections'], queryFn: connectionsApi.list })
  const { data: membersData } = useQuery({
    queryKey: ['admin', 'group-members', membersGroupId],
    queryFn: () => adminApi.listGroupMembers(membersGroupId!),
    enabled: !!membersGroupId,
  })
  const { data: editUserGroupsData } = useQuery({
    queryKey: ['admin', 'user-groups', editUser?.id],
    queryFn: () => adminApi.getUserGroups(editUser!.id),
    enabled: !!editUser?.id,
  })
  // Sync loaded user groups into state
  const [userGroupsSynced, setUserGroupsSynced] = useState<string | null>(null)
  if (editUserGroupsData && editUser && userGroupsSynced !== editUser.id) {
    setEditUserGroupIds(editUserGroupsData.groups.map((g) => g.id))
    setUserGroupsSynced(editUser.id)
  }

  const allUsers = usersData?.users ?? []
  const allGroups = groupsData?.groups ?? []
  const connections = connsData?.connections ?? []
  const members = membersData?.members ?? []

  // ── Mutations ──
  const updateUserMut = useMutation({
    mutationFn: async ({ id, data, groupIds }: { id: string; data: Parameters<typeof adminApi.updateUser>[1]; groupIds: string[] }) => {
      await adminApi.updateUser(id, data)
      await adminApi.setUserGroups(id, groupIds)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: ['admin', 'user-groups'] })
      qc.invalidateQueries({ queryKey: ['admin', 'groups'] })
      toast.success(t('admin.userSaved'))
      setEditUser(null)
      setUserGroupsSynced(null)
    },
  })
  const deleteUserMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'users'] }); toast.success(t('admin.userDeleted')); setDeleteUser(null) },
  })
  const createGroupMut = useMutation({
    mutationFn: (data: { name: string; description?: string; color?: string }) => adminApi.createGroup(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'groups'] }); toast.success(t('admin.groupCreated')); setNewGroupOpen(false); setGroupName(''); setGroupDesc('') },
  })
  const updateGroupMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof adminApi.updateGroup>[1] }) => adminApi.updateGroup(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'groups'] }); toast.success(t('admin.groupSaved')); setEditGroup(null) },
  })
  const deleteGroupMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteGroup(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'groups'] }); toast.success(t('admin.groupDeleted')); setDeleteGroup(null) },
  })
  const addMembersMut = useMutation({
    mutationFn: ({ groupId, userIds }: { groupId: string; userIds: string[] }) => adminApi.addGroupMembers(groupId, userIds),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'group-members', membersGroupId] }); qc.invalidateQueries({ queryKey: ['admin', 'groups'] }) },
  })
  const removeMemberMut = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) => adminApi.removeGroupMember(groupId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'group-members', membersGroupId] }); qc.invalidateQueries({ queryKey: ['admin', 'groups'] }) },
  })
  const deleteConnMut = useMutation({
    mutationFn: (id: string) => connectionsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connections'] }); setDeleteConn(null) },
  })

  const memberGroup = allGroups.find((g) => g.id === membersGroupId)
  const memberIds = new Set(members.map((m) => m.id))
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id))

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 h-12 px-6 border-b border-border-subtle bg-surface flex-shrink-0">
        <Shield className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-semibold">{t('admin.title')}</h1>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border-subtle bg-surface flex-shrink-0">
        {[
          { id: 'groups' as const, icon: UsersRound, label: t('admin.groups'), count: allGroups.length },
          { id: 'users' as const, icon: Users, label: t('admin.users'), count: allUsers.length },
          { id: 'connections' as const, icon: Database, label: t('admin.connections'), count: connections.length },
        ].map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)}
            className={cn('flex items-center gap-2 px-5 py-2.5 text-xs font-medium border-b-2 transition-colors',
              tab === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
            <span className="text-[10px] bg-surface-overlay px-1.5 py-0.5 rounded tabular-nums">{item.count}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Groups tab ── */}
        {tab === 'groups' && (
          <div>
            <div className="flex items-center justify-end px-4 py-2 border-b border-border-subtle">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setNewGroupOpen(true); setGroupName(''); setGroupDesc(''); setGroupColor(GROUP_COLORS[0]!) }}>
                <Plus className="h-3 w-3" />{t('admin.newGroup')}
              </Button>
            </div>
            {groupsLoading && <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div>}
            {allGroups.map((g) => (
              <GroupRow key={g.id} group={g}
                onEdit={() => { setEditGroup(g); setGroupName(g.name); setGroupDesc(g.description ?? ''); setGroupColor(g.color ?? GROUP_COLORS[0]!) }}
                onDelete={() => setDeleteGroup(g)}
                onManageMembers={() => setMembersGroupId(g.id)} />
            ))}
            {allGroups.length === 0 && !groupsLoading && <p className="p-6 text-sm text-muted-foreground">{t('admin.noGroups')}</p>}
          </div>
        )}

        {/* ── Users tab ── */}
        {tab === 'users' && (
          <div>
            {usersLoading && <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div>}
            {allUsers.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === currentUser?.id}
                onEdit={() => { setEditUser(u); setEditName(u.name); setEditEmail(u.email); setEditRole(u.role); setEditUserGroupIds([]) }}
                onDelete={() => setDeleteUser(u)} />
            ))}
            {allUsers.length === 0 && !usersLoading && <p className="p-6 text-sm text-muted-foreground">{t('admin.noUsers')}</p>}
          </div>
        )}

        {/* ── Connections tab ── */}
        {tab === 'connections' && (
          <div>
            <div className="flex items-center justify-end px-4 py-2 border-b border-border-subtle">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setEditConn(undefined); setConnModalOpen(true) }}>
                <Database className="h-3 w-3" />{t('conn.new')}
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

      {/* ══ Dialogs ══ */}

      {/* Create group */}
      <Dialog open={newGroupOpen} onOpenChange={(o) => { if (!o) setNewGroupOpen(false) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.newGroup')}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createGroupMut.mutate({ name: groupName, ...(groupDesc ? { description: groupDesc } : {}), color: groupColor }) }} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.groupName')}</Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} className="h-8 text-sm" autoFocus />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.groupDescription')}</Label>
              <Input value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="flex items-center gap-1.5">
              {GROUP_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setGroupColor(c)}
                  className={cn('w-6 h-6 rounded-full transition-all', groupColor === c ? 'ring-2 ring-offset-2 ring-offset-card' : 'opacity-60 hover:opacity-100')}
                  style={{ backgroundColor: c, ...(groupColor === c ? { ringColor: c } : {}) }} />
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setNewGroupOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm" disabled={!groupName.trim() || createGroupMut.isPending}>{t('sq.create')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit group */}
      <Dialog open={editGroup !== null} onOpenChange={(o) => { if (!o) setEditGroup(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.editGroup')}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (editGroup) updateGroupMut.mutate({ id: editGroup.id, data: { name: groupName, ...(groupDesc ? { description: groupDesc } : {}), color: groupColor } }) }} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.groupName')}</Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} className="h-8 text-sm" autoFocus />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.groupDescription')}</Label>
              <Input value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="flex items-center gap-1.5">
              {GROUP_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setGroupColor(c)}
                  className={cn('w-6 h-6 rounded-full transition-all', groupColor === c ? 'ring-2 ring-offset-2 ring-offset-card' : 'opacity-60 hover:opacity-100')}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditGroup(null)}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm" disabled={!groupName.trim() || updateGroupMut.isPending}>{t('sheet.save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete group */}
      <Dialog open={deleteGroup !== null} onOpenChange={(o) => { if (!o) setDeleteGroup(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.deleteGroup')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('admin.deleteGroupConfirm')}</p>
          <p className="text-sm font-semibold">{deleteGroup?.name}</p>
          <div className="pt-2">
            <SlideToConfirm label={t('admin.slideToDelete')} confirmLabel={t('common.delete')} variant="destructive"
              disabled={deleteGroupMut.isPending} onConfirm={() => deleteGroup && deleteGroupMut.mutate(deleteGroup.id)} />
          </div>
          <DialogFooter><Button variant="ghost" size="sm" onClick={() => setDeleteGroup(null)}>{t('common.cancel')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage group members */}
      <Dialog open={membersGroupId !== null} onOpenChange={(o) => { if (!o) setMembersGroupId(null) }}>
        <DialogContent className="sm:max-w-md bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.groupMembers')} — {memberGroup?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* Add members */}
            <ComboboxChips
              options={nonMembers.map((u) => ({ id: u.id, label: `${u.name} (${u.email})` }))}
              selected={[]}
              onChange={(ids) => { if (ids.length > 0 && membersGroupId) addMembersMut.mutate({ groupId: membersGroupId, userIds: ids }) }}
              placeholder={t('admin.addMembers')}
            />
            {/* Member list */}
            <div className="max-h-60 overflow-y-auto border border-border-subtle rounded-md divide-y divide-border-subtle">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">{m.name.charAt(0).toUpperCase()}</div>
                  <span className="flex-1 truncate">{m.name}</span>
                  <span className="text-text-muted truncate">{m.email}</span>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    onClick={() => membersGroupId && removeMemberMut.mutate({ groupId: membersGroupId, userId: m.id })}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {members.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground text-center">{t('admin.noUsers')}</p>}
            </div>
          </div>
          <DialogFooter><Button variant="ghost" size="sm" onClick={() => setMembersGroupId(null)}>{t('common.cancel')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user */}
      <Dialog open={editUser !== null} onOpenChange={(o) => { if (!o) setEditUser(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.editUser')}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (editUser) updateUserMut.mutate({ id: editUser.id, data: { name: editName, email: editEmail, role: editRole }, groupIds: editUserGroupIds }) }} className="space-y-4">
            <div className="space-y-2"><Label className="text-xs">{t('auth.register.name')}</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" /></div>
            <div className="space-y-2"><Label className="text-xs">Email</Label><Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" className="h-8 text-sm" /></div>
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.role')}</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full h-8 justify-between text-sm">
                    {t(`user.role.${editRole}` as 'user.role.admin')}<ChevronDown className="h-3 w-3 opacity-50" />
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
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.groups')}</Label>
              <ComboboxChips
                options={allGroups.map((g) => ({ id: g.id, label: g.name, color: g.color ?? undefined }))}
                selected={editUserGroupIds}
                onChange={setEditUserGroupIds}
                placeholder={t('admin.addGroups')}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditUser(null)}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm" disabled={updateUserMut.isPending}>{t('sheet.save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete user */}
      <Dialog open={deleteUser !== null} onOpenChange={(o) => { if (!o) setDeleteUser(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('admin.deleteUser')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('admin.deleteUserConfirm')}</p>
          <p className="text-sm font-semibold">{deleteUser?.name} ({deleteUser?.email})</p>
          <div className="pt-2">
            <SlideToConfirm label={t('admin.slideToDelete')} confirmLabel={t('common.delete')} variant="destructive"
              disabled={deleteUserMut.isPending} onConfirm={() => deleteUser && deleteUserMut.mutate(deleteUser.id)} />
          </div>
          <DialogFooter><Button variant="ghost" size="sm" onClick={() => setDeleteUser(null)}>{t('common.cancel')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete connection */}
      <Dialog open={deleteConn !== null} onOpenChange={(o) => { if (!o) setDeleteConn(null) }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('conn.delete')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('conn.deleteConfirm')}</p>
          <p className="text-sm font-semibold">{deleteConn?.name}</p>
          <div className="pt-2">
            <SlideToConfirm label={t('admin.slideToDelete')} confirmLabel={t('common.delete')} variant="destructive"
              disabled={deleteConnMut.isPending} onConfirm={() => deleteConn && deleteConnMut.mutate(deleteConn.id)} />
          </div>
          <DialogFooter><Button variant="ghost" size="sm" onClick={() => setDeleteConn(null)}>{t('common.cancel')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connection modal */}
      <ConnectionModal key={editConn?.id ?? 'new'} open={connModalOpen}
        onClose={() => { setConnModalOpen(false); setEditConn(undefined) }} editing={editConn} />
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { SlideToConfirm } from '@/components/ui/slide-to-confirm'
import { PrivilegeCheckboxList } from './PrivilegeCheckboxList'
import { dbUsersApi } from '@/api/db-users'
import type { DbUser, DbUserPrivileges } from '@/api/db-users'
import type { DbDriver } from '@/api/connections'

// ── Privilege lists per driver ───────────────────
const MYSQL_SERVER_PRIVS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
  'RELOAD', 'SHUTDOWN', 'PROCESS', 'FILE', 'GRANT OPTION', 'REFERENCES',
  'INDEX', 'ALTER', 'SHOW DATABASES', 'SUPER', 'CREATE TEMPORARY TABLES',
  'LOCK TABLES', 'EXECUTE', 'REPLICATION SLAVE', 'REPLICATION CLIENT',
  'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE',
  'CREATE USER', 'EVENT', 'TRIGGER',
]
const MYSQL_TABLE_PRIVS = [
  'SELECT', 'INSERT', 'UPDATE', 'REFERENCES', 'DELETE', 'CREATE', 'DROP',
  'ALTER', 'INDEX', 'TRIGGER', 'CREATE VIEW', 'SHOW VIEW', 'GRANT',
  'EXECUTE', 'ALTER ROUTINE', 'CREATE ROUTINE', 'CREATE TEMPORARY TABLES',
  'LOCK TABLES', 'EVENT',
]
const PG_SERVER_PRIVS = ['SUPERUSER', 'CREATEDB', 'CREATEROLE', 'LOGIN', 'REPLICATION', 'BYPASSRLS']
const PG_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const ORACLE_SERVER_PRIVS = [
  'CREATE SESSION', 'CREATE TABLE', 'CREATE VIEW', 'CREATE PROCEDURE',
  'CREATE SEQUENCE', 'CREATE TRIGGER', 'CREATE TYPE', 'CREATE USER',
  'DROP ANY TABLE', 'ALTER ANY TABLE', 'SELECT ANY TABLE', 'INSERT ANY TABLE',
  'UPDATE ANY TABLE', 'DELETE ANY TABLE', 'GRANT ANY PRIVILEGE', 'SYSDBA', 'SYSOPER',
]
const ORACLE_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'INDEX', 'REFERENCES', 'EXECUTE']

function serverPrivsList(driver: DbDriver): string[] {
  if (driver === 'mysql') return MYSQL_SERVER_PRIVS
  if (driver === 'postgresql') return PG_SERVER_PRIVS
  return ORACLE_SERVER_PRIVS
}

function tablePrivsList(driver: DbDriver): string[] {
  if (driver === 'mysql') return MYSQL_TABLE_PRIVS
  if (driver === 'postgresql') return PG_TABLE_PRIVS
  return ORACLE_TABLE_PRIVS
}

// ── Types ────────────────────────────────────────
type TablePrivEntry = {
  id: string
  database: string
  table: string
  privileges: Record<string, boolean>
}

type Props = {
  connectionId: string
  driver: DbDriver
  selectedUser: DbUser | null
  isCreating: boolean
  onSaved: () => void
  onDropped: () => void
}

export function DbUserForm({ connectionId, driver, selectedUser, isCreating, onSaved, onDropped }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()

  // Form state
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('%')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [serverPrivs, setServerPrivs] = useState<Record<string, boolean>>({})
  const [tableEntries, setTableEntries] = useState<TablePrivEntry[]>([])
  const [advanced, setAdvanced] = useState<DbUserPrivileges['advanced']>({})

  // Fetch existing privileges when a user is selected
  const { data: privData, isLoading: privLoading } = useQuery({
    queryKey: ['db-user-privileges', connectionId, selectedUser?.username, selectedUser?.host],
    queryFn: () => dbUsersApi.getPrivileges(connectionId, selectedUser!.username, selectedUser!.host),
    enabled: !!selectedUser && !isCreating,
  })

  // Populate form when selection or priv data changes
  useEffect(() => {
    if (isCreating || !selectedUser) {
      setUsername('')
      setHost('%')
      setPassword('')
      setConfirmPassword('')
      setServerPrivs({})
      setTableEntries([])
      setAdvanced({})
      return
    }
    if (privData) {
      setUsername(selectedUser.username)
      setHost(selectedUser.host ?? '%')
      setPassword('')
      setConfirmPassword('')
      setServerPrivs(privData.serverPrivileges)
      setTableEntries(
        privData.tablePrivileges.map((tp, i) => ({
          id: String(i),
          database: tp.database,
          table: tp.table,
          privileges: Object.fromEntries(tp.privileges.map((p) => [p, true])),
        }))
      )
      setAdvanced(privData.advanced)
    }
  }, [selectedUser, privData, isCreating])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['db-users', connectionId] })
    qc.invalidateQueries({ queryKey: ['db-user-privileges', connectionId] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      dbUsersApi.create(connectionId, {
        username,
        host: driver === 'mysql' ? host : '%',
        password,
        serverPrivileges: serverPrivs,
        tablePrivileges: tableEntries.map((e) => ({
          database: e.database,
          table: e.table,
          privileges: Object.entries(e.privileges).filter(([, v]) => v).map(([p]) => p),
        })),
        advanced,
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('dbusers.created'))
      onSaved()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      dbUsersApi.update(connectionId, selectedUser!.username, {
        host: driver === 'mysql' ? host : '%',
        password: password || undefined,
        serverPrivileges: serverPrivs,
        tablePrivileges: tableEntries.map((e) => ({
          database: e.database,
          table: e.table,
          privileges: Object.entries(e.privileges).filter(([, v]) => v).map(([p]) => p),
        })),
        advanced,
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('dbusers.updated'))
      onSaved()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const dropMutation = useMutation({
    mutationFn: () =>
      dbUsersApi.drop(connectionId, selectedUser!.username, driver === 'mysql' ? (selectedUser!.host ?? '%') : undefined),
    onSuccess: () => {
      invalidate()
      toast.success(t('dbusers.dropped'))
      onDropped()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const handleSubmit = () => {
    if (!username.trim()) return
    if (password !== confirmPassword) {
      toast.error(t('dbusers.passwordMismatch'))
      return
    }
    if (isCreating) createMutation.mutate()
    else updateMutation.mutate()
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  const addTableEntry = () => {
    setTableEntries((prev) => [
      ...prev,
      { id: String(Date.now()), database: '', table: '', privileges: {} },
    ])
  }

  const removeTableEntry = (id: string) => {
    setTableEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const updateTableEntry = (id: string, field: 'database' | 'table', value: string) => {
    setTableEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)))
  }

  const updateTablePriv = (id: string, priv: string, value: boolean) => {
    setTableEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, privileges: { ...e.privileges, [priv]: value } } : e))
    )
  }

  if (!isCreating && !selectedUser) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t('dbusers.noUserSelected')}
      </div>
    )
  }

  if (!isCreating && privLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="identity">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="identity">{t('dbusers.identity')}</TabsTrigger>
            <TabsTrigger value="server">{t('dbusers.serverPrivileges')}</TabsTrigger>
            <TabsTrigger value="table">{t('dbusers.tablePrivileges')}</TabsTrigger>
            <TabsTrigger value="advanced">{t('dbusers.advanced')}</TabsTrigger>
          </TabsList>

          {/* ── Identity tab ── */}
          <TabsContent value="identity" className="space-y-3 mt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('dbusers.username')}</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!isCreating}
                placeholder="myuser"
                className="h-8 text-sm"
              />
            </div>
            {driver === 'mysql' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('dbusers.host')}</Label>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="%"
                  className="h-8 text-sm"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('dbusers.password')}
                {!isCreating && (
                  <span className="ml-1 font-normal text-muted-foreground">({t('dbusers.passwordOptional')})</span>
                )}
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 text-sm"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('dbusers.confirmPassword')}</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-8 text-sm"
                autoComplete="new-password"
              />
            </div>
          </TabsContent>

          {/* ── Server privileges tab ── */}
          <TabsContent value="server" className="mt-4">
            <PrivilegeCheckboxList
              privileges={serverPrivsList(driver)}
              checked={serverPrivs}
              onChange={(priv, value) => setServerPrivs((prev) => ({ ...prev, [priv]: value }))}
            />
          </TabsContent>

          {/* ── Table privileges tab ── */}
          <TabsContent value="table" className="mt-4 space-y-4">
            {tableEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-3 space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{t('dbusers.database')}</Label>
                    <Input
                      value={entry.database}
                      onChange={(e) => updateTableEntry(entry.id, 'database', e.target.value)}
                      placeholder="mydb"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{t('dbusers.table')}</Label>
                    <Input
                      value={entry.table}
                      onChange={(e) => updateTableEntry(entry.id, 'table', e.target.value)}
                      placeholder="mytable"
                      className="h-7 text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTableEntry(entry.id)}
                    className="mt-5 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <PrivilegeCheckboxList
                  privileges={tablePrivsList(driver)}
                  checked={entry.privileges}
                  onChange={(priv, value) => updateTablePriv(entry.id, priv, value)}
                />
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addTableEntry}>
              <Plus className="h-3.5 w-3.5" />
              {t('dbusers.addTablePrivilege')}
            </Button>
          </TabsContent>

          {/* ── Advanced tab ── */}
          <TabsContent value="advanced" className="mt-4 space-y-3">
            {driver === 'mysql' && (
              <>
                {(
                  [
                    ['maxQueriesPerHour', 'dbusers.maxQueriesPerHour'],
                    ['maxUpdatesPerHour', 'dbusers.maxUpdatesPerHour'],
                    ['maxConnectionsPerHour', 'dbusers.maxConnectionsPerHour'],
                    ['maxUserConnections', 'dbusers.maxUserConnections'],
                  ] as const
                ).map(([field, labelKey]) => (
                  <div key={field} className="space-y-1.5">
                    <Label className="text-xs">{t(labelKey)}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={(advanced as any)[field] ?? 0}
                      onChange={(e) =>
                        setAdvanced((prev) => ({ ...prev, [field]: Number(e.target.value) }))
                      }
                      className="h-8 text-sm w-40"
                    />
                  </div>
                ))}
              </>
            )}
            {driver === 'postgresql' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('dbusers.connectionLimit')}</Label>
                <Input
                  type="number"
                  min={-1}
                  value={advanced.connectionLimit ?? -1}
                  onChange={(e) =>
                    setAdvanced((prev) => ({ ...prev, connectionLimit: Number(e.target.value) }))
                  }
                  className="h-8 text-sm w-40"
                />
              </div>
            )}
            {driver === 'oracle' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('dbusers.profile')}</Label>
                <Input value={advanced.profile ?? ''} disabled className="h-8 text-sm w-60" />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-4 space-y-3">
        {!isCreating && selectedUser && (
          <SlideToConfirm
            label={t('dbusers.dropUser')}
            confirmLabel={t('dbusers.slideToDropUser')}
            onConfirm={() => dropMutation.mutate()}
            disabled={dropMutation.isPending}
          />
        )}
        <Button
          className="w-full"
          size="sm"
          disabled={isPending || !username.trim()}
          onClick={handleSubmit}
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
          {t('dbusers.save')}
        </Button>
      </div>
    </div>
  )
}

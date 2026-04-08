import { useState } from 'react'
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CheckCircle, XCircle, Loader2, Link2, FormInput } from 'lucide-react'
import { DriverIcon } from '@/components/ui/driver-icon'
import { ComboboxChips } from '@/components/ui/combobox-chips'
import { connectionsApi, type Connection, type CreateConnectionInput, type DbDriver } from '@/api/connections'
import { sharingApi } from '@/api/sharing'
import { useAuthStore } from '@/stores/auth.store'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onClose: () => void
  editing: Connection | undefined
}

const COLORS = ['#41cd2a', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

const ENVIRONMENTS = ['prod', 'staging', 'dev', 'local'] as const

function envBadgeStyle(env: string): string {
  switch (env.toLowerCase()) {
    case 'prod': return 'bg-destructive/15 text-destructive border-destructive/30'
    case 'staging': return 'bg-warning/15 text-warning border-warning/30'
    case 'dev': return 'bg-primary/15 text-primary border-primary/30'
    case 'local': return 'bg-muted text-muted-foreground border-border'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

// ── Parse connection string ─────────────────────
// Supports: postgresql://user:pass@host:port/db?sslmode=require
//           mysql://user:pass@host:port/db
function parseConnectionString(raw: string): Partial<CreateConnectionInput> | null {
  const trimmed = raw.trim()
  if (!trimmed.includes('://')) return null

  try {
    // Handle postgres:// alias
    const normalized = trimmed.replace(/^postgres:\/\//, 'postgresql://')
    const url = new URL(normalized)

    let driver: DbDriver = 'postgresql'
    if (url.protocol === 'mysql:') driver = 'mysql'
    else if (url.protocol !== 'postgresql:') return null

    const defaultPort = driver === 'postgresql' ? 5432 : 3306
    const ssl = url.searchParams.get('sslmode') === 'require' ||
                url.searchParams.get('ssl') === 'true'

    return {
      driver,
      host: url.hostname,
      port: url.port ? Number(url.port) : defaultPort,
      database: url.pathname.replace(/^\//, '') || (driver === 'postgresql' ? 'postgres' : ''),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl,
    }
  } catch {
    return null
  }
}

export function ConnectionModal({ open, onClose, editing }: Props) {
  const qc = useQueryClient()
  const { t } = useI18n()

  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [form, setForm] = useState<CreateConnectionInput>({
    name: editing?.name ?? '',
    driver: editing?.driver ?? 'postgresql',
    host: editing?.host ?? 'localhost',
    port: editing?.port ?? 5432,
    database: editing?.database ?? '',
    username: editing?.username ?? '',
    password: '',
    filePath: editing?.filePath ?? '',
    ssl: editing?.ssl ?? false,
    color: editing?.color ?? COLORS[0] ?? '#41cd2a',
    environment: editing?.environment ?? '',
  })

  const [shareGroupIds, setShareGroupIds] = useState<string[]>([])
  const [shareUserIds, setShareUserIds] = useState<string[]>([])

  // Fetch available groups + users for sharing
  const { data: groupsData } = useQuery({
    queryKey: ['sharing', 'groups'],
    queryFn: sharingApi.groups,
    enabled: isAdmin,
    staleTime: 60_000,
  })
  const availableGroups = groupsData?.groups ?? []

  const { data: usersData } = useQuery({
    queryKey: ['sharing', 'users'],
    queryFn: sharingApi.users,
    enabled: isAdmin,
    staleTime: 60_000,
  })
  const availableUsers = usersData?.users ?? []

  // Load existing group assignments when editing
  const { data: connSharesData } = useQuery({
    queryKey: ['connection-shares', editing?.id],
    queryFn: () => connectionsApi.getConnectionShares(editing!.id),
    enabled: !!editing?.id && isAdmin,
  })
  const [sharesSynced, setSharesSynced] = useState(false)
  if (connSharesData && !sharesSynced) {
    setShareGroupIds((connSharesData.groups ?? []).map((g) => g.id))
    setShareUserIds((connSharesData.users ?? []).map((u) => u.id))
    setSharesSynced(true)
  }

  const [connString, setConnString] = useState('')
  const [parseError, setParseError] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const set = <K extends keyof CreateConnectionInput>(k: K, v: CreateConnectionInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handlePasteConnString = (value: string) => {
    setConnString(value)
    setParseError('')

    if (!value.trim()) return

    const parsed = parseConnectionString(value)
    if (!parsed) {
      setParseError(t('conn.parseError'))
      return
    }

    // Fill form fields from parsed string
    setForm((f) => {
      const merged = { ...f, ...parsed }
      return {
        ...merged,
        name: f.name || `${parsed.host ?? 'localhost'}/${parsed.database ?? ''}`,
        color: f.color ?? '#41cd2a',
      }
    })
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const result = editing
        ? await connectionsApi.update(editing.id, form)
        : await connectionsApi.create(form)
      // Save share assignments if admin
      if (isAdmin) {
        const connId = editing?.id ?? result.connection.id
        await connectionsApi.setConnectionShares(connId, shareGroupIds, shareUserIds)
      }
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      qc.invalidateQueries({ queryKey: ['connection-shares'] })
      onClose()
    },
  })

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = editing
        ? await connectionsApi.test(editing.id)
        : form.driver === 'sqlite'
        ? await connectionsApi.testRaw({ driver: 'sqlite', filePath: form.filePath, ssl: false })
        : await connectionsApi.testRaw({
            driver: form.driver,
            host: form.host,
            port: form.port,
            database: form.database,
            username: form.username,
            password: form.password,
            ssl: form.ssl,
          })
      setTestResult({ ok: r.ok, msg: r.ok ? `OK — ${r.latencyMs}ms` : (r.error ?? t('conn.testFail')) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('conn.testFail')
      setTestResult({ ok: false, msg })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md bg-card border-border-subtle">
        <DialogHeader>
          <DialogTitle className="text-base">
            {editing ? t('conn.titleEdit') : t('conn.titleNew')}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
          className="space-y-4"
        >
          {/* ── Mode toggle (create only) ────────── */}
          {!editing && (
            <Tabs defaultValue="string">
              <TabsList className="w-full">
                <TabsTrigger value="string" className="flex-1 gap-1.5">
                  <Link2 className="h-3 w-3" />
                  {t('conn.tabString')}
                </TabsTrigger>
                <TabsTrigger value="manual" className="flex-1 gap-1.5">
                  <FormInput className="h-3 w-3" />
                  {t('conn.tabManual')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="string">
                <div className="space-y-2">
                  <Label>{t('conn.pasteString')}</Label>
                  <Input
                    value={connString}
                    onChange={(e) => handlePasteConnString(e.target.value)}
                    placeholder="postgresql://user:password@host:5432/mydb"
                    className="font-mono text-xs"
                    autoFocus
                  />
                  {parseError && (
                    <p className="text-xs text-destructive">{parseError}</p>
                  )}
                  {connString && !parseError && form.host !== 'localhost' && (
                    <div className="rounded-md border border-primary/20 bg-dblumi-subtle p-2.5 text-xs text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      <span className="text-text-muted">{t('conn.parsedDriver')}</span><span>{form.driver}</span>
                      <span className="text-text-muted">{t('conn.parsedHost')}</span><span>{form.host}:{form.port}</span>
                      <span className="text-text-muted">{t('conn.parsedDb')}</span><span>{form.database}</span>
                      <span className="text-text-muted">{t('conn.parsedUser')}</span><span>{form.username}</span>
                      <span className="text-text-muted">{t('conn.parsedSsl')}</span><span>{form.ssl ? t('conn.parsedSslYes') : t('conn.parsedSslNo')}</span>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="manual">
                <ManualFields form={form} set={set} editing={false} t={t} />
              </TabsContent>
            </Tabs>
          )}

          {/* When editing, always show manual fields */}
          {editing && <ManualFields form={form} set={set} editing={true} t={t} />}

          {/* Name (always visible) */}
          <div className="space-y-1.5">
            <Label>{t('conn.name')}</Label>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder={t('conn.namePlaceholder')}
            />
          </div>

          {/* Environment */}
          <div className="space-y-1.5">
            <Label>
              {t('conn.environment')}{' '}
              <span className="text-text-muted font-normal">{t('conn.environmentOptional')}</span>
            </Label>
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                {ENVIRONMENTS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => set('environment', form.environment === e ? '' : e)}
                    className={cn(
                      'px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide border transition-all',
                      form.environment === e
                        ? envBadgeStyle(e)
                        : 'bg-transparent text-text-muted border-border hover:border-border-strong hover:text-muted-foreground',
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <Input
                value={
                  ENVIRONMENTS.includes(form.environment as typeof ENVIRONMENTS[number])
                    ? ''
                    : (form.environment ?? '')
                }
                onChange={(e) => set('environment', e.target.value)}
                placeholder="custom…"
                className="h-7 text-xs flex-1"
                maxLength={12}
              />
            </div>
          </div>

          {/* Visibility */}
          {isAdmin && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('admin.connGroups')}</Label>
              <ComboboxChips
                options={[
                  ...availableGroups.map((g) => ({ id: `g:${g.id}`, label: `${g.name}`, color: g.color ?? undefined })),
                  ...availableUsers.map((u) => ({ id: `u:${u.id}`, label: `${u.name} (${u.email})`, minQuery: 3 })),
                ]}
                selected={[...shareGroupIds.map((id) => `g:${id}`), ...shareUserIds.map((id) => `u:${id}`)]}
                onChange={(ids) => {
                  setShareGroupIds(ids.filter((id) => id.startsWith('g:')).map((id) => id.slice(2)))
                  setShareUserIds(ids.filter((id) => id.startsWith('u:')).map((id) => id.slice(2)))
                }}
                placeholder={t('admin.addMembers')}
              />
            </div>
          )}

          {/* SSL + Color dots */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {form.driver !== 'sqlite' && (
                <>
                  <Switch
                    id="ssl-toggle"
                    checked={form.ssl}
                    onCheckedChange={(checked) => set('ssl', checked)}
                  />
                  <Label htmlFor="ssl-toggle" className="text-sm text-muted-foreground cursor-pointer">
                    SSL
                  </Label>
                </>
              )}
            </div>

            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('color', c)}
                  className={cn(
                    'w-4 h-4 rounded-full transition-all',
                    form.color === c
                      ? 'scale-125 ring-2 ring-white/30'
                      : 'opacity-50 hover:opacity-100',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
                testResult.ok
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-destructive/30 bg-destructive/10 text-destructive',
              )}
            >
              {testResult.ok ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {testResult.msg}
            </div>
          )}

          {mutation.error && (
            <p className="text-xs text-destructive">{(mutation.error as Error).message}</p>
          )}

          <Separator />

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={handleTest} disabled={testing || (form.driver === 'sqlite' ? !form.filePath : !form.host)}>
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('conn.test')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {t('conn.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editing ? t('conn.save') : t('conn.create')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Manual form fields (extracted for reuse) ────
function ManualFields({
  form,
  set,
  editing,
  t,
}: {
  form: CreateConnectionInput
  set: <K extends keyof CreateConnectionInput>(k: K, v: CreateConnectionInput[K]) => void
  editing: boolean
  t: (key: string) => string
}) {
  const isSQLite = form.driver === 'sqlite'

  return (
    <>
      {/* Driver toggle */}
      <div className="space-y-1.5">
        <Label>{t('conn.parsedDriver')}</Label>
        <div className="inline-flex w-full rounded-md border border-border-strong overflow-hidden">
          {(['postgresql', 'mysql', 'oracle', 'sqlite'] as const).map((d, i, arr) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                set('driver', d)
                if (d !== 'sqlite') set('port', d === 'postgresql' ? 5432 : d === 'mysql' ? 3306 : 1521)
              }}
              className={cn(
                'flex-1 h-9 text-xs font-medium transition-colors',
                form.driver === d
                  ? 'bg-surface-overlay text-foreground'
                  : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-raised',
                i < arr.length - 1 && 'border-r border-border-strong',
              )}
            >
              <DriverIcon driver={d} className="h-3.5 w-3.5 inline-block mr-1" />
              {d === 'postgresql' ? 'PostgreSQL' : d === 'mysql' ? 'MySQL' : d === 'oracle' ? 'Oracle' : 'SQLite'}
            </button>
          ))}
        </div>
      </div>

      {isSQLite ? (
        /* SQLite — file path only */
        <div className="space-y-1.5">
          <Label>{t('conn.filePath')}</Label>
          <Input
            value={form.filePath ?? ''}
            onChange={(e) => set('filePath', e.target.value)}
            placeholder={t('conn.filePathPlaceholder')}
            required
          />
        </div>
      ) : (
        <>
          {/* Host + Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>{t('conn.host')}</Label>
              <Input value={form.host ?? ''} onChange={(e) => set('host', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('conn.port')}</Label>
              <Input
                type="number"
                value={form.port ?? ''}
                onChange={(e) => set('port', Number(e.target.value))}
                required
              />
            </div>
          </div>

          {/* Database */}
          <div className="space-y-1.5">
            <Label>{t('conn.database')} <span className="text-text-muted font-normal text-xs">{t('conn.databaseHint')}</span></Label>
            <Input value={form.database ?? ''} onChange={(e) => set('database', e.target.value)} placeholder={t('conn.databasePlaceholder')} />
          </div>

          {/* Username + Password */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('conn.username')}</Label>
              <Input value={form.username ?? ''} onChange={(e) => set('username', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('conn.password')}</Label>
              <Input
                type="password"
                value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                placeholder={editing ? t('conn.passwordUnchanged') : ''}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}

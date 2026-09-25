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
import { CheckCircle, XCircle, Loader2, Link2, FormInput, Copy, Check } from 'lucide-react'
import { DriverIcon } from '@/components/ui/driver-icon'
import { ComboboxChips } from '@/components/ui/combobox-chips'
import { connectionsApi, type Connection, type CreateConnectionInput, type DbDriver } from '@/api/connections'
import { sharingApi } from '@/api/sharing'
import { useAuthStore } from '@/stores/auth.store'
import { useI18n, type TranslationKey } from '@/i18n'
import { DEFAULT_PORTS, DRIVER_LABELS } from '@/lib/drivers'
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

const DRIVERS: DbDriver[] = ['postgresql', 'mysql', 'oracle', 'mssql', 'sqlite', 'trino', 'snowflake', 'mongodb', 'redis']

/** Options without their empty entries (a cleared Warehouse field). */
function filledOptions(options: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(options ?? {}).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
}

const isMongoUri = (host: string | undefined) => !!host && /^mongodb(\+srv)?:\/\//i.test(host.trim())
const isRedisUrl = (host: string | undefined) => !!host && /^rediss?:\/\//i.test(host.trim())

const MONGO_URI = /^(mongodb(?:\+srv)?):\/\/(.*)$/is

/**
 * mongodb:// and mongodb+srv:// strings. `new URL()` rejects multi-host URIs,
 * hence the manual parse. A single plain host is split into host + port; anything
 * else (SRV, replica set, options) stays a credential-free URI in the host field.
 */
function parseMongoConnectionString(raw: string): Partial<CreateConnectionInput> | null {
  const m = raw.match(MONGO_URI)
  if (!m) return null
  const scheme = m[1]!.toLowerCase()
  const rest = m[2] ?? ''
  const queryAt = rest.indexOf('?')
  const query = queryAt === -1 ? '' : rest.slice(queryAt)
  const beforeQuery = queryAt === -1 ? rest : rest.slice(0, queryAt)
  // Hosts never contain '@': credentials end at the LAST one, so a password
  // with an unescaped '@' or '/' is still split out whole.
  const at = beforeQuery.lastIndexOf('@')
  const userinfo = at === -1 ? '' : beforeQuery.slice(0, at)
  const hostPath = beforeQuery.slice(at + 1)
  const slash = hostPath.indexOf('/')
  const hosts = slash === -1 ? hostPath : hostPath.slice(0, slash)
  const rawDb = slash === -1 ? '' : hostPath.slice(slash + 1)
  const sep = userinfo.indexOf(':')
  const user = sep === -1 ? userinfo : userinfo.slice(0, sep)
  const pass = sep === -1 ? '' : userinfo.slice(sep + 1)
  if (!hosts) return null
  const decode = (v: string) => { try { return decodeURIComponent(v) } catch { return v } }
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  const database = decode(rawDb)
  // A URI authenticates against its path database: keep that once the path
  // becomes the "database" field.
  if (database && user && !params.has('authSource')) params.set('authSource', database)
  const ssl = scheme === 'mongodb+srv' || params.get('tls') === 'true' || params.get('ssl') === 'true'
  params.delete('tls')
  params.delete('ssl')

  const single = hosts.match(/^([^,:[\]]+|\[[^\]]+\])(?::(\d+))?$/)
  const plain = scheme === 'mongodb' && single && [...params.keys()].length === 0
  const qs = params.toString()
  return {
    driver: 'mongodb',
    host: plain ? single[1]!.replace(/^\[|\]$/g, '') : `${scheme}://${hosts}/${qs ? `?${qs}` : ''}`,
    port: plain && single[2] ? Number(single[2]) : 27017,
    database,
    username: decode(user),
    password: decode(pass),
    ssl,
  }
}

/** snowflake://user:pass@account/database/schema?warehouse=WH&role=ROLE (the SQLAlchemy form). */
function parseSnowflakeConnectionString(url: URL): Partial<CreateConnectionInput> {
  const decode = (v: string) => { try { return decodeURIComponent(v) } catch { return v } }
  const options: Record<string, string> = {}
  const warehouse = url.searchParams.get('warehouse')
  const role = url.searchParams.get('role')
  if (warehouse) options['warehouse'] = warehouse
  if (role) options['role'] = role
  return {
    driver: 'snowflake',
    host: url.hostname,
    database: decode(url.pathname.replace(/^\/+|\/+$/g, '')),
    username: decode(url.username),
    password: decode(url.password),
    ssl: true,
    options,
  }
}

// ── Parse connection string ─────────────────────
// Supports: postgresql://user:pass@host:port/db?sslmode=require
//           mysql://user:pass@host:port/db
//           sqlserver://user:pass@host:port/db (also mssql://)
//           trino://user@host:port/catalog/schema?ssl=true  (password optional)
//           snowflake://user:pass@account/db/schema?warehouse=WH&role=ROLE
//           mongodb://user:pass@host:port/db, mongodb+srv://user:pass@cluster/db?opts
//           redis://[user:]pass@host:port/0, rediss:// for TLS
function parseConnectionString(raw: string): Partial<CreateConnectionInput> | null {
  const trimmed = raw.trim()
  if (!trimmed.includes('://')) return null
  if (/^mongodb(\+srv)?:\/\//i.test(trimmed)) return parseMongoConnectionString(trimmed)

  try {
    // Handle postgres:// alias
    const normalized = trimmed.replace(/^postgres:\/\//, 'postgresql://')
    const url = new URL(normalized)

    if (url.protocol === 'snowflake:') return parseSnowflakeConnectionString(url)
    if (url.protocol === 'redis:' || url.protocol === 'rediss:') {
      return {
        driver: 'redis',
        host: url.hostname,
        port: url.port ? Number(url.port) : 6379,
        database: url.pathname.replace(/^\//, '') || '0',
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        ssl: url.protocol === 'rediss:',
      }
    }

    let driver: DbDriver = 'postgresql'
    if (url.protocol === 'mysql:') driver = 'mysql'
    else if (url.protocol === 'sqlserver:' || url.protocol === 'mssql:') driver = 'mssql'
    else if (url.protocol === 'trino:' || url.protocol === 'trinos:') driver = 'trino'
    else if (url.protocol !== 'postgresql:') return null

    const defaultPort = DEFAULT_PORTS[driver] ?? 5432
    // Trino has no `sslmode` param: TLS just means an https coordinator, carried
    // by `ssl=true`. `trinos:` is still accepted as a legacy input form.
    const ssl =
      url.protocol === 'trinos:' ||
      url.searchParams.get('sslmode') === 'require' ||
      url.searchParams.get('ssl') === 'true'

    // Trino: the path holds the target as "catalog" or "catalog/schema" — keep it verbatim.
    const path = url.pathname.replace(/^\//, '')

    return {
      driver,
      host: url.hostname,
      port: url.port ? Number(url.port) : defaultPort,
      database: driver === 'trino' ? path : path || (driver === 'postgresql' ? 'postgres' : ''),
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
    port: editing?.port ?? DEFAULT_PORTS[editing?.driver ?? 'postgresql'] ?? 5432,
    database: editing?.database ?? '',
    username: editing?.username ?? '',
    password: '',
    filePath: editing?.filePath ?? '',
    ssl: editing?.ssl ?? false,
    options: editing?.options ?? {},
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
  const [copied, setCopied] = useState(false)

  const buildConnectionString = (): string => {
    if (form.driver === 'sqlite') return `sqlite://${form.filePath ?? ''}`
    if (form.driver === 'mongodb') {
      const user = encodeURIComponent(form.username ?? '')
      const auth = user ? `${user}:${form.password ? encodeURIComponent(form.password) : '<password>'}@` : ''
      const db = form.database ? `/${encodeURIComponent(form.database)}` : '/'
      const host = form.host ?? ''
      if (isMongoUri(host)) {
        // Credentials go back between the scheme and the hosts; the path is the database.
        const m = host.match(/^(mongodb(?:\+srv)?:\/\/)([^/?#]*)[^?#]*(\?.*)?$/i)
        return m ? `${m[1]}${auth}${m[2]}${db}${m[3] ?? ''}` : host
      }
      return `mongodb://${auth}${host}:${form.port ?? 27017}${db}${form.ssl ? '?tls=true' : ''}`
    }
    if (form.driver === 'redis') {
      if (isRedisUrl(form.host)) return form.host!.trim()
      const user = encodeURIComponent(form.username ?? '')
      const auth = form.password || user ? `${user}:${form.password ? encodeURIComponent(form.password) : '<password>'}@` : ''
      return `${form.ssl ? 'rediss' : 'redis'}://${auth}${form.host ?? ''}:${form.port ?? 6379}/${form.database || '0'}`
    }
    if (form.driver === 'snowflake') {
      const params = new URLSearchParams(Object.entries(form.options ?? {}).filter(([, v]) => v))
      const qs = params.toString()
      const pwd = form.password ? encodeURIComponent(form.password) : '<password>'
      return `snowflake://${encodeURIComponent(form.username ?? '')}:${pwd}@${form.host ?? ''}/${form.database ?? ''}${qs ? `?${qs}` : ''}`
    }
    const isTrinoDriver = form.driver === 'trino'
    const scheme = form.driver === 'mysql' ? 'mysql'
      : form.driver === 'oracle' ? 'oracle'
      : form.driver === 'mssql' ? 'sqlserver'
      : isTrinoDriver ? 'trino' : 'postgresql'
    const user = encodeURIComponent(form.username ?? '')
    const pwd = form.password ? encodeURIComponent(form.password) : '<password>'
    // Trino authentication is optional: without a password the user is sent alone.
    const auth = user ? (isTrinoDriver && !form.password ? `${user}@` : `${user}:${pwd}@`) : ''
    const host = form.host ?? ''
    const port = form.port != null ? `:${form.port}` : ''
    const db = form.database ? `/${form.database}` : ''
    // Trino has no `sslmode` parameter (TLS just means an https coordinator), and
    // no `trinos://` scheme exists in any Trino client — so TLS travels as `ssl=true`,
    // which parseConnectionString understands for every driver.
    const ssl = form.ssl ? (isTrinoDriver ? '?ssl=true' : '?sslmode=require') : ''
    return `${scheme}://${auth}${host}${port}${db}${ssl}`
  }

  const handleCopyString = async () => {
    try {
      await navigator.clipboard.writeText(buildConnectionString())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // noop
    }
  }

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
        // A MongoDB URI host is named after its (first) cluster host, not the whole URI.
        name: f.name || `${(parsed.host ?? 'localhost').replace(/^mongodb(\+srv)?:\/\//i, '').split(/[/?,]/)[0]}/${parsed.database ?? ''}`,
        color: f.color ?? '#41cd2a',
      }
    })
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: CreateConnectionInput = {
        name: form.name,
        driver: form.driver,
        ssl: form.ssl,
        ...(form.host ? { host: form.host } : {}),
        // Snowflake is reached by account: the port left by another driver is not sent.
        ...(form.port != null && form.driver !== 'snowflake' ? { port: form.port } : {}),
        ...(form.database ? { database: form.database } : {}),
        ...(form.username ? { username: form.username } : {}),
        ...(form.password ? { password: form.password } : {}),
        ...(form.filePath ? { filePath: form.filePath } : {}),
        // Snowflake warehouse/role; cleared (null) when an edited connection leaves Snowflake.
        ...(form.driver === 'snowflake'
          ? { options: filledOptions(form.options) }
          : editing?.options ? { options: null } : {}),
        ...(form.color ? { color: form.color } : {}),
        ...(form.environment ? { environment: form.environment } : {}),
      }
      const result = editing
        ? await connectionsApi.update(editing.id, payload)
        : await connectionsApi.create(payload)
      // Save share assignments if admin — once the current ones are known: saving
      // before they loaded used to send empty lists and remove every share.
      if (isAdmin && (!editing || sharesSynced)) {
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
        ? await connectionsApi.testRaw({ driver: 'sqlite', ...(form.filePath ? { filePath: form.filePath } : {}), ssl: false })
        : await connectionsApi.testRaw({
            driver: form.driver,
            ...(form.host ? { host: form.host } : {}),
            ...(form.port != null && form.driver !== 'snowflake' ? { port: form.port } : {}),
            ...(form.database ? { database: form.database } : {}),
            ...(form.username ? { username: form.username } : {}),
            ...(form.password ? { password: form.password } : {}),
            ...(form.driver === 'snowflake' ? { options: filledOptions(form.options) } : {}),
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
                      <span className="text-text-muted">{t('conn.parsedHost')}</span><span className="break-all">{isMongoUri(form.host) || form.driver === 'snowflake' || form.port == null ? form.host : `${form.host}:${form.port}`}</span>
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
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={handleTest} disabled={testing || (form.driver === 'sqlite' ? !form.filePath : !form.host)}>
                {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('conn.test')}
              </Button>
              {editing && (
                <Button type="button" variant="ghost" size="sm" onClick={handleCopyString}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t('conn.copied') : t('conn.copyString')}
                </Button>
              )}
            </div>
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
  t: (key: TranslationKey, replacements?: Record<string, string | number>) => string
}) {
  const isSQLite = form.driver === 'sqlite'
  const isTrino = form.driver === 'trino'
  const isMongo = form.driver === 'mongodb'
  const isRedis = form.driver === 'redis'
  const isSnowflake = form.driver === 'snowflake'
  // A mongodb+srv:// or multi-host URI, or a redis:// URL, carries its own hosts and
  // ports; Snowflake is reached by account identifier.
  const hostIsUri = (isMongo && isMongoUri(form.host)) || (isRedis && isRedisUrl(form.host))
  const portless = hostIsUri || isSnowflake
  // Servers that may run without authentication.
  const authOptional = isMongo || isRedis
  const setOption = (key: string, value: string) => set('options', { ...(form.options ?? {}), [key]: value })

  const hostPlaceholder = isMongo ? t('conn.hostOrUriPlaceholder')
    : isRedis ? t('conn.redisHostPlaceholder')
    : form.driver === 'mssql' ? t('conn.mssqlHostPlaceholder')
    : isSnowflake ? t('conn.accountPlaceholder')
    : undefined
  const databaseLabel = isTrino ? t('conn.catalog') : isRedis ? t('conn.redisDb') : t('conn.database')
  const databaseHint = isTrino ? t('conn.catalogHint')
    : isMongo ? t('conn.mongoDatabaseHint')
    : isRedis ? t('conn.redisDbHint')
    : isSnowflake ? t('conn.snowflakeDatabaseHint')
    : t('conn.databaseHint')
  const databasePlaceholder = isTrino ? t('conn.catalogPlaceholder')
    : isMongo ? t('conn.mongoDatabasePlaceholder')
    : isRedis ? '0'
    : isSnowflake ? t('conn.snowflakeDatabasePlaceholder')
    : t('conn.databasePlaceholder')

  return (
    <>
      {/* Driver picker — 9 drivers in a ~400px dialog: two rows, icon over label.
          The 1px gaps over a border-coloured background draw the separators. */}
      <div className="space-y-1.5">
        <Label>{t('conn.parsedDriver')}</Label>
        <div className="grid w-full grid-cols-5 gap-px rounded-md border border-border-strong overflow-hidden bg-border-strong">
          {DRIVERS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                set('driver', d)
                const port = DEFAULT_PORTS[d]
                if (port !== undefined) set('port', port)
                // Snowflake always uses TLS and is reached by account, never localhost:
                // neither setting must stick when switching to or from it.
                if (d === 'snowflake') {
                  set('ssl', true)
                  if (form.host === 'localhost') set('host', '')
                } else if (form.driver === 'snowflake') {
                  set('ssl', false)
                  if (!form.host) set('host', 'localhost')
                }
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 min-w-0 text-[10px] font-medium leading-none transition-colors',
                form.driver === d
                  ? 'bg-surface-overlay text-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground hover:bg-surface-raised',
              )}
            >
              <DriverIcon driver={d} className="h-3.5 w-3.5" />
              <span className="w-full truncate text-center">
                {DRIVER_LABELS[d]}
              </span>
            </button>
          ))}
          {DRIVERS.length % 5 !== 0 && <div className="bg-card" style={{ gridColumn: `span ${5 - (DRIVERS.length % 5)}` }} />}
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
          {/* Host + Port — MongoDB and Redis also take a URI here, which carries its port;
              Snowflake takes an account identifier */}
          <div className="grid grid-cols-3 gap-3">
            <div className={cn('space-y-1.5', portless ? 'col-span-3' : 'col-span-2')}>
              <Label>{isSnowflake ? t('conn.account') : isMongo || isRedis ? t('conn.hostOrUri') : t('conn.host')}</Label>
              <Input
                value={form.host ?? ''}
                onChange={(e) => set('host', e.target.value)}
                placeholder={hostPlaceholder}
                className={cn(hostIsUri && 'font-mono text-xs')}
                required
              />
            </div>
            {!portless && (
              <div className="space-y-1.5">
                <Label>{t('conn.port')}</Label>
                <Input
                  type="number"
                  value={form.port ?? ''}
                  onChange={(e) => set('port', Number(e.target.value))}
                  required
                />
              </div>
            )}
          </div>

          {/* Database — "catalog[/schema]" for Trino, "database[/schema]" for Snowflake, an index for Redis */}
          <div className="space-y-1.5">
            <Label>
              {databaseLabel}{' '}
              <span className="text-text-muted font-normal text-xs">{databaseHint}</span>
            </Label>
            <Input
              value={form.database ?? ''}
              onChange={(e) => set('database', e.target.value)}
              placeholder={databasePlaceholder}
              inputMode={isRedis ? 'numeric' : undefined}
            />
          </div>

          {/* Snowflake warehouse + role (stored as non-secret options) */}
          {isSnowflake && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  {t('conn.warehouse')}{' '}
                  <span className="text-text-muted font-normal text-xs">{t('conn.environmentOptional')}</span>
                </Label>
                <Input value={form.options?.['warehouse'] ?? ''} onChange={(e) => setOption('warehouse', e.target.value)} placeholder="COMPUTE_WH" />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t('conn.role')}{' '}
                  <span className="text-text-muted font-normal text-xs">{t('conn.environmentOptional')}</span>
                </Label>
                <Input value={form.options?.['role'] ?? ''} onChange={(e) => setOption('role', e.target.value)} placeholder="ANALYST" />
              </div>
            </div>
          )}

          {/* Username + Password */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                {t('conn.username')}{' '}
                {/* MongoDB and Redis servers may run without authentication */}
                {authOptional && <span className="text-text-muted font-normal text-xs">{t('conn.environmentOptional')}</span>}
              </Label>
              <Input value={form.username ?? ''} onChange={(e) => set('username', e.target.value)} required={!authOptional} />
            </div>
            <div className="space-y-1.5">
              <Label>
                {isSnowflake ? t('conn.passwordOrKey') : t('conn.password')}{' '}
                {/* Trino, MongoDB and Redis may run without an authenticator: an empty password is valid */}
                {(isTrino || authOptional) && <span className="text-text-muted font-normal text-xs">{t('conn.environmentOptional')}</span>}
              </Label>
              <Input
                type="password"
                value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                placeholder={editing ? t('conn.passwordUnchanged') : isSnowflake ? t('conn.passwordOrKeyPlaceholder') : ''}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}

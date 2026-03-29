import { useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
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
import { CheckCircle, XCircle, Loader2, Link2, FormInput } from 'lucide-react'
import { connectionsApi, type Connection, type CreateConnectionInput, type DbDriver } from '@/api/connections'
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

  const [form, setForm] = useState<CreateConnectionInput>({
    name: editing?.name ?? '',
    driver: editing?.driver ?? 'postgresql',
    host: editing?.host ?? 'localhost',
    port: editing?.port ?? 5432,
    database: editing?.database ?? '',
    username: editing?.username ?? '',
    password: '',
    ssl: editing?.ssl ?? false,
    color: editing?.color ?? COLORS[0] ?? '#41cd2a',
    environment: editing?.environment ?? '',
  })

  const [mode, setMode] = useState<'string' | 'manual'>('string')
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
      setParseError('Format non reconnu. Attendu: postgresql://user:pass@host:port/db')
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
    mutationFn: () =>
      editing ? connectionsApi.update(editing.id, form) : connectionsApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      onClose()
    },
  })

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = editing
        ? await connectionsApi.test(editing.id)
        : await connectionsApi.testRaw({
            driver: form.driver,
            host: form.host,
            port: form.port,
            database: form.database,
            username: form.username,
            password: form.password,
            ssl: form.ssl,
          })
      setTestResult({ ok: r.ok, msg: r.ok ? `OK — ${r.latencyMs}ms` : (r.error ?? 'Echec') })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de connexion.'
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
            {editing ? 'Modifier la connexion' : 'Nouvelle connexion'}
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
            <>
              <div className="inline-flex w-full rounded-md border border-border-strong overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMode('string')}
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-1.5 h-8 text-xs font-medium transition-colors',
                    mode === 'string'
                      ? 'bg-surface-overlay text-foreground'
                      : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-raised',
                  )}
                >
                  <Link2 className="h-3 w-3" />
                  Connection string
                </button>
                <span className="w-px bg-border-strong" />
                <button
                  type="button"
                  onClick={() => setMode('manual')}
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-1.5 h-8 text-xs font-medium transition-colors',
                    mode === 'manual'
                      ? 'bg-surface-overlay text-foreground'
                      : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-raised',
                  )}
                >
                  <FormInput className="h-3 w-3" />
                  Champs manuels
                </button>
              </div>

              {mode === 'string' && (
                <div className="space-y-2">
                  <Label>Collez votre connection string</Label>
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
                      <span className="text-text-muted">Driver</span><span>{form.driver}</span>
                      <span className="text-text-muted">Hote</span><span>{form.host}:{form.port}</span>
                      <span className="text-text-muted">Base</span><span>{form.database}</span>
                      <span className="text-text-muted">User</span><span>{form.username}</span>
                      <span className="text-text-muted">SSL</span><span>{form.ssl ? 'oui' : 'non'}</span>
                    </div>
                  )}
                </div>
              )}

              {mode === 'manual' && <ManualFields form={form} set={set} editing={false} />}
            </>
          )}

          {/* When editing, always show manual fields */}
          {editing && <ManualFields form={form} set={set} editing={true} />}

          {/* Name (always visible) */}
          <div className="space-y-1.5">
            <Label>Nom</Label>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder="Ma base prod"
            />
          </div>

          {/* Environment */}
          <div className="space-y-1.5">
            <Label>
              Environnement{' '}
              <span className="text-text-muted font-normal">(optionnel)</span>
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
            {form.environment && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[10px] text-text-muted">Aperçu :</span>
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border',
                    envBadgeStyle(form.environment),
                  )}
                >
                  {form.environment}
                </span>
              </div>
            )}
          </div>

          {/* SSL + Color dots */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                id="ssl-toggle"
                checked={form.ssl}
                onCheckedChange={(checked) => set('ssl', checked)}
              />
              <Label htmlFor="ssl-toggle" className="text-sm text-muted-foreground cursor-pointer">
                SSL
              </Label>
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
            <Button type="button" variant="ghost" size="sm" onClick={handleTest} disabled={testing || !form.host || !form.database}>
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Tester
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editing ? 'Enregistrer' : 'Creer'}
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
}: {
  form: CreateConnectionInput
  set: <K extends keyof CreateConnectionInput>(k: K, v: CreateConnectionInput[K]) => void
  editing: boolean
}) {
  return (
    <>
      {/* Driver toggle */}
      <div className="space-y-1.5">
        <Label>Driver</Label>
        <div className="inline-flex w-full rounded-md border border-border-strong overflow-hidden">
          {(['postgresql', 'mysql'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                set('driver', d)
                set('port', d === 'postgresql' ? 5432 : 3306)
              }}
              className={cn(
                'flex-1 h-9 text-xs font-medium transition-colors',
                form.driver === d
                  ? 'bg-surface-overlay text-foreground'
                  : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-raised',
                d === 'postgresql' && 'border-r border-border-strong',
              )}
            >
              {d === 'postgresql' ? '🐘 PostgreSQL' : '🐬 MySQL'}
            </button>
          ))}
        </div>
      </div>

      {/* Host + Port */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>Hote</Label>
          <Input value={form.host} onChange={(e) => set('host', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Port</Label>
          <Input
            type="number"
            value={form.port}
            onChange={(e) => set('port', Number(e.target.value))}
            required
          />
        </div>
      </div>

      {/* Database */}
      <div className="space-y-1.5">
        <Label>Base de donnees</Label>
        <Input value={form.database} onChange={(e) => set('database', e.target.value)} required />
      </div>

      {/* Username + Password */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Utilisateur</Label>
          <Input value={form.username} onChange={(e) => set('username', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Mot de passe</Label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder={editing ? '(inchange)' : ''}
          />
        </div>
      </div>
    </>
  )
}

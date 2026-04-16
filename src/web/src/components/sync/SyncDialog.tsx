import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { Combobox } from '@/components/ui/combobox'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { connectionsApi, type Connection } from '@/api/connections'
import { executeSync, type SyncProgress, type SyncOptions } from '@/api/data-sync'
import {
  ArrowRight,
  Loader2,
  Check,
  AlertCircle,
  Database,
  Table2,
  AlertTriangle,
  Eye,
  ChevronsUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Step = 'configure' | 'syncing' | 'done'

type TableEntry = {
  source: string
  target: string
  checked: boolean
  columns: number
  type: 'table' | 'view'
}

type TableStatus = {
  phase: SyncProgress['phase']
  rowsInserted: number
  totalRows: number
  error?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ── Connection picker (Popover + Command) ────

function ConnectionPicker({
  value,
  onChange,
  connections,
  placeholder,
}: {
  value: string
  onChange: (id: string) => void
  connections: Connection[]
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const selected = connections.find((c) => c.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between h-9 text-xs font-normal">
          {selected ? (
            <span className="flex items-center gap-1.5 truncate">
              <Database className="h-3 w-3 flex-shrink-0 opacity-50" />
              {selected.name}
              <span className="text-text-muted">({selected.driver})</span>
            </span>
          ) : (
            <span className="text-text-muted">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 text-xs text-center text-text-muted">—</CommandEmpty>
            <CommandGroup>
              {connections.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.driver}`}
                  onSelect={() => { onChange(c.id); setOpen(false) }}
                  className="text-xs gap-2"
                >
                  <Check className={cn('h-3 w-3', value === c.id ? 'opacity-100' : 'opacity-0')} />
                  <Database className="h-3 w-3 opacity-50" />
                  <span className="truncate">{c.name}</span>
                  <span className="text-text-muted ml-auto text-[10px]">{c.driver}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── Database picker ──────────────────────────

function DatabasePicker({ connectionId, value, onChange }: { connectionId: string; value: string; onChange: (db: string) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['databases', connectionId],
    queryFn: () => connectionsApi.databases(connectionId),
    enabled: !!connectionId,
    staleTime: 5 * 60_000,
  })
  const databases = data?.databases ?? []

  if (isLoading) return (
    <div className="relative h-7">
      <Skeleton className="h-7 w-full rounded-md" />
      <div className="absolute inset-0 flex items-center gap-1.5 px-2 text-[11px] text-text-muted pointer-events-none">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('common.loading')}
      </div>
    </div>
  )
  if (databases.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between h-7 text-[11px] font-normal">
          {value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-text-muted">{t('sync.database')}</span>
          )}
          <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('sync.database')} className="h-7 text-[11px]" />
          <CommandList>
            <CommandEmpty className="py-2 text-[11px] text-center text-text-muted">—</CommandEmpty>
            <CommandGroup>
              {databases.map((db) => (
                <CommandItem
                  key={db}
                  value={db}
                  onSelect={() => { onChange(db); setOpen(false) }}
                  className="text-[11px] gap-2"
                >
                  <Check className={cn('h-3 w-3', value === db ? 'opacity-100' : 'opacity-0')} />
                  {db}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── Main dialog ──────────────────────────────

export function SyncDialog({ open, onOpenChange }: Props) {
  const { t } = useI18n()

  const [step, setStep] = useState<Step>('configure')
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [sourceDb, setSourceDb] = useState('')
  const [targetDb, setTargetDb] = useState('')
  const [tableEntries, setTableEntries] = useState<TableEntry[]>([])
  const [tableStatuses, setTableStatuses] = useState<Record<string, TableStatus>>({})
  const [globalError, setGlobalError] = useState('')
  const [includeConstraints, setIncludeConstraints] = useState(false)
  const [syncMode, setSyncMode] = useState<'structure' | 'structure-data'>('structure-data')

  // Reset all state when dialog opens
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setStep('configure')
      setSourceId('')
      setTargetId('')
      setSourceDb('')
      setTargetDb('')
      setTableEntries([])
      setPrevSourceKey('')
      setTableStatuses({})
      setGlobalError('')
      setIncludeConstraints(false)
      setSyncMode('structure-data')
    }
    prevOpen.current = open
  }, [open])

  const { data: connData } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
    staleTime: 5 * 60_000,
  })
  const connections = connData?.connections ?? []
  const sourceConn = connections.find((c) => c.id === sourceId)
  const targetConn = connections.find((c) => c.id === targetId)
  const sourceNeedsDb = sourceConn && !sourceConn.database
  const targetNeedsDb = targetConn && !targetConn.database

  // Switch database before fetching schema
  const sourceReady = sourceId && (!sourceNeedsDb || sourceDb)
  useQuery({
    queryKey: ['switch-db', sourceId, sourceDb],
    queryFn: () => connectionsApi.switchDatabase(sourceId, sourceDb),
    enabled: !!sourceId && !!sourceDb && sourceNeedsDb === true,
    staleTime: Infinity,
  })
  useQuery({
    queryKey: ['switch-db', targetId, targetDb],
    queryFn: () => connectionsApi.switchDatabase(targetId, targetDb),
    enabled: !!targetId && !!targetDb && targetNeedsDb === true,
    staleTime: Infinity,
  })

  const { data: sourceSchema, isLoading: loadingSchema } = useQuery({
    queryKey: ['schema', sourceId, sourceDb],
    queryFn: () => connectionsApi.schema(sourceId),
    enabled: !!sourceReady,
    staleTime: 5 * 60_000,
  })

  const { data: targetSchema } = useQuery({
    queryKey: ['schema', targetId, targetDb],
    queryFn: () => connectionsApi.schema(targetId),
    enabled: !!(targetId && (!targetNeedsDb || targetDb)),
    staleTime: 5 * 60_000,
  })

  const sourceTables = useMemo(() => sourceSchema?.tables ?? [], [sourceSchema])
  const targetTableNames = useMemo(
    () => (targetSchema?.tables ?? []).map((t) => t.name),
    [targetSchema],
  )

  // Auto-populate entries when source tables change
  const sourceKey = sourceTables.map((t) => t.name).join(',')
  const [prevSourceKey, setPrevSourceKey] = useState('')
  if (sourceKey !== prevSourceKey) {
    setPrevSourceKey(sourceKey)
    setTableEntries(sourceTables.map((t) => ({
      source: t.name,
      target: t.name,
      checked: true,
      columns: t.columns.length,
      type: (t.type ?? 'table') as 'table' | 'view',
    })))
  }

  const toggleTable = (source: string) =>
    setTableEntries((prev) => prev.map((e) => e.source === source ? { ...e, checked: !e.checked } : e))

  const setTargetName = (source: string, target: string) =>
    setTableEntries((prev) => prev.map((e) => e.source === source ? { ...e, target } : e))

  const selectAll = () => setTableEntries((prev) => prev.map((e) => ({ ...e, checked: true })))
  const deselectAll = () => setTableEntries((prev) => prev.map((e) => ({ ...e, checked: false })))

  const selectedEntries = tableEntries.filter((e) => e.checked)
  const canStart = sourceId && targetId && selectedEntries.length > 0
    && selectedEntries.every((e) => e.target.trim())
    && (!sourceNeedsDb || sourceDb)
    && (!targetNeedsDb || targetDb)

  const handleSync = useCallback(async () => {
    if (!canStart) return
    setStep('syncing')
    setGlobalError('')

    const mapping = selectedEntries.map((e) => ({ source: e.source, target: e.target.trim() }))
    const labels = mapping.map((m) => m.source === m.target ? m.source : `${m.source} → ${m.target}`)

    setTableStatuses(
      Object.fromEntries(labels.map((l) => [l, { phase: 'schema' as const, rowsInserted: 0, totalRows: 0 }])),
    )

    const result = await executeSync(sourceId, targetId, mapping, { includeConstraints, includeData: syncMode === 'structure-data' }, (p) => {
      if (p.phase === 'done') return
      const status: TableStatus = { phase: p.phase, rowsInserted: p.rowsInserted, totalRows: p.totalRows }
      if (p.error) status.error = p.error
      setTableStatuses((prev) => ({ ...prev, [p.table]: status }))
    })

    if (!result.success) setGlobalError(result.error ?? '')
    setStep('done')
  }, [canStart, sourceId, targetId, selectedEntries, includeConstraints, syncMode])

  const reset = () => {
    setStep('configure')
    setSourceId('')
    setTargetId('')
    setSourceDb('')
    setTargetDb('')
    setTableEntries([])
    setPrevSourceKey('')
    setTableStatuses({})
    setGlobalError('')
    setIncludeConstraints(false)
    setSyncMode('structure-data')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[660px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            {t('sync.title')}
          </DialogTitle>
        </DialogHeader>

        {step === 'configure' && (
          <div className="flex flex-col gap-4 overflow-y-auto flex-1">
            {/* Connection pickers */}
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-muted">{t('sync.source')}</label>
                <ConnectionPicker
                  value={sourceId}
                  onChange={(id) => { setSourceId(id); setSourceDb(''); setTableEntries([]); setPrevSourceKey('') }}
                  connections={connections}
                  placeholder={t('sync.selectConnection')}
                />
                {sourceNeedsDb && (
                  <DatabasePicker connectionId={sourceId} value={sourceDb} onChange={setSourceDb} />
                )}
              </div>
              <ArrowRight className="h-4 w-4 text-text-muted mt-7" />
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-muted">{t('sync.target')}</label>
                <ConnectionPicker
                  value={targetId}
                  onChange={(id) => { setTargetId(id); setTargetDb('') }}
                  connections={connections}
                  placeholder={t('sync.selectConnection')}
                />
                {targetNeedsDb && (
                  <DatabasePicker connectionId={targetId} value={targetDb} onChange={setTargetDb} />
                )}
              </div>
            </div>

            {/* Mode */}
            <Tabs value={syncMode} onValueChange={(v) => setSyncMode(v as 'structure' | 'structure-data')}>
              <TabsList className="h-8 w-full">
                <TabsTrigger value="structure-data" className="flex-1 text-xs gap-1.5">
                  <Table2 className="h-3 w-3" />
                  {t('sync.modeStructureData')}
                </TabsTrigger>
                <TabsTrigger value="structure" className="flex-1 text-xs gap-1.5">
                  <Database className="h-3 w-3" />
                  {t('sync.modeStructure')}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Tables */}
            {sourceReady && loadingSchema && (
              <div className="flex items-center gap-2 text-xs text-text-muted py-4">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('sync.fetchingSchema')}
              </div>
            )}

            {sourceReady && !loadingSchema && sourceTables.length === 0 && (
              <p className="text-xs text-text-muted py-4">{t('sync.noTables')}</p>
            )}

            {tableEntries.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{t('sync.tables')} ({selectedEntries.length}/{tableEntries.length})</span>
                  <div className="flex gap-2">
                    <button onClick={selectAll} className="text-[11px] text-primary hover:underline">{t('sync.selectAll')}</button>
                    <button onClick={deselectAll} className="text-[11px] text-text-muted hover:underline">{t('sync.deselectAll')}</button>
                  </div>
                </div>
                <div className="border border-border rounded-md max-h-[220px] overflow-y-auto divide-y divide-border">
                  {/* Header */}
                  <div className="grid grid-cols-[20px_16px_1fr_16px_1fr_42px] gap-1.5 items-center px-3 py-1.5 bg-surface text-[10px] font-medium text-text-muted uppercase tracking-wide sticky top-0 z-10">
                    <span />
                    <span />
                    <span>{t('sync.source')}</span>
                    <span />
                    <span>{t('sync.target')}</span>
                    <span className="text-right">cols</span>
                  </div>
                  {tableEntries.map((entry) => (
                    <div key={entry.source} className="grid grid-cols-[20px_16px_1fr_16px_1fr_42px] gap-1.5 items-center px-3 py-1.5 hover:bg-surface-raised">
                      <Checkbox
                        checked={entry.checked}
                        onCheckedChange={() => toggleTable(entry.source)}
                      />
                      {entry.type === 'view'
                        ? <Eye className="h-3.5 w-3.5 text-blue-400/50" />
                        : <Table2 className="h-3.5 w-3.5 text-primary/50" />
                      }
                      <span className="font-mono text-xs truncate">{entry.source}</span>
                      <ArrowRight className="h-3 w-3 text-text-muted" />
                      <Combobox
                        value={entry.target}
                        onChange={(v) => setTargetName(entry.source, v)}
                        options={targetTableNames}
                        placeholder={entry.source}
                        className="h-6 text-xs"
                      />
                      <span className="flex items-center justify-end gap-1">
                        {entry.target.trim() && !targetTableNames.includes(entry.target.trim()) && (
                          <span className="text-[9px] font-medium text-primary bg-primary/10 rounded px-1 py-0.5 leading-none">new</span>
                        )}
                        <span className="text-[10px] text-text-muted tabular-nums">{entry.columns}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Options */}
            {tableEntries.length > 0 && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={includeConstraints} onCheckedChange={(v) => setIncludeConstraints(!!v)} />
                {t('sync.includeConstraints')}
              </label>
            )}

            {canStart && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-warning">{t('sync.warning')}</p>
              </div>
            )}
          </div>
        )}

        {(step === 'syncing' || step === 'done') && (
          <div className="flex flex-col gap-2 overflow-y-auto flex-1">
            {/* Summary header */}
            <div className="flex items-center gap-2 text-xs text-text-muted px-1">
              <span className="font-medium">{sourceConn?.name}{sourceDb ? ` / ${sourceDb}` : ''}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="font-medium">{targetConn?.name}{targetDb ? ` / ${targetDb}` : ''}</span>
            </div>

            {/* Table progress */}
            <div className="border border-border rounded-md divide-y divide-border max-h-[320px] overflow-y-auto">
              {Object.entries(tableStatuses).map(([label, status]) => (
                <div key={label} className="flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-2">
                    {status.phase === 'schema' || status.phase === 'create' || status.phase === 'insert' ? (
                      <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
                    ) : status.phase === 'table-done' ? (
                      <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                    ) : status.phase === 'error' ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted opacity-30" />
                    )}

                    <span className="font-mono text-xs truncate flex-1">{label}</span>

                    <span className="text-[11px] text-text-muted flex-shrink-0">
                      {status.phase === 'schema' && t('sync.tableStatus.schema')}
                      {status.phase === 'create' && t('sync.tableStatus.create')}
                      {status.phase === 'insert' && `${status.rowsInserted}/${status.totalRows} ${t('sync.rows')}`}
                      {status.phase === 'table-done' && `${status.rowsInserted} ${t('sync.rows')}`}
                      {status.phase === 'error' && (
                        <span className="text-destructive">{t('sync.tableStatus.error')}</span>
                      )}
                    </span>
                  </div>
                  {status.phase === 'error' && status.error && (
                    <div className="px-3 pb-2 pl-9">
                      <p className="text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded px-2 py-1 font-mono break-all">
                        {status.error}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {globalError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {globalError}
              </p>
            )}

            {step === 'done' && !globalError && (
              <p className="text-xs text-green-500 flex items-center gap-1">
                <Check className="h-3 w-3" />
                {t('sync.done')}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'configure' && (
            <Button onClick={handleSync} disabled={!canStart} className="gap-2">
              <Database className="h-3.5 w-3.5" />
              {t('sync.start')}
            </Button>
          )}
          {step === 'syncing' && (
            <Button disabled className="gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('sync.syncing')}
            </Button>
          )}
          {step === 'done' && (
            <Button onClick={() => onOpenChange(false)}>
              {t('import.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

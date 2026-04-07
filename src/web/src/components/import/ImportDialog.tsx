import { useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox } from '@/components/ui/combobox'
import { useI18n } from '@/i18n'
import { Upload, FileSpreadsheet, ChevronRight, ChevronLeft, Check, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import {
  parseFile,
  detectFormat,
  inferColumnTypes,
  type FileFormat,
  type ParsedData,
  type InferredType,
} from '@/lib/file-parsers'
import { executeImport, mapColumns, type ImportProgress } from '@/api/data-import'
import type { SchemaTable } from '@/api/connections'

type Step = 'upload' | 'configure' | 'import'

type ColumnDef = {
  name: string
  type: InferredType
  include: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  onComplete?: () => void
}

const ALL_TYPES: { value: InferredType; label: string }[] = [
  { value: 'varchar', label: 'VARCHAR' },
  { value: 'text', label: 'TEXT' },
  { value: 'integer', label: 'INTEGER' },
  { value: 'bigint', label: 'BIGINT' },
  { value: 'decimal', label: 'DECIMAL' },
  { value: 'float', label: 'FLOAT' },
  { value: 'boolean', label: 'BOOLEAN' },
  { value: 'date', label: 'DATE' },
  { value: 'timestamp', label: 'TIMESTAMP' },
]

const ACCEPTED = '.csv,.txt,.tsv,.json,.xml,.xls,.xlsx'

export function ImportDialog({ open, onOpenChange, connectionId, onComplete }: Props) {
  const { t } = useI18n()

  // ── Step state ──
  const [step, setStep] = useState<Step>('upload')

  // ── Upload state ──
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<FileFormat | null>(null)
  const [parseError, setParseError] = useState('')
  const [parsing, setParsing] = useState(false)

  // ── Format options ──
  const [delimiter, setDelimiter] = useState<string>(',')
  const [hasHeader, setHasHeader] = useState(true)
  const [sheetIndex, setSheetIndex] = useState(0)

  // ── Parsed data ──
  const [parsed, setParsed] = useState<ParsedData | null>(null)
  const [columns, setColumns] = useState<ColumnDef[]>([])

  // ── Target ──
  const [tableName, setTableName] = useState('')
  const [ifExists, setIfExists] = useState<'error' | 'append' | 'replace'>('append')

  // ── Import state ──
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)

  // ── AI mapping state ──
  const [mapping, setMapping] = useState(false)

  // ── Drag & drop state ──
  const [dragOver, setDragOver] = useState(false)

  const reset = useCallback(() => {
    setStep('upload')
    setFile(null)
    setFormat(null)
    setParseError('')
    setParsing(false)
    setDelimiter(',')
    setHasHeader(true)
    setSheetIndex(0)
    setParsed(null)
    setColumns([])
    setTableName('')
    setIfExists('append')
    setProgress(null)
    setImportError('')
    setImporting(false)
    setDone(false)
    setDragOver(false)
    setMapping(false)
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  // ── File handling ──

  const handleFile = useCallback(async (f: File) => {
    const fmt = detectFormat(f.name)
    if (!fmt) {
      setParseError(t('import.unsupportedFormat'))
      return
    }
    setFile(f)
    setFormat(fmt)
    setParseError('')
    setTableName(f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase())

    if (fmt === 'txt') setDelimiter('\t')
    else if (fmt === 'csv') setDelimiter(',')
  }, [t])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }, [handleFile])

  // ── Parse ──

  const handleParse = useCallback(async () => {
    if (!file || !format) return
    setParsing(true)
    setParseError('')
    try {
      const result = await parseFile(file, format, {
        delimiter,
        hasHeader,
        sheetIndex,
      })
      if (result.headers.length === 0) {
        setParseError(t('import.emptyFile'))
        return
      }
      setParsed(result)
      const types = inferColumnTypes(result.headers, result.rows)
      setColumns(result.headers.map((h, i) => ({
        name: h,
        type: types[i]!,
        include: true,
      })))
      setStep('configure')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }, [file, format, delimiter, hasHeader, sheetIndex, t])

  // ── Import ──

  const handleImport = useCallback(async () => {
    if (!parsed || !connectionId) return
    setImporting(true)
    setImportError('')
    setStep('import')

    const includedCols = columns.filter((c) => c.include)
    const includedIndices = columns.map((c, i) => c.include ? i : -1).filter((i) => i >= 0)
    const filteredRows = parsed.rows.map((row) =>
      includedIndices.map((i) => row[i] ?? null),
    )

    const result = await executeImport(
      {
        connectionId,
        tableName,
        createTable: ifExists !== 'append',
        ifExists,
        columns: includedCols.map((c) => ({ name: c.name, type: c.type })),
        rows: filteredRows,
      },
      (p) => setProgress(p),
    )

    setImporting(false)
    if (result.success) {
      setDone(true)
    } else {
      setImportError(result.error ?? t('import.unknownError'))
    }
  }, [parsed, connectionId, columns, tableName, ifExists, t])

  // ── Column updates ──

  const updateColumn = (index: number, updates: Partial<ColumnDef>) => {
    setColumns((cols) => cols.map((c, i) => (i === index ? { ...c, ...updates } : c)))
  }

  // ── Preview rows ──
  const previewRows = useMemo(() => parsed?.rows.slice(0, 10) ?? [], [parsed])
  const includedCount = columns.filter((c) => c.include).length

  // ── Schema autocomplete ──
  const qc = useQueryClient()
  const schemaData = qc.getQueryData<{ tables: SchemaTable[] }>(['schema', connectionId])
  const schemaTables = schemaData?.tables ?? []
  const tableNames = useMemo(() => schemaTables.map((t) => t.name), [schemaTables])
  const matchedTable = useMemo(
    () => schemaTables.find((t) => t.name.toLowerCase() === tableName.toLowerCase()),
    [schemaTables, tableName],
  )
  const targetColumnNames = useMemo(
    () => matchedTable?.columns.map((c) => c.name) ?? [],
    [matchedTable],
  )
  const targetColumnSet = useMemo(
    () => new Set(targetColumnNames.map((n) => n.toLowerCase())),
    [targetColumnNames],
  )

  // ── AI column mapping ──

  const handleMapColumns = useCallback(async () => {
    if (!matchedTable) return
    setMapping(true)
    try {
      const result = await mapColumns(
        columns.map((c) => c.name),
        matchedTable.columns.map((c) => ({ name: c.name, dataType: c.dataType })),
      )
      setColumns((cols) =>
        cols.map((col) => {
          const match = result.find((m) => m.sourceColumn === col.name)
          if (match?.targetColumn) {
            return { ...col, name: match.targetColumn }
          }
          return col
        }),
      )
    } catch {
      // silently fail — user can map manually
    } finally {
      setMapping(false)
    }
  }, [columns, matchedTable])

  // ── Render ──

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col bg-card border-border-subtle">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" />
            {t('import.title')}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step indicators ── */}
        <div className="flex items-center gap-1 text-xs text-text-muted px-1">
          <span className={step === 'upload' ? 'text-primary font-medium' : columns.length > 0 ? 'text-foreground' : ''}>
            {t('import.stepUpload')}
          </span>
          <ChevronRight className="h-3 w-3" />
          <span className={step === 'configure' ? 'text-primary font-medium' : ''}>
            {t('import.stepConfigure')}
          </span>
          <ChevronRight className="h-3 w-3" />
          <span className={step === 'import' ? 'text-primary font-medium' : ''}>
            {t('import.stepImport')}
          </span>
        </div>

        {/* ── Step: Upload ── */}
        {step === 'upload' && (
          <div className="flex-1 space-y-4 overflow-auto">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border-strong hover:border-primary/50'
              }`}
              onClick={() => document.getElementById('import-file-input')?.click()}
            >
              <Upload className="h-8 w-8 text-text-muted" />
              <div className="text-center">
                <p className="text-sm font-medium">{t('import.dropHint')}</p>
                <p className="text-xs text-text-muted mt-1">CSV, TXT, JSON, XML, XLS, XLSX</p>
              </div>
              <input
                id="import-file-input"
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {/* File info */}
            {file && format && (
              <div className="rounded-md border border-border-subtle bg-surface-raised p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-text-muted">
                      {(file.size / 1024).toFixed(1)} KB · {format.toUpperCase()}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setFile(null); setFormat(null) }}>
                    {t('import.changeFile')}
                  </Button>
                </div>

                {/* Format-specific options */}
                {(format === 'csv' || format === 'txt') && (
                  <div className="flex items-center gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('import.delimiter')}</Label>
                      <select
                        value={delimiter}
                        onChange={(e) => setDelimiter(e.target.value)}
                        className="h-8 rounded-md border border-border-subtle bg-surface px-2 text-xs"
                      >
                        <option value=",">{t('import.delimiterComma')}</option>
                        <option value=";">{t('import.delimiterSemicolon')}</option>
                        <option value={'\t'}>{t('import.delimiterTab')}</option>
                        <option value="|">{t('import.delimiterPipe')}</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <Checkbox
                        id="has-header"
                        checked={hasHeader}
                        onCheckedChange={(v) => setHasHeader(!!v)}
                      />
                      <Label htmlFor="has-header" className="text-xs">
                        {t('import.hasHeader')}
                      </Label>
                    </div>
                  </div>
                )}

                {(format === 'xls' || format === 'xlsx') && parsed?.sheetNames && parsed.sheetNames.length > 1 && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t('import.sheet')}</Label>
                    <select
                      value={sheetIndex}
                      onChange={(e) => setSheetIndex(Number(e.target.value))}
                      className="h-8 rounded-md border border-border-subtle bg-surface px-2 text-xs"
                    >
                      {parsed.sheetNames.map((name, i) => (
                        <option key={i} value={i}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {parseError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Step: Configure ── */}
        {step === 'configure' && parsed && (
          <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
            {/* Table name & behavior */}
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">{t('import.tableName')}</Label>
                <Combobox
                  value={tableName}
                  onChange={setTableName}
                  options={tableNames}
                  placeholder="my_table"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('import.ifExists')}</Label>
                <select
                  value={ifExists}
                  onChange={(e) => setIfExists(e.target.value as 'error' | 'append' | 'replace')}
                  className="h-8 rounded-md border border-border-subtle bg-surface px-2 text-xs"
                >
                  <option value="error">{t('import.ifExistsError')}</option>
                  <option value="append">{t('import.ifExistsAppend')}</option>
                  <option value="replace">{t('import.ifExistsReplace')}</option>
                </select>
              </div>
            </div>

            {/* Column definitions */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  {t('import.columns')} ({includedCount}/{columns.length})
                </Label>
                {matchedTable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1.5 text-[11px] text-primary"
                    disabled={mapping}
                    onClick={handleMapColumns}
                  >
                    {mapping ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {t('import.mapWithCopilot')}
                  </Button>
                )}
              </div>
              <div className="rounded-md border border-border-subtle">
                <div className="divide-y divide-border-subtle">
                  {columns.map((col, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                      <Checkbox
                        checked={col.include}
                        onCheckedChange={(v) => updateColumn(i, { include: !!v })}
                      />
                      <Combobox
                        value={col.name}
                        onChange={(v) => updateColumn(i, { name: v })}
                        options={targetColumnNames}
                        className="h-7 flex-1"
                        error={col.include && !!matchedTable && !targetColumnSet.has(col.name.toLowerCase())}
                      />
                      <select
                        value={col.type}
                        onChange={(e) => updateColumn(i, { type: e.target.value as InferredType })}
                        className="h-7 rounded-md border border-border-subtle bg-surface px-1.5 text-xs font-mono"
                      >
                        {ALL_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              {matchedTable && columns.some((c) => c.include && !targetColumnSet.has(c.name.toLowerCase())) && (
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  {t('import.unknownColumns')}
                </div>
              )}
            </div>

            {/* Preview */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">
                {t('import.preview')} ({parsed.rows.length} {t('import.rows')})
              </Label>
              <div className="overflow-x-auto rounded-md border border-border-subtle">
                <table className="text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-raised">
                      {columns.filter((c) => c.include).map((col, i) => (
                        <th key={i} className="px-3 py-1.5 text-left font-mono font-medium text-text-muted whitespace-nowrap border-b border-border-subtle">
                          {col.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => {
                      const includedIndices = columns.map((c, i) => c.include ? i : -1).filter((i) => i >= 0)
                      return (
                        <tr key={ri} className="border-t border-border-subtle hover:bg-surface-raised/50">
                          {includedIndices.map((ci) => (
                            <td key={ci} className="px-3 py-1 font-mono whitespace-nowrap max-w-64 truncate">
                              {row[ci] === null ? (
                                <span className="text-text-muted italic">NULL</span>
                              ) : (
                                String(row[ci])
                              )}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Import ── */}
        {step === 'import' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            {importing && (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">{t('import.importing')}</p>
                  {progress && (
                    <>
                      <p className="text-xs text-text-muted">
                        {progress.rowsInserted} / {progress.totalRows} {t('import.rows')}
                      </p>
                      <div className="w-64 h-2 bg-surface-raised rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${progress.totalRows > 0 ? (progress.rowsInserted / progress.totalRows) * 100 : 0}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {done && (
              <>
                <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Check className="h-6 w-6 text-green-500" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">{t('import.success')}</p>
                  <p className="text-xs text-text-muted">
                    {progress?.totalRows ?? 0} {t('import.rowsInserted')} → {tableName}
                  </p>
                </div>
              </>
            )}

            {importError && (
              <>
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-destructive">{t('import.error')}</p>
                  <p className="text-xs text-text-muted max-w-sm">{importError}</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter>
          {step === 'upload' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={!file || !format || parsing}
                onClick={handleParse}
              >
                {parsing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {t('import.next')}
              </Button>
            </>
          )}

          {step === 'configure' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep('upload')}>
                <ChevronLeft className="h-3.5 w-3.5" />
                {t('import.back')}
              </Button>
              <Button
                size="sm"
                disabled={!tableName.trim() || includedCount === 0}
                onClick={handleImport}
              >
                <Upload className="h-3.5 w-3.5" />
                {t('import.startImport')} ({parsed?.rows.length ?? 0} {t('import.rows')})
              </Button>
            </>
          )}

          {step === 'import' && (
            <>
              {(done || importError) && (
                <Button
                  size="sm"
                  onClick={() => {
                    if (done) onComplete?.()
                    handleOpenChange(false)
                  }}
                >
                  {done ? t('import.close') : t('common.cancel')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

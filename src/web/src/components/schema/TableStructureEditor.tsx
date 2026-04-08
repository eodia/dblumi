import { useState, useCallback, useMemo, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  Key,
  Trash2,
  Plus,
  Code2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SlideToConfirm } from '@/components/ui/slide-to-confirm'
import { ComboboxChips } from '@/components/ui/combobox-chips'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { readSSE } from '@/api/client'
import type { SchemaTable } from '@/api/connections'

// ── DB-specific type lists ─────────────────────────
const PG_TYPES = [
  'integer', 'bigint', 'serial', 'bigserial', 'smallint',
  'text', 'varchar', 'char',
  'boolean',
  'date', 'timestamp', 'timestamptz', 'time',
  'numeric', 'decimal', 'real', 'double precision',
  'json', 'jsonb',
  'uuid', 'bytea', 'inet', 'cidr', 'macaddr', 'xml', 'money',
  'interval', 'point', 'line', 'polygon', 'array',
  'tsvector', 'tsquery',
] as const

const MYSQL_TYPES = [
  'int', 'tinyint', 'smallint', 'mediumint', 'bigint',
  'float', 'double', 'decimal',
  'varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext',
  'blob', 'tinyblob', 'mediumblob', 'longblob',
  'date', 'datetime', 'timestamp', 'time', 'year',
  'boolean', 'json',
  'enum', 'set',
  'binary', 'varbinary', 'bit',
] as const

const NUMERIC_TYPES = new Set([
  'numeric', 'decimal', 'float', 'double', 'real', 'double precision',
  'money',
])

const MYSQL_ENGINES = ['InnoDB', 'MyISAM', 'MEMORY', 'CSV', 'ARCHIVE', 'BLACKHOLE', 'MERGE', 'FEDERATED', 'NDB']

// Types qui ne peuvent pas avoir de longueur
const NO_SIZE_TYPES = new Set([
  // MySQL
  'tinytext', 'text', 'mediumtext', 'longtext',
  'tinyblob', 'blob', 'mediumblob', 'longblob',
  'date', 'boolean', 'json', 'year',
  // PostgreSQL
  'text', 'boolean', 'date', 'json', 'jsonb',
  'uuid', 'bytea', 'inet', 'cidr', 'macaddr', 'xml', 'money',
  'real', 'double precision', 'tsvector', 'tsquery',
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'point', 'line', 'polygon', 'array', 'interval',
])

// Types MySQL qui requièrent obligatoirement une longueur
const REQUIRES_SIZE_TYPES = new Set(['varchar', 'char', 'varbinary', 'binary', 'bit'])

function typeAllowsSize(dataType: string): boolean {
  return !NO_SIZE_TYPES.has(dataType.toLowerCase())
}

function buildTypeDef(dataType: string, size: string, decimal: string): string {
  let typeDef = dataType
  if (!typeAllowsSize(dataType)) return typeDef
  const effectiveSize = size || (REQUIRES_SIZE_TYPES.has(dataType) ? '255' : '')
  if (effectiveSize) {
    typeDef += decimal ? `(${effectiveSize}, ${decimal})` : `(${effectiveSize})`
  }
  return typeDef
}

// ── Tab definitions ────────────────────────────────
const TABS = ['Colonnes', 'Index', 'Clés étrangères', 'Triggers', 'Options'] as const
type Tab = typeof TABS[number]

// ── Column state ───────────────────────────────────
type ColumnState = {
  id: string
  originalName: string | null // null = new column
  name: string
  dataType: string
  size: string
  decimal: string
  nullable: boolean
  defaultValue: string
  primaryKey: boolean
  originalPrimaryKey: boolean // snapshot at load time, for diff
  deleted: boolean
  modified: boolean
}

// ── Options state ──────────────────────────────────
type PgOptions = { tablespace: string; fillFactor: string; comment: string }
type MysqlOptions = { engine: string; charset: string; collation: string; autoIncrement: string; comment: string }

// ── Props ──────────────────────────────────────────
type Props = {
  table: SchemaTable | null
  connectionId: string
  driver: 'postgresql' | 'mysql'
  onClose: () => void
}

// ── Helpers ────────────────────────────────────────
let _colId = 0
function nextColId() {
  return `col_${++_colId}_${Date.now()}`
}

function parseTypeAndSize(raw: string): { type: string; size: string; decimal: string } {
  const match = raw.match(/^([^(]+)(?:\((\d+)(?:,\s*(\d+))?\))?$/)
  if (!match) return { type: raw, size: '', decimal: '' }
  return { type: match[1]!.trim(), size: match[2] ?? '', decimal: match[3] ?? '' }
}

function buildInitialColumns(table: SchemaTable | null): ColumnState[] {
  if (!table) return []
  return table.columns.map((c) => {
    const parsed = parseTypeAndSize(c.dataType)
    return {
      id: nextColId(),
      originalName: c.name,
      name: c.name,
      dataType: parsed.type,
      size: parsed.size,
      decimal: parsed.decimal,
      nullable: c.nullable,
      defaultValue: '',
      primaryKey: c.primaryKey,
      originalPrimaryKey: c.primaryKey,
      deleted: false,
      modified: false,
    }
  })
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`
}

function backtickIdent(name: string) {
  return `\`${name.replace(/`/g, '``')}\``
}

// ── Sortable column row ────────────────────────────
function SortableColumnRow({
  col,
  driver,
  onUpdate,
  onDelete,
}: {
  col: ColumnState
  driver: 'postgresql' | 'mysql'
  onUpdate: (id: string, patch: Partial<ColumnState>) => void
  onDelete: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }

  const types = driver === 'postgresql' ? PG_TYPES : MYSQL_TYPES
  const isNew = col.originalName === null
  const showDecimal = NUMERIC_TYPES.has(col.dataType.toLowerCase())
  const sizeAllowed = typeAllowsSize(col.dataType)

  const borderColor = col.deleted
    ? 'border-l-red-500'
    : isNew
      ? 'border-l-green-500'
      : col.modified
        ? 'border-l-orange-400'
        : 'border-l-transparent'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1.5 px-2 h-8 border-b border-border-subtle border-l-2',
        borderColor,
        col.deleted && 'opacity-40 line-through',
        isDragging && 'bg-surface-overlay shadow-lg',
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab text-text-muted hover:text-foreground flex-shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Name */}
      <Input
        value={col.name}
        onChange={(e) => onUpdate(col.id, { name: e.target.value, modified: true })}
        disabled={col.deleted}
        className="h-7 font-mono text-xs flex-1 min-w-[100px]"
      />

      {/* Type */}
      <select
        value={col.dataType}
        onChange={(e) => {
          const newType = e.target.value
          const patch: Parameters<typeof onUpdate>[1] = { dataType: newType, modified: true }
          if (!typeAllowsSize(newType)) patch.size = ''
          onUpdate(col.id, patch)
        }}
        disabled={col.deleted}
        className="h-7 rounded-md border border-border bg-background px-2 text-xs font-mono min-w-[120px] focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">--</option>
        {types.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Size */}
      <Input
        type="number"
        value={col.size}
        onChange={(e) => onUpdate(col.id, { size: e.target.value, modified: true })}
        disabled={col.deleted || !sizeAllowed}
        placeholder={sizeAllowed ? 'size' : '—'}
        className="h-7 w-16 text-xs font-mono"
      />

      {/* Decimal (only for numeric types) */}
      {showDecimal && (
        <Input
          type="number"
          value={col.decimal}
          onChange={(e) => onUpdate(col.id, { decimal: e.target.value, modified: true })}
          disabled={col.deleted}
          placeholder="dec"
          className="h-7 w-16 text-xs font-mono"
        />
      )}

      {/* Nullable */}
      <div className="flex items-center justify-center w-8 flex-shrink-0">
        <Checkbox
          checked={col.nullable}
          onCheckedChange={(v) => onUpdate(col.id, { nullable: !!v, modified: true })}
          disabled={col.deleted}
        />
      </div>

      {/* Default */}
      <Input
        value={col.defaultValue}
        onChange={(e) => onUpdate(col.id, { defaultValue: e.target.value, modified: true })}
        disabled={col.deleted}
        placeholder="default"
        className="h-7 text-xs w-24"
      />

      {/* PK toggle */}
      <button
        type="button"
        disabled={col.deleted}
        onClick={() => onUpdate(col.id, { primaryKey: !col.primaryKey, modified: true })}
        title={col.primaryKey ? 'Retirer la clé primaire' : 'Définir comme clé primaire'}
        className={cn(
          'flex items-center justify-center w-6 h-6 flex-shrink-0 rounded transition-colors',
          col.primaryKey
            ? 'text-yellow-500 hover:text-yellow-400'
            : 'text-text-muted opacity-30 hover:opacity-70 hover:text-yellow-500',
          col.deleted && 'cursor-not-allowed pointer-events-none',
        )}
      >
        <Key className="h-3.5 w-3.5" />
      </button>

      {/* Delete */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive flex-shrink-0"
        onClick={() => {
          if (col.originalName === null) {
            // New column: remove entirely
            onDelete(col.id)
          } else {
            onUpdate(col.id, { deleted: !col.deleted })
          }
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ── Main component ─────────────────────────────────
// ── Index Editor ─────────────────────────────────
type IndexDef = { id: string; originalName: string | null; name: string; columns: string[]; unique: boolean; deleted: boolean }

function IndexRow({ idx, availableColumns, onUpdate, onDelete }: {
  idx: IndexDef
  availableColumns: Array<{ name: string }>
  onUpdate: (id: string, patch: Partial<IndexDef>) => void
  onDelete: (id: string) => void
}) {
  const isNew = idx.originalName === null
  const borderColor = idx.deleted ? 'border-l-red-500' : isNew ? 'border-l-green-500' : 'border-l-transparent'
  const colOptions = availableColumns.map((c) => ({ id: c.name, label: c.name }))

  return (
    <div className={cn(
      'flex items-center gap-1.5 px-2 h-9 border-b border-border-subtle border-l-2',
      borderColor,
      idx.deleted && 'opacity-40 line-through',
    )}>
      <Input
        value={idx.name}
        onChange={(e) => onUpdate(idx.id, { name: e.target.value })}
        disabled={idx.deleted}
        placeholder="index_name"
        className="h-7 font-mono text-xs w-40 flex-shrink-0"
      />
      <div className="flex items-center justify-center w-14 flex-shrink-0">
        <Checkbox
          checked={idx.unique}
          onCheckedChange={(v) => onUpdate(idx.id, { unique: !!v })}
          disabled={idx.deleted}
        />
      </div>
      <div className="flex-1 min-w-0">
        <ComboboxChips
          options={colOptions}
          selected={idx.columns}
          onChange={(cols) => onUpdate(idx.id, { columns: cols })}
          disabled={idx.deleted}
          placeholder="Colonnes..."
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive flex-shrink-0"
        onClick={() => isNew ? onDelete(idx.id) : onUpdate(idx.id, { deleted: !idx.deleted })}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function IndexEditor({ columns, indexes, onIndexesChange }: {
  columns: Array<{ name: string }>
  indexes: IndexDef[]
  onIndexesChange: (indexes: IndexDef[]) => void
}) {
  const addIndex = () => {
    onIndexesChange([...indexes, { id: crypto.randomUUID(), originalName: null, name: '', columns: [], unique: false, deleted: false }])
  }

  const updateIndex = (id: string, patch: Partial<IndexDef>) => {
    onIndexesChange(indexes.map((idx) => idx.id === id ? { ...idx, ...patch } : idx))
  }

  const deleteIndex = (id: string) => {
    onIndexesChange(indexes.filter((idx) => idx.id !== id))
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 h-7 border-b border-border-subtle bg-surface-raised/50 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        <div className="w-40 flex-shrink-0">Nom</div>
        <div className="w-14 text-center flex-shrink-0">Unique</div>
        <div className="flex-1">Colonnes</div>
        <div className="w-7" />
      </div>

      {indexes.map((idx) => (
        <IndexRow key={idx.id} idx={idx} availableColumns={columns} onUpdate={updateIndex} onDelete={deleteIndex} />
      ))}

      <div className="px-2 py-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-text-muted hover:text-foreground" onClick={addIndex}>
          <Plus className="h-3.5 w-3.5" />
          Ajouter un index
        </Button>
      </div>
    </div>
  )
}

// ── Foreign Key Editor ────────────────────────────
const FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'] as const

type ForeignKeyDef = {
  id: string
  originalName: string | null
  name: string
  fields: string[]
  referencedDatabase: string
  referencedTable: string
  referencedFields: string[]
  onDelete: string
  onUpdate: string
  deleted: boolean
}

function ForeignKeyRow({ fk, availableColumns, onUpdate, onDelete }: {
  fk: ForeignKeyDef
  availableColumns: Array<{ name: string }>
  onUpdate: (id: string, patch: Partial<ForeignKeyDef>) => void
  onDelete: (id: string) => void
}) {
  const isNew = fk.originalName === null
  const borderColor = fk.deleted ? 'border-l-red-500' : isNew ? 'border-l-green-500' : 'border-l-transparent'
  const colOptions = availableColumns.map((c) => ({ id: c.name, label: c.name }))
  const selectCls = 'h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className={cn(
      'flex flex-col gap-1.5 px-2 py-1.5 border-b border-border-subtle border-l-2',
      borderColor,
      fk.deleted && 'opacity-40',
    )}>
      {/* Row 1: nom, fields locaux → table ref, fields ref */}
      <div className="flex items-center gap-1.5">
        <Input
          value={fk.name}
          onChange={(e) => onUpdate(fk.id, { name: e.target.value })}
          disabled={fk.deleted}
          placeholder="fk_name"
          className="h-7 font-mono text-xs w-36 flex-shrink-0"
        />
        <div className="w-36 flex-shrink-0">
          <ComboboxChips
            options={colOptions}
            selected={fk.fields}
            onChange={(v) => onUpdate(fk.id, { fields: v })}
            disabled={fk.deleted}
            placeholder="Colonnes..."
          />
        </div>
        <span className="text-text-muted text-xs flex-shrink-0">→</span>
        <Input
          value={fk.referencedTable}
          onChange={(e) => onUpdate(fk.id, { referencedTable: e.target.value })}
          disabled={fk.deleted}
          placeholder="table_ref"
          className="h-7 font-mono text-xs w-36 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <ComboboxChips
            options={[]}
            selected={fk.referencedFields}
            onChange={(v) => onUpdate(fk.id, { referencedFields: v })}
            disabled={fk.deleted}
            placeholder="Colonnes ref..."
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive flex-shrink-0"
          onClick={() => isNew ? onDelete(fk.id) : onUpdate(fk.id, { deleted: !fk.deleted })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* Row 2: db ref, on delete, on update */}
      <div className="flex items-center gap-1.5 pl-1">
        <Input
          value={fk.referencedDatabase}
          onChange={(e) => onUpdate(fk.id, { referencedDatabase: e.target.value })}
          disabled={fk.deleted}
          placeholder="base (optionnel)"
          className="h-6 text-xs w-36 flex-shrink-0"
        />
        <span className="text-[10px] text-text-muted flex-shrink-0">ON DELETE</span>
        <select
          value={fk.onDelete}
          onChange={(e) => onUpdate(fk.id, { onDelete: e.target.value })}
          disabled={fk.deleted}
          className={cn(selectCls, 'w-28 flex-shrink-0')}
        >
          {FK_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-[10px] text-text-muted flex-shrink-0">ON UPDATE</span>
        <select
          value={fk.onUpdate}
          onChange={(e) => onUpdate(fk.id, { onUpdate: e.target.value })}
          disabled={fk.deleted}
          className={cn(selectCls, 'w-28 flex-shrink-0')}
        >
          {FK_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
    </div>
  )
}

function ForeignKeyEditor({ columns, foreignKeys, onForeignKeysChange }: {
  columns: Array<{ name: string }>
  foreignKeys: ForeignKeyDef[]
  onForeignKeysChange: (fks: ForeignKeyDef[]) => void
}) {
  const addFK = () => {
    onForeignKeysChange([...foreignKeys, {
      id: crypto.randomUUID(), originalName: null, name: '', fields: [],
      referencedDatabase: '', referencedTable: '', referencedFields: [],
      onDelete: 'NO ACTION', onUpdate: 'NO ACTION', deleted: false,
    }])
  }

  const updateFK = (id: string, patch: Partial<ForeignKeyDef>) => {
    onForeignKeysChange(foreignKeys.map((fk) => fk.id === id ? { ...fk, ...patch } : fk))
  }

  const deleteFK = (id: string) => {
    onForeignKeysChange(foreignKeys.filter((fk) => fk.id !== id))
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 h-7 border-b border-border-subtle bg-surface-raised/50 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        <div className="w-36 flex-shrink-0">Nom</div>
        <div className="w-36 flex-shrink-0">Fields</div>
        <div className="w-4 flex-shrink-0" />
        <div className="w-36 flex-shrink-0">Referenced Table</div>
        <div className="flex-1">Referenced Fields</div>
        <div className="w-7" />
      </div>

      {foreignKeys.map((fk) => (
        <ForeignKeyRow key={fk.id} fk={fk} availableColumns={columns} onUpdate={updateFK} onDelete={deleteFK} />
      ))}

      <div className="px-2 py-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-text-muted hover:text-foreground" onClick={addFK}>
          <Plus className="h-3.5 w-3.5" />
          Ajouter une clé étrangère
        </Button>
      </div>
    </div>
  )
}

export function TableStructureEditor({ table, connectionId, driver, onClose }: Props) {
  const { t } = useI18n()

  // ── Table name & comment ─────────────────────────
  const [tableName, setTableName] = useState(table?.name ?? '')
  const [tableComment, setTableComment] = useState(table?.comment ?? '')
  const originalName = useRef(table?.name ?? '')
  const originalComment = useRef(table?.comment ?? '')

  // ── Tabs ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('Colonnes')

  // ── Columns ──────────────────────────────────────
  const [columns, setColumns] = useState<ColumnState[]>(() => buildInitialColumns(table))

  // ── Indexes ──────────────────────────────────────
  const [indexes, setIndexes] = useState<IndexDef[]>(() =>
    (table?.indexes ?? []).map((idx) => ({
      id: crypto.randomUUID(),
      originalName: idx.name,
      name: idx.name,
      columns: idx.columns,
      unique: idx.unique,
      deleted: false,
    }))
  )

  // ── Foreign Keys ─────────────────────────────────
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyDef[]>(() =>
    (table?.foreignKeys ?? []).map((fk) => ({
      id: crypto.randomUUID(),
      originalName: fk.name,
      name: fk.name,
      fields: fk.fields,
      referencedDatabase: fk.referencedDatabase,
      referencedTable: fk.referencedTable,
      referencedFields: fk.referencedFields,
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
      deleted: false,
    }))
  )

  // ── Options ──────────────────────────────────────
  const [pgOptions, setPgOptions] = useState<PgOptions>({ tablespace: '', fillFactor: '', comment: '' })
  const [mysqlOptions, setMysqlOptions] = useState<MysqlOptions>({
    engine: 'InnoDB', charset: '', collation: '', autoIncrement: '', comment: '',
  })

  // ── Column helpers ───────────────────────────────
  const updateColumn = useCallback((id: string, patch: Partial<ColumnState>) => {
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const deleteColumn = useCallback((id: string) => {
    setColumns((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const addColumn = useCallback(() => {
    setColumns((prev) => [
      ...prev,
      {
        id: nextColId(),
        originalName: null,
        name: '',
        dataType: driver === 'postgresql' ? 'text' : 'varchar',
        size: driver === 'mysql' ? '255' : '',
        decimal: '',
        nullable: true,
        defaultValue: '',
        primaryKey: false,
        originalPrimaryKey: false,
        deleted: false,
        modified: false,
      },
    ])
  }, [driver])

  // ── Drag & drop ──────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setColumns((prev) => {
      const oldIdx = prev.findIndex((c) => c.id === active.id)
      const newIdx = prev.findIndex((c) => c.id === over.id)
      return arrayMove(prev, oldIdx, newIdx)
    })
  }, [])

  // ── Has changes? ─────────────────────────────────
  const hasChanges = useMemo(() => {
    if (tableName !== originalName.current) return true
    if (tableComment !== originalComment.current) return true
    for (const col of columns) {
      if (col.originalName === null) return true
      if (col.deleted) return true
      if (col.modified) return true
    }
    if (indexes.some((idx) => idx.deleted || idx.originalName === null)) return true
    if (foreignKeys.some((fk) => fk.deleted || fk.originalName === null)) return true
    return false
  }, [tableName, tableComment, columns, indexes, foreignKeys])

  // ── SQL generation & execution ───────────────────
  const generateSQL = useCallback((): string[] => {
    const stmts: string[] = []
    const q = driver === 'postgresql' ? quoteIdent : backtickIdent
    const tbl = q(originalName.current || tableName)
    const isNew = !table || !table.name

    if (isNew) {
      // CREATE TABLE
      const newCols = columns.filter((c) => !c.deleted)
      if (newCols.length === 0) return []
      const colDefs = newCols.map((c) => {
        let def = `  ${q(c.name)} ${buildTypeDef(c.dataType, c.size, c.decimal)}`
        if (!c.nullable) def += ' NOT NULL'
        if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`
        if (c.primaryKey) def += ' PRIMARY KEY'
        return def
      })
      stmts.push(`CREATE TABLE ${q(tableName)} (\n${colDefs.join(',\n')}\n)`)
      if (tableComment) {
        if (driver === 'postgresql') {
          stmts.push(`COMMENT ON TABLE ${q(tableName)} IS '${tableComment.replace(/'/g, "''")}'`)
        }
      }
      return stmts
    }

    // ALTER TABLE flow
    // Rename table
    if (tableName !== originalName.current) {
      if (driver === 'postgresql') {
        stmts.push(`ALTER TABLE ${tbl} RENAME TO ${q(tableName)}`)
      } else {
        stmts.push(`ALTER TABLE ${tbl} RENAME TO ${q(tableName)}`)
      }
    }

    const effectiveTable = q(tableName)

    // Comment on table
    if (tableComment) {
      if (driver === 'postgresql') {
        stmts.push(`COMMENT ON TABLE ${effectiveTable} IS '${tableComment.replace(/'/g, "''")}'`)
      } else {
        stmts.push(`ALTER TABLE ${effectiveTable} COMMENT = '${tableComment.replace(/'/g, "''")}'`)
      }
    }

    // Drop deleted columns
    for (const col of columns) {
      if (col.deleted && col.originalName) {
        stmts.push(`ALTER TABLE ${effectiveTable} DROP COLUMN ${q(col.originalName)}`)
      }
    }

    // Rename columns
    for (const col of columns) {
      if (col.deleted || col.originalName === null) continue
      if (col.name !== col.originalName) {
        if (driver === 'postgresql') {
          stmts.push(`ALTER TABLE ${effectiveTable} RENAME COLUMN ${q(col.originalName)} TO ${q(col.name)}`)
        } else {
          stmts.push(`ALTER TABLE ${effectiveTable} RENAME COLUMN ${q(col.originalName)} TO ${q(col.name)}`)
        }
      }
    }

    // Add new columns
    for (const col of columns) {
      if (col.deleted || col.originalName !== null) continue
      const typeDef = buildTypeDef(col.dataType, col.size, col.decimal)
      const nullable = col.nullable ? '' : ' NOT NULL'
      const def = col.defaultValue ? ` DEFAULT ${col.defaultValue}` : ''
      stmts.push(`ALTER TABLE ${effectiveTable} ADD COLUMN ${q(col.name)} ${typeDef}${nullable}${def}`)
    }

    // Modify existing columns (type changes)
    for (const col of columns) {
      if (col.deleted || col.originalName === null || !col.modified) continue
      // Skip if only name changed (already handled above)
      if (col.name !== col.originalName) continue

      const typeDef = buildTypeDef(col.dataType, col.size, col.decimal)

      if (driver === 'postgresql') {
        stmts.push(`ALTER TABLE ${effectiveTable} ALTER COLUMN ${q(col.name)} TYPE ${typeDef}`)
        if (col.nullable) {
          stmts.push(`ALTER TABLE ${effectiveTable} ALTER COLUMN ${q(col.name)} DROP NOT NULL`)
        } else {
          stmts.push(`ALTER TABLE ${effectiveTable} ALTER COLUMN ${q(col.name)} SET NOT NULL`)
        }
        if (col.defaultValue) {
          stmts.push(`ALTER TABLE ${effectiveTable} ALTER COLUMN ${q(col.name)} SET DEFAULT ${col.defaultValue}`)
        } else {
          stmts.push(`ALTER TABLE ${effectiveTable} ALTER COLUMN ${q(col.name)} DROP DEFAULT`)
        }
      } else {
        const nullable = col.nullable ? '' : ' NOT NULL'
        const def = col.defaultValue ? ` DEFAULT ${col.defaultValue}` : ''
        stmts.push(`ALTER TABLE ${effectiveTable} MODIFY COLUMN ${q(col.name)} ${typeDef}${nullable}${def}`)
      }
    }

    // Column reorder (MySQL only)
    if (driver === 'mysql') {
      const activeColumns = columns.filter((c) => !c.deleted)
      for (let i = 0; i < activeColumns.length; i++) {
        const col = activeColumns[i]!
        if (col.originalName === null) continue // new columns already added
        const prev = activeColumns[i - 1]
        const afterClause = i === 0 ? 'FIRST' : `AFTER ${q(prev!.name)}`
        const typeDef = buildTypeDef(col.dataType, col.size, col.decimal)
        const nullable = col.nullable ? '' : ' NOT NULL'
        const def = col.defaultValue ? ` DEFAULT ${col.defaultValue}` : ''
        stmts.push(`ALTER TABLE ${effectiveTable} MODIFY COLUMN ${q(col.name)} ${typeDef}${nullable}${def} ${afterClause}`)
      }
    }

    // PRIMARY KEY changes
    const originalPKCols = columns.filter((c) => c.originalName !== null && c.originalPrimaryKey && !c.deleted)
    const newPKCols = columns.filter((c) => !c.deleted && c.primaryKey)
    const pkChanged =
      originalPKCols.length !== newPKCols.length ||
      originalPKCols.some((c) => !c.primaryKey) ||
      newPKCols.some((c) => c.originalName === null || !c.originalPrimaryKey)
    if (pkChanged) {
      if (originalPKCols.length > 0) {
        if (driver === 'postgresql') {
          stmts.push(`ALTER TABLE ${effectiveTable} DROP CONSTRAINT ${q(`${tableName}_pkey`)}`)
        } else {
          stmts.push(`ALTER TABLE ${effectiveTable} DROP PRIMARY KEY`)
        }
      }
      if (newPKCols.length > 0) {
        const cols = newPKCols.map((c) => q(c.name)).join(', ')
        stmts.push(`ALTER TABLE ${effectiveTable} ADD PRIMARY KEY (${cols})`)
      }
    }

    // DROP INDEX for deleted existing indexes
    for (const idx of indexes) {
      if (!idx.deleted || idx.originalName === null) continue
      if (driver === 'postgresql') {
        stmts.push(`DROP INDEX ${q(idx.originalName)}`)
      } else {
        stmts.push(`DROP INDEX ${q(idx.originalName)} ON ${q(tableName)}`)
      }
    }

    // CREATE INDEX for new non-deleted indexes with at least one column
    for (const idx of indexes) {
      if (idx.deleted || idx.originalName !== null || !idx.name.trim() || idx.columns.length === 0) continue
      const uniq = idx.unique ? 'UNIQUE ' : ''
      const cols = idx.columns.map(q).join(', ')
      stmts.push(`CREATE ${uniq}INDEX ${q(idx.name)} ON ${q(tableName)} (${cols})`)
    }

    // DROP CONSTRAINT for deleted existing foreign keys
    for (const fk of foreignKeys) {
      if (!fk.deleted || fk.originalName === null) continue
      if (driver === 'postgresql') {
        stmts.push(`ALTER TABLE ${effectiveTable} DROP CONSTRAINT ${q(fk.originalName)}`)
      } else {
        stmts.push(`ALTER TABLE ${effectiveTable} DROP FOREIGN KEY ${q(fk.originalName)}`)
      }
    }

    // ADD CONSTRAINT for new foreign keys
    for (const fk of foreignKeys) {
      if (fk.deleted || fk.originalName !== null || !fk.name.trim() || fk.fields.length === 0 || !fk.referencedTable.trim() || fk.referencedFields.length === 0) continue
      const fields = fk.fields.map(q).join(', ')
      const refFields = fk.referencedFields.map(q).join(', ')
      const refTable = fk.referencedDatabase ? `${q(fk.referencedDatabase)}.${q(fk.referencedTable)}` : q(fk.referencedTable)
      stmts.push(`ALTER TABLE ${effectiveTable} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${fields}) REFERENCES ${refTable} (${refFields}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`)
    }

    return stmts
  }, [columns, indexes, foreignKeys, driver, table, tableName, tableComment])

  const [error, setError] = useState<string | null>(null)
  const [showSqlPreview, setShowSqlPreview] = useState(false)

  const applyChanges = useCallback(async () => {
    setError(null)
    const statements = generateSQL()
    for (const sql of statements) {
      const stream = readSSE('/query', { connectionId, sql, limit: 1, force: true })
      for await (const event of stream) {
        if (event.event === '__http') {
          const body = event.data as { status: number; body: Record<string, unknown> }
          const msg = (body.body?.message ?? body.body?.title ?? 'SQL error') as string
          setError(`${msg}\n\nSQL: ${sql}`)
          return
        }
        if (event.event === 'error') {
          const d = event.data as { message: string }
          setError(`${d.message}\n\nSQL: ${sql}`)
          return
        }
      }
    }
    onClose()
  }, [generateSQL, connectionId, onClose])

  // ── Column IDs for sortable context ──────────────
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns])

  // ── Render ───────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-card">
      {/* ── Header: table name + comment ──────────── */}
      <div className="flex gap-4 px-4 py-3 border-b border-border-subtle">
        <div className="flex flex-col gap-1 flex-shrink-0">
          <label className="text-xs font-medium text-text-muted">{t('table.tableName')}</label>
          <Input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="table_name"
            className="h-8 font-mono text-sm w-[200px]"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium text-text-muted">{t('table.comment')}</label>
          <textarea
            value={tableComment}
            onChange={(e) => setTableComment(e.target.value)}
            placeholder="…"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────── */}
      <div className="flex items-center gap-0 px-4 border-b border-border-subtle">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-text-muted hover:text-foreground',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {/* ── Columns tab ─────────────────────────── */}
        {activeTab === 'Colonnes' && (
          <div className="flex flex-col">
            {/* Header row */}
            <div className="flex items-center gap-1.5 px-2 h-7 border-b border-border-subtle bg-surface-raised/50 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <div className="w-[22px]" /> {/* drag handle spacer */}
              <div className="flex-1 min-w-[100px]">{t('table.columnName')}</div>
              <div className="min-w-[120px]">{t('table.columnType')}</div>
              <div className="w-16">Size</div>
              <div className="w-8 text-center">{t('table.columnNullable').slice(0, 4)}</div>
              <div className="w-24">{t('table.columnDefault')}</div>
              <div className="w-6 text-center">PK</div>
              <div className="w-7" /> {/* delete spacer */}
            </div>

            {/* Column rows */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={columnIds} strategy={verticalListSortingStrategy}>
                {columns.map((col) => (
                  <SortableColumnRow
                    key={col.id}
                    col={col}
                    driver={driver}
                    onUpdate={updateColumn}
                    onDelete={deleteColumn}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {/* Add column button */}
            <div className="px-2 py-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-text-muted hover:text-foreground"
                onClick={addColumn}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('table.addColumn')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Index tab ───────────────────────────── */}
        {activeTab === 'Index' && (
          <IndexEditor
            columns={columns.filter((c) => !c.deleted)}
            indexes={indexes}
            onIndexesChange={setIndexes}
          />
        )}

        {/* ── Foreign keys tab ────────────────────── */}
        {activeTab === 'Clés étrangères' && (
          <ForeignKeyEditor
            columns={columns.filter((c) => !c.deleted)}
            foreignKeys={foreignKeys}
            onForeignKeysChange={setForeignKeys}
          />
        )}

        {/* ── Triggers tab ────────────────────────── */}
        {activeTab === 'Triggers' && (
          <div className="flex items-center justify-center h-32 text-sm text-text-muted">
            Trigger management — coming soon
          </div>
        )}

        {/* ── Options tab ─────────────────────────── */}
        {activeTab === 'Options' && (
          <div className="p-4 space-y-4 max-w-md">
            {driver === 'mysql' ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">Engine</label>
                  <select
                    value={mysqlOptions.engine}
                    onChange={(e) => setMysqlOptions((o) => ({ ...o, engine: e.target.value }))}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {MYSQL_ENGINES.map((eng) => (
                      <option key={eng} value={eng}>{eng}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">Character set</label>
                  <Input
                    value={mysqlOptions.charset}
                    onChange={(e) => setMysqlOptions((o) => ({ ...o, charset: e.target.value }))}
                    placeholder="utf8mb4"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">Collation</label>
                  <Input
                    value={mysqlOptions.collation}
                    onChange={(e) => setMysqlOptions((o) => ({ ...o, collation: e.target.value }))}
                    placeholder="utf8mb4_unicode_ci"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">Auto Increment</label>
                  <Input
                    type="number"
                    value={mysqlOptions.autoIncrement}
                    onChange={(e) => setMysqlOptions((o) => ({ ...o, autoIncrement: e.target.value }))}
                    placeholder="1"
                    className="h-8 text-sm"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">Tablespace</label>
                  <Input
                    value={pgOptions.tablespace}
                    onChange={(e) => setPgOptions((o) => ({ ...o, tablespace: e.target.value }))}
                    placeholder="pg_default"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">Fill factor</label>
                  <Input
                    type="number"
                    value={pgOptions.fillFactor}
                    onChange={(e) => setPgOptions((o) => ({ ...o, fillFactor: e.target.value }))}
                    placeholder="100"
                    className="h-8 text-sm"
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── SQL Preview ───────────────────────────── */}
      {showSqlPreview && (
        <div className="mx-4 mb-2 rounded-md border border-border-subtle bg-surface-raised">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">SQL</span>
          </div>
          <pre className="px-3 py-2 text-xs font-mono text-foreground whitespace-pre-wrap overflow-auto max-h-48">
            {generateSQL().join(';\n\n') || '-- Aucune modification'}
          </pre>
        </div>
      )}

      {/* ── Error ─────────────────────────────────── */}
      {error && (
        <div className="mx-4 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* ── Footer ────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={showSqlPreview ? 'text-foreground' : 'text-text-muted'}
            onClick={() => setShowSqlPreview((v) => !v)}
          >
            <Code2 className="h-3.5 w-3.5 mr-1.5" />
            SQL
          </Button>
        </div>
        {hasChanges && !tableName.trim() && (
          <span className="text-xs text-destructive">{t('table.tableNameRequired')}</span>
        )}
        {hasChanges && tableName.trim() && (
          <div className="w-64">
            <SlideToConfirm
              variant="default"
              label={t('table.slideToApply')}
              onConfirm={applyChanges}
            />
          </div>
        )}
      </div>
    </div>
  )
}

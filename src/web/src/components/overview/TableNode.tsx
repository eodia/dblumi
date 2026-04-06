// src/web/src/components/overview/TableNode.tsx
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Table2, Eye } from 'lucide-react'
import type { SchemaTable } from '@/api/connections'

const COL_H = 24
const COL_LIMIT = 10

export type TableNodeData = {
  table: SchemaTable
  visibleColCount: number
  isExpanded: boolean
  onToggleExpand: (name: string) => void
  onClickTable: (name: string) => void
}

export const TableNode = memo(function TableNode({ data }: NodeProps) {
  const { table, visibleColCount, isExpanded, onToggleExpand, onClickTable } = data as TableNodeData
  const hasMore = table.columns.length > COL_LIMIT

  return (
    <div className="rounded border border-border bg-card shadow-sm overflow-hidden text-foreground">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-1.5 !h-1.5 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-1.5 !h-1.5 !border-0" />

      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-2.5 border-b border-border bg-surface-raised cursor-pointer hover:bg-surface-overlay transition-colors h-9"
        onClick={() => onClickTable(table.name)}
      >
        {table.type === 'view'
          ? <Eye className="h-3 w-3 text-violet-400 flex-shrink-0" />
          : <Table2 className="h-3 w-3 text-blue-400 flex-shrink-0" />}
        <span className="text-[11px] font-semibold truncate">{table.name}</span>
        <span className="ml-auto text-[9px] text-muted-foreground/50">{table.columns.length}</span>
      </div>

      {/* Columns */}
      {table.columns.slice(0, visibleColCount).map((col) => (
        <div
          key={col.name}
          className="flex items-center gap-1.5 px-2.5 border-b border-border/20 last:border-0"
          style={{ height: COL_H }}
        >
          {col.primaryKey && (
            <span className="text-[9px] font-bold text-amber-400 flex-shrink-0 leading-none">PK</span>
          )}
          {table.foreignKeys?.some((fk) => fk.fields.includes(col.name)) && (
            <span className="text-[9px] font-bold text-blue-400 flex-shrink-0 leading-none">FK</span>
          )}
          <span className="text-[10px] truncate flex-1">{col.name}</span>
          <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 truncate max-w-[70px]">{col.dataType}</span>
        </div>
      ))}

      {/* Expand/collapse */}
      {hasMore && (
        <button
          type="button"
          className="flex items-center justify-center w-full text-[9px] text-muted-foreground hover:text-foreground transition-colors border-t border-border/20"
          style={{ height: COL_H }}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(table.name) }}
        >
          {isExpanded ? '▲ voir moins' : `+ ${table.columns.length - COL_LIMIT} colonnes`}
        </button>
      )}
    </div>
  )
})

// src/web/src/components/overview/ErdDiagram.tsx
import { useMemo, useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
  Position,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { connectionsApi, type SchemaTable } from '@/api/connections'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { TableNode, type TableNodeData } from './TableNode'

type Props = { connectionId: string; onNavigate: (page: 'sql-editor' | 'tables') => void }

const NODE_W = 260
const HEADER_H = 36
const COL_H = 24
const COL_LIMIT = 10
const COL_GAP = 80
const ROW_GAP = 60

const nodeTypes: NodeTypes = { tableNode: TableNode }

function buildNodesAndEdges(
  tables: SchemaTable[],
  expandedNodes: Set<string>,
  onToggleExpand: (name: string) => void,
  onClickTable: (name: string) => void,
): { nodes: Node<TableNodeData>[]; edges: Edge[] } {
  const COLS = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(tables.length))))

  // Calculate row heights for proper positioning
  const tablesMeta = tables.map((table, i) => {
    const isExpanded = expandedNodes.has(table.name)
    const visibleColCount = isExpanded ? table.columns.length : Math.min(COL_LIMIT, table.columns.length)
    const hasMore = !isExpanded && table.columns.length > COL_LIMIT
    const height = HEADER_H + visibleColCount * COL_H + (hasMore ? COL_H : 0) + 8
    return { table, col: i % COLS, row: Math.floor(i / COLS), height, visibleColCount }
  })

  const rowCount = Math.ceil(tables.length / COLS)
  const rowHeights = Array.from({ length: rowCount }, (_, r) =>
    Math.max(...tablesMeta.filter((m) => m.row === r).map((m) => m.height), 80),
  )
  const rowY = rowHeights.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1]! + rowHeights[i - 1]! + ROW_GAP)
    return acc
  }, [])

  const nodes: Node<TableNodeData>[] = tablesMeta.map((meta) => ({
    id: meta.table.name,
    type: 'tableNode',
    position: { x: meta.col * (NODE_W + COL_GAP), y: rowY[meta.row]! },
    data: {
      table: meta.table,
      visibleColCount: meta.visibleColCount,
      isExpanded: expandedNodes.has(meta.table.name),
      onToggleExpand,
      onClickTable,
    },
    style: { width: NODE_W },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }))

  const edges: Edge[] = []
  for (const table of tables) {
    for (const fk of table.foreignKeys ?? []) {
      if (!tables.some((t) => t.name === fk.referencedTable)) continue
      edges.push({
        id: `${table.name}-${fk.name || fk.referencedTable}-${fk.fields.join(',')}`,
        source: table.name,
        target: fk.referencedTable,
        type: 'smoothstep',
        animated: false,
        style: { stroke: 'var(--color-muted-foreground)', strokeWidth: 1.5, opacity: 0.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-muted-foreground)', width: 16, height: 16 },
        label: fk.fields.join(', '),
        labelStyle: { fill: 'var(--color-muted-foreground)', fontSize: 9, fontFamily: 'var(--font-mono)' },
        labelBgStyle: { fill: 'var(--color-background)', fillOpacity: 0.8 },
      })
    }
  }

  return { nodes, edges }
}

export function ErdDiagram({ connectionId, onNavigate }: Props) {
  const { t } = useI18n()

  const { data: schema, isLoading } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const toggleExpand = useCallback((name: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }, [])

  const { openTable } = useEditorStore()
  const handleClickTable = useCallback((name: string) => {
    openTable(name)
    onNavigate('sql-editor')
  }, [openTable, onNavigate])

  const allTables = schema?.tables ?? []

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(allTables, expandedNodes, toggleExpand, handleClickTable),
    [allTables, expandedNodes, toggleExpand, handleClickTable],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Sync when data changes (expand/collapse, new schema)
  useMemo(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
      </div>
    )
  }

  if (allTables.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">{t('overview.noSchema')}</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{t('overview.erd')}</span>
        <span className="text-[10px] text-muted-foreground">{t('overview.erdHint')}</span>
      </div>
      <div className="rounded border border-border bg-surface h-[520px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border-subtle)" />
          <Controls
            showInteractive={false}
            className="erd-controls"
          />
          <MiniMap
            nodeColor="var(--color-surface-raised)"
            nodeStrokeColor="var(--color-border)"
            maskColor="rgba(0, 0, 0, 0.6)"
            className="erd-minimap"
          />
        </ReactFlow>
      </div>
    </div>
  )
}

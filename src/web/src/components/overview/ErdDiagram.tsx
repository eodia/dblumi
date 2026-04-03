// src/web/src/components/overview/ErdDiagram.tsx
import { useRef, useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi, type SchemaTable } from '@/api/connections'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Table2, Eye } from 'lucide-react'

type Props = { connectionId: string; onNavigate: (page: 'sql-editor' | 'tables') => void }

const NODE_W = 240
const HEADER_H = 32
const COL_H = 22
const NODE_PAD = 8
const COL_GAP = 60
const ROW_GAP = 48

type LayoutNode = SchemaTable & { x: number; y: number; width: number; height: number }

function layoutNodes(tables: SchemaTable[]): LayoutNode[] {
  const COLS = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(tables.length))))
  const nodes = tables.map((table, i) => ({
    ...table,
    col: i % COLS,
    row: Math.floor(i / COLS),
    width: NODE_W,
    height: HEADER_H + table.columns.length * COL_H + NODE_PAD,
  }))
  const rowCount = Math.ceil(tables.length / COLS)
  const rowHeights = Array.from({ length: rowCount }, (_, r) =>
    Math.max(...nodes.filter((n) => n.row === r).map((n) => n.height), 80),
  )
  const rowY = rowHeights.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1]! + rowHeights[i - 1]! + ROW_GAP)
    return acc
  }, [])
  return nodes.map((n) => ({
    ...n,
    x: n.col * (NODE_W + COL_GAP),
    y: rowY[n.row]!,
  }))
}

type EdgePath = { id: string; d: string }

function buildEdges(nodes: LayoutNode[]): EdgePath[] {
  const nodeMap = new Map(nodes.map((n) => [n.name, n]))
  const edges: EdgePath[] = []

  for (const node of nodes) {
    for (const fk of node.foreignKeys ?? []) {
      const target = nodeMap.get(fk.referencedTable)
      if (!target) continue
      const srcColIdx = node.columns.findIndex((c) => fk.fields.includes(c.name))
      const dstColIdx = target.columns.findIndex((c) => fk.referencedFields.includes(c.name))
      const srcY = node.y + HEADER_H + (srcColIdx >= 0 ? srcColIdx : 0) * COL_H + COL_H / 2
      const dstY = target.y + HEADER_H + (dstColIdx >= 0 ? dstColIdx : 0) * COL_H + COL_H / 2
      const srcRight = node.x + NODE_W
      const dstLeft = target.x
      const srcLeft = node.x
      const dstRight = target.x + NODE_W
      let x1: number, x2: number, y1: number, y2: number
      if (Math.abs(srcRight - dstLeft) <= Math.abs(srcLeft - dstRight)) {
        x1 = srcRight; y1 = srcY; x2 = dstLeft; y2 = dstY
      } else {
        x1 = srcLeft; y1 = srcY; x2 = dstRight; y2 = dstY
      }
      const cp = Math.abs(x2 - x1) * 0.5
      const d = `M ${x1} ${y1} C ${x1 + (x1 < x2 ? cp : -cp)} ${y1} ${x2 + (x1 < x2 ? -cp : cp)} ${y2} ${x2} ${y2}`
      edges.push({ id: `${node.name}-${fk.name ?? fk.referencedTable}`, d })
    }
  }
  return edges
}

export function ErdDiagram({ connectionId, onNavigate }: Props) {
  const { t } = useI18n()
  const { openTable } = useEditorStore()

  const { data: schema, isLoading } = useQuery({
    queryKey: ['schema', connectionId],
    queryFn: () => connectionsApi.schema(connectionId),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 20, y: 20, scale: 1 })
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return
    isDragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    e.preventDefault()
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }, [])

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    setTransform((t) => ({ ...t, scale: Math.max(0.15, Math.min(3, t.scale * factor)) }))
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel, isLoading])

  if (isLoading) return <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">Loading…</div>

  const tables = schema?.tables ?? []
  if (tables.length === 0) return <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">{t('overview.noSchema')}</div>

  const nodes = layoutNodes(tables)
  const edges = buildEdges(nodes)
  const totalW = Math.max(...nodes.map((n) => n.x + n.width)) + COL_GAP
  const totalH = Math.max(...nodes.map((n) => n.y + n.height)) + ROW_GAP

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{t('overview.erd')}</span>
        <span className="text-[10px] text-muted-foreground">{t('overview.erdHint')}</span>
      </div>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded border border-border bg-surface h-[520px] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={() => { isDragging.current = false }}
        onMouseLeave={() => { isDragging.current = false }}
      >
        <div
          style={{
            position: 'absolute',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: totalW,
            height: totalH,
          }}
        >
          {/* SVG edges layer */}
          <svg
            style={{ position: 'absolute', inset: 0, width: totalW, height: totalH, overflow: 'visible', pointerEvents: 'none' }}
          >
            <defs>
              <marker id="erd-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="rgb(var(--color-border-strong, 100 100 100))" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeOpacity={0.4}
                className="text-border-strong"
                markerEnd="url(#erd-arrow)"
              />
            ))}
          </svg>

          {/* Table nodes */}
          {nodes.map((node) => (
            <div
              key={node.name}
              data-node="true"
              style={{ position: 'absolute', left: node.x, top: node.y, width: node.width }}
              className="rounded border border-border bg-card shadow-sm overflow-hidden"
            >
              <div
                className="flex items-center gap-1.5 px-2.5 border-b border-border bg-surface-raised cursor-pointer hover:bg-surface-overlay transition-colors"
                style={{ height: HEADER_H }}
                onClick={() => { openTable(node.name); onNavigate('sql-editor') }}
              >
                {node.type === 'view'
                  ? <Eye className="h-3 w-3 text-violet-400 flex-shrink-0" />
                  : <Table2 className="h-3 w-3 text-blue-400 flex-shrink-0" />}
                <span className="text-[11px] font-semibold truncate">{node.name}</span>
              </div>
              {node.columns.map((col) => (
                <div
                  key={col.name}
                  className="flex items-center gap-1.5 px-2.5 border-b border-border/20 last:border-0"
                  style={{ height: COL_H }}
                >
                  {col.primaryKey && (
                    <span className="text-[9px] font-bold text-amber-400 flex-shrink-0 leading-none">PK</span>
                  )}
                  <span className="text-[10px] truncate flex-1">{col.name}</span>
                  <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 truncate max-w-[60px]">{col.dataType}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

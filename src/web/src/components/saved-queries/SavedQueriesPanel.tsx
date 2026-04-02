import { useState } from 'react'
import { useI18n } from '@/i18n'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sharingApi } from '@/api/sharing'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { FileCode2, Folder, FolderOpen, GripVertical, Pencil, Trash2, FolderInput, FolderPlus, Search, Copy, Share2 } from 'lucide-react'
import { savedQueriesApi, type SavedQuery } from '@/api/saved-queries'
import { useEditorStore } from '@/stores/editor.store'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { ComboboxChips } from '@/components/ui/combobox-chips'

// ── Inline rename input ─────────────────────────
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() ? onCommit(value.trim()) : onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) onCommit(value.trim())
        if (e.key === 'Escape') onCancel()
        e.stopPropagation()
      }}
      className="h-6 text-xs px-1.5 py-0"
      onClick={(e) => e.stopPropagation()}
    />
  )
}

// ── Single sortable query item ──────────────────
function QueryItem({
  query,
  folders,
  onLoad,
  onRename,
  onDuplicate,
  onShare,
  onDelete,
  onMoveToFolder,
  onRequestNewFolder,
}: {
  query: SavedQuery
  folders: string[]
  onLoad: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onShare: () => void
  onDelete: () => void
  onMoveToFolder: (folder: string | null) => void
  onRequestNewFolder: () => void
}) {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: query.id })
  const [renaming, setRenaming] = useState(false)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="group flex items-center gap-1.5 px-1 py-1 rounded-md text-[12px] text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
            onClick={() => !renaming && onLoad()}
          >
            <span
              {...attributes}
              {...listeners}
              className="opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-grab active:cursor-grabbing text-text-muted flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-3 w-3" />
            </span>

            <FileCode2 className="h-3 w-3 flex-shrink-0 text-primary/60" />

            {renaming ? (
              <RenameInput
                initial={query.name}
                onCommit={(name) => { onRename(name); setRenaming(false) }}
                onCancel={() => setRenaming(false)}
              />
            ) : (<>
              <span className="truncate flex-1">{query.name}</span>
              {query.shared && <Share2 className="h-2.5 w-2.5 flex-shrink-0 text-text-muted/40" />}
            </>)}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-44">
          <ContextMenuItem className="gap-2 text-xs" onClick={onLoad}>
            <FileCode2 className="h-3.5 w-3.5" />
            {t('sq.open')}
          </ContextMenuItem>
          <ContextMenuItem className="gap-2 text-xs" onClick={() => setRenaming(true)}>
            <Pencil className="h-3.5 w-3.5" />
            {t('sq.rename')}
          </ContextMenuItem>

          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2 text-xs">
              <FolderInput className="h-3.5 w-3.5" />
              {t('sq.moveTo')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-40">
              {query.folder && (
                <>
                  <ContextMenuItem className="gap-2 text-xs" onClick={() => onMoveToFolder(null)}>
                    <FileCode2 className="h-3.5 w-3.5" />
                    {t('sq.removeFromFolder')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
              {folders.filter((f) => f !== query.folder).map((f) => (
                <ContextMenuItem key={f} className="gap-2 text-xs" onClick={() => onMoveToFolder(f)}>
                  <Folder className="h-3.5 w-3.5" />
                  {f}
                </ContextMenuItem>
              ))}
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={onRequestNewFolder}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('sq.newFolder')}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuItem className="gap-2 text-xs" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
            {t('sq.duplicate')}
          </ContextMenuItem>
          {!query.shared && (<>
            <ContextMenuSeparator />
            <ContextMenuItem className="gap-2 text-xs" onClick={onShare}>
              <Share2 className="h-3.5 w-3.5" />
              {t('sq.share')}
            </ContextMenuItem>
          </>)}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="gap-2 text-xs text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('sq.delete')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

// ── Main panel ──────────────────────────────────
export function SavedQueriesPanel() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { openQuery, activeConnectionId } = useEditorStore()
  const { isMobile, setOpenMobile } = useSidebar()
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  const [search, setSearch] = useState('')

  // New folder dialog state — managed here so it survives re-renders
  const [newFolderTarget, setNewFolderTarget] = useState<string | null>(null) // query id
  const [shareQueryId, setShareQueryId] = useState<string | null>(null)
  const [shareIds, setShareIds] = useState<string[]>([])

  // Load groups + users for sharing (available to all authenticated users)
  const { data: groupsData } = useQuery({ queryKey: ['sharing', 'groups'], queryFn: sharingApi.groups, staleTime: 60_000 })
  const { data: usersData } = useQuery({ queryKey: ['sharing', 'users'], queryFn: sharingApi.users, staleTime: 60_000 })
  const shareGroups = groupsData?.groups ?? []
  const shareUsers = usersData?.users ?? []

  // Load current shares when opening share dialog
  const { data: querySharesData } = useQuery({
    queryKey: ['query-shares', shareQueryId],
    queryFn: () => savedQueriesApi.getShares(shareQueryId!),
    enabled: !!shareQueryId,
  })
  const [sharesSynced, setSharesSynced] = useState<string | null>(null)
  if (querySharesData && shareQueryId && sharesSynced !== shareQueryId) {
    setShareIds([
      ...(querySharesData.groups ?? []).map((g) => `g:${g.id}`),
      ...(querySharesData.users ?? []).map((u) => `u:${u.id}`),
    ])
    setSharesSynced(shareQueryId)
  }
  const [newFolderName, setNewFolderName] = useState('')

  const { data } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: savedQueriesApi.list,
  })

  const ownQueries = (data?.savedQueries ?? []).filter(
    (q) => q.connectionId === activeConnectionId && !q.shared,
  )
  const sharedQueries = (data?.savedQueries ?? []).filter(
    (q) => q.connectionId === activeConnectionId && q.shared,
  )

  const lc = search.toLowerCase()
  const filterFn = (q: SavedQuery) =>
    q.name.toLowerCase().includes(lc) ||
    q.sql.toLowerCase().includes(lc) ||
    q.folder?.toLowerCase().includes(lc)
  const queries = lc ? ownQueries.filter(filterFn) : ownQueries
  const filteredShared = (lc ? sharedQueries.filter(filterFn) : sharedQueries)
    .sort((a, b) => a.name.localeCompare(b.name))

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof savedQueriesApi.update>[1] }) =>
      savedQueriesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-queries'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => savedQueriesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-queries'] }),
  })

  const reorderMutation = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) => savedQueriesApi.reorder(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-queries'] }),
  })

  const folders = Array.from(new Set(queries.map((q) => q.folder).filter(Boolean) as string[]))
  const ungrouped = queries.filter((q) => !q.folder)
  const byFolder = folders.reduce<Record<string, SavedQuery[]>>((acc, f) => {
    acc[f] = queries.filter((q) => q.folder === f)
    return acc
  }, {})

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const fromIdx = queries.findIndex((q) => q.id === active.id)
    const toIdx = queries.findIndex((q) => q.id === over.id)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...queries]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved!)
    const items = reordered.map((q, i) => ({ id: q.id, sortOrder: i }))

    // Optimistic update — preserve queries from other connections in cache
    qc.setQueryData<{ savedQueries: SavedQuery[] }>(['saved-queries'], (old) => {
      if (!old) return old
      const sortMap = new Map(items.map(({ id, sortOrder }) => [id, sortOrder]))
      const others = old.savedQueries.filter((q) => !sortMap.has(q.id))
      const updated = reordered.map((q, i) => ({ ...q, sortOrder: i }))
      return { savedQueries: [...others, ...updated] }
    })

    reorderMutation.mutate(items)
  }

  const handleNewFolderConfirm = () => {
    const name = newFolderName.trim()
    if (!name || !newFolderTarget) return
    updateMutation.mutate({ id: newFolderTarget, data: { folder: name } })
    setNewFolderTarget(null)
    setNewFolderName('')
  }

  const toggleFolder = (f: string) =>
    setCollapsedFolders((s) => {
      const n = new Set(s)
      n.has(f) ? n.delete(f) : n.add(f)
      return n
    })

  if (ownQueries.length === 0 && sharedQueries.length === 0) {
    return (
      <p className="group-data-[collapsible=icon]:hidden px-2 py-2 text-xs text-text-muted">
        {t('sq.none')}
      </p>
    )
  }

  const renderItem = (q: SavedQuery) => (
    <QueryItem
      key={q.id}
      query={q}
      folders={folders}
      onLoad={() => { openQuery(q.sql, q.name, q.id); if (isMobile) setOpenMobile(false) }}
      onRename={(name) => updateMutation.mutate({ id: q.id, data: { name } })}
      onDuplicate={() => {
        const payload: Parameters<typeof savedQueriesApi.create>[0] = {
          name: `${q.name} (copie)`,
          sql: q.sql,
        }
        if (q.connectionId) payload.connectionId = q.connectionId
        if (q.description) payload.description = q.description
        if (q.folder) payload.folder = q.folder
        savedQueriesApi.create(payload).then(() => qc.invalidateQueries({ queryKey: ['saved-queries'] }))
      }}
      onShare={() => setShareQueryId(q.id)}
      onDelete={() => deleteMutation.mutate(q.id)}
      onMoveToFolder={(folder) =>
        updateMutation.mutate({ id: q.id, data: { folder: folder ?? null } })
      }
      onRequestNewFolder={() => { setNewFolderTarget(q.id); setNewFolderName('') }}
    />
  )

  return (
    <>
      {/* New folder dialog — rendered at panel level for stability */}
      <Dialog
        open={newFolderTarget !== null}
        onOpenChange={(o) => { if (!o) { setNewFolderTarget(null); setNewFolderName('') } }}
      >
        <DialogContent className="sm:max-w-xs bg-card border-border-subtle">
          <DialogHeader>
            <DialogTitle className="text-base">{t('sq.newFolderTitle')}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); handleNewFolderConfirm() }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label className="text-xs">{t('sq.folderName')}</Label>
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Ex: Analytics"
                className="h-8 text-sm"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setNewFolderTarget(null); setNewFolderName('') }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={!newFolderName.trim()}>
                {t('sq.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Search input */}
      <div className="group-data-[collapsible=icon]:hidden flex items-center gap-1 px-2 pb-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sq.search')}
            className="h-6 pl-6 pr-2 text-xs"
          />
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={queries.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          <div className="group-data-[collapsible=icon]:hidden flex-1 overflow-y-auto px-1 pb-2 space-y-0.5">
            {queries.length === 0 && filteredShared.length === 0 && (
              <p className="px-2 py-2 text-xs text-text-muted">{t('sq.none')}</p>
            )}
            {ungrouped.map(renderItem)}

            {folders.map((f) => {
              const isOpen = !collapsedFolders.has(f)
              return (
                <div key={f}>
                  <button
                    onClick={() => toggleFolder(f)}
                    className="w-full flex items-center gap-1.5 px-1 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide text-text-muted hover:text-muted-foreground hover:bg-sidebar-accent transition-colors"
                  >
                    {isOpen
                      ? <FolderOpen className="h-3 w-3 flex-shrink-0" />
                      : <Folder className="h-3 w-3 flex-shrink-0" />
                    }
                    <span className="truncate">{f}</span>
                    <span className="ml-auto text-[10px] opacity-50">{byFolder[f]?.length}</span>
                  </button>
                  {isOpen && (
                    <div className="ml-2 pl-2 border-l border-sidebar-border space-y-0.5">
                      {(byFolder[f] ?? []).map(renderItem)}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Shared queries — inside the scrollable area, after own queries */}
            {filteredShared.length > 0 && (
              <div className="pt-1 space-y-0.5">
                <div className="flex items-center gap-1.5 px-1 pt-1 pb-1">
                  <Share2 className="h-3 w-3 text-text-muted/40" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">{t('sq.shared')}</span>
                  <span className="text-[10px] text-text-muted/50 tabular-nums">{filteredShared.length}</span>
                </div>
                <TooltipProvider delayDuration={400}>
                  {filteredShared.map((q) => (
                    <Tooltip key={q.id}>
                      <TooltipTrigger asChild>
                        <div
                          className="group flex items-center gap-1.5 px-1 py-1 rounded-md text-[12px] text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
                          onClick={() => { openQuery(q.sql, q.name); if (isMobile) setOpenMobile(false) }}
                        >
                          <FileCode2 className="h-3 w-3 flex-shrink-0 text-primary/60" />
                          <span className="truncate flex-1">{q.name}</span>
                          <Share2 className="h-2.5 w-2.5 flex-shrink-0 text-text-muted/40" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="text-xs">{q.createdByName ?? '?'}</p>
                        <p className="text-[10px] text-text-muted">{new Date(q.createdAt).toLocaleString()}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TooltipProvider>
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* Share query dialog */}
      <Dialog open={shareQueryId !== null} onOpenChange={(o) => { if (!o) { setShareQueryId(null); setSharesSynced(null) } }}>
        <DialogContent className="sm:max-w-sm bg-card border-border-subtle">
          <DialogHeader><DialogTitle className="text-base">{t('sq.shareTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <ComboboxChips
              options={[
                ...shareGroups.map((g) => ({ id: `g:${g.id}`, label: g.name, color: g.color ?? undefined })),
                ...shareUsers.map((u) => ({ id: `u:${u.id}`, label: `${u.name} (${u.email})`, minQuery: 3 })),
              ]}
              selected={shareIds}
              onChange={setShareIds}
              placeholder={t('admin.addMembers')}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setShareQueryId(null); setSharesSynced(null) }}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={() => {
              if (!shareQueryId) return
              const groupIds = shareIds.filter((id) => id.startsWith('g:')).map((id) => id.slice(2))
              const userIds = shareIds.filter((id) => id.startsWith('u:')).map((id) => id.slice(2))
              savedQueriesApi.setShares(shareQueryId, groupIds, userIds).then(() => {
                qc.invalidateQueries({ queryKey: ['saved-queries'] })
                qc.invalidateQueries({ queryKey: ['query-shares'] })
                setShareQueryId(null)
                setSharesSynced(null)
              })
            }}>{t('sheet.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

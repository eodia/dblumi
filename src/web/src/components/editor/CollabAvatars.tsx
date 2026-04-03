import { useState, useEffect } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

type Participant = {
  clientId: number
  userId: string
  name: string
  avatarUrl: string | null
  color: string
}

const MAX_VISIBLE = 5

export function CollabAvatars({
  awareness,
  currentUserId,
  editorView,
  unreadCount,
  onToggleChat,
}: {
  awareness: Awareness | null
  currentUserId: string
  editorView: any | null
  unreadCount: number
  onToggleChat: () => void
}) {
  const { t } = useI18n()
  const [participants, setParticipants] = useState<Participant[]>([])

  useEffect(() => {
    if (!awareness) return

    const update = () => {
      const states = awareness.getStates()
      const list: Participant[] = []
      states.forEach((state, clientId) => {
        const user = state.user as Participant | undefined
        if (user && user.userId !== currentUserId) {
          list.push({ ...user, clientId })
        }
      })
      setParticipants(list)
    }

    update()
    awareness.on('change', update)
    return () => { awareness.off('change', update) }
  }, [awareness, currentUserId])

  const scrollToCursor = (clientId: number) => {
    if (!awareness || !editorView) return
    const state = awareness.getStates().get(clientId)
    const cursor = state?.cursor
    if (cursor?.anchor != null) {
      editorView.dispatch({
        selection: { anchor: cursor.anchor, head: cursor.head ?? cursor.anchor },
        scrollIntoView: true,
      })
      editorView.focus()
    }
  }

  const visible = participants.slice(0, MAX_VISIBLE)
  const overflow = participants.length - MAX_VISIBLE

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center -space-x-2">
        {visible.map((p) => (
          <Tooltip key={p.clientId}>
            <TooltipTrigger asChild>
              <div
                className="relative flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold cursor-pointer"
                onClick={() => scrollToCursor(p.clientId)}
                style={{
                  border: `2px solid ${p.color}`,
                  backgroundColor: p.avatarUrl ? 'transparent' : p.color + '25',
                  color: p.color,
                }}
              >
                {p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt={p.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  getInitials(p.name)
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{p.name}</p>
              <p className="text-[10px] text-muted-foreground">{t('chat.scrollToUser')}</p>
            </TooltipContent>
          </Tooltip>
        ))}
        {overflow > 0 && (
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground border-2 border-border">
            +{overflow}
          </div>
        )}
        {/* Chat button */}
        <div className="ml-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleChat}
                className="relative flex items-center justify-center w-6 h-6 rounded-full bg-muted hover:bg-accent transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center px-0.5">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('chat.title')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

function getInitials(name: string): string {
  const parts = name.split(/[\s@]+/)
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

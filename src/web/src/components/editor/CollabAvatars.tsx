import { useState, useEffect } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'

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
}: {
  awareness: Awareness | null
  currentUserId: string
}) {
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

  if (participants.length === 0) return null

  const visible = participants.slice(0, MAX_VISIBLE)
  const overflow = participants.length - MAX_VISIBLE

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center -space-x-2">
        {visible.map((p) => (
          <Tooltip key={p.clientId}>
            <TooltipTrigger asChild>
              <div
                className="relative flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold cursor-default"
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
            </TooltipContent>
          </Tooltip>
        ))}
        {overflow > 0 && (
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground border-2 border-border">
            +{overflow}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

function getInitials(name: string): string {
  const parts = name.split(/[\s@]+/)
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

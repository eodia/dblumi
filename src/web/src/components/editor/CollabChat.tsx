import { useState, useRef, useEffect, useCallback } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { X, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth.store'
import { collabMessagesApi, type ChatMessage } from '@/api/collab-messages'
import { getActiveCollabInstance } from '@/collab/collab-provider'
import { cn } from '@/lib/utils'

type Props = {
  queryId: string
  queryName: string
  onClose: () => void
}

export function CollabChat({ queryId, queryName, onClose }: Props) {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const [input, setInput] = useState('')
  const [realtimeMessages, setRealtimeMessages] = useState<ChatMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Re-check instance periodically since it may not be ready at first render
  const [collabInstance, setCollabInstance] = useState(() => getActiveCollabInstance())
  useEffect(() => {
    const inst = getActiveCollabInstance()
    if (inst) { setCollabInstance(inst); return }
    // Poll until instance is available
    const id = setInterval(() => {
      const inst = getActiveCollabInstance()
      if (inst) { setCollabInstance(inst); clearInterval(id) }
    }, 200)
    return () => clearInterval(id)
  }, [queryId])

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['collab-messages', queryId],
    queryFn: ({ pageParam }) => collabMessagesApi.list(queryId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.messages.length === 0) return undefined
      return lastPage.messages[0]!.createdAt
    },
    enabled: true,
  })

  const historyMessages = data?.pages.flatMap((p) => p.messages) ?? []
  const allMessages = [...historyMessages, ...realtimeMessages]

  const seen = new Set<string>()
  const messages = allMessages.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  useEffect(() => {
    if (!collabInstance) return
    const unsub = collabInstance.onChatMessage((msg: ChatMessage) => {
      setRealtimeMessages((prev) => [...prev, msg])
    })
    return unsub
  }, [collabInstance])

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, autoScroll])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setAutoScroll(atBottom)
    if (el.scrollTop < 100 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const sendMessage = () => {
    const content = input.trim()
    const inst = collabInstance ?? getActiveCollabInstance()
    if (!content || !inst) return
    inst.sendChatMessage(content)
    setInput('')
    setAutoScroll(true)
  }

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  const getInitials = (name: string) => {
    const parts = name.split(/[\s@]+/)
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div>
          <h3 className="text-sm font-semibold">{t('chat.title')}</h3>
          <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{queryName}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3"
      >
        {isFetchingNextPage && (
          <p className="text-xs text-muted-foreground text-center py-2">...</p>
        )}
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">{t('chat.noMessages')}</p>
        )}
        {messages.map((msg) => {
          const isOwn = msg.userId === user?.id
          return (
            <div key={msg.id} className={cn('flex gap-2', isOwn && 'flex-row-reverse')}>
              {!isOwn && (
                <div
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
                  style={{ backgroundColor: '#52525B25', color: '#A1A1AA' }}
                >
                  {msg.avatarUrl ? (
                    <img src={msg.avatarUrl} alt={msg.userName} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    getInitials(msg.userName)
                  )}
                </div>
              )}
              <div className={cn('max-w-[75%]', isOwn && 'text-right')}>
                {!isOwn && (
                  <p className="text-[10px] text-muted-foreground mb-0.5">{msg.userName}</p>
                )}
                <div className={cn(
                  'inline-block px-2.5 py-1.5 rounded-lg text-xs',
                  isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                )}>
                  {msg.content}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{formatTime(msg.createdAt)}</p>
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-3 py-2 border-t border-border-subtle">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={t('chat.placeholder')}
            className="flex-1 min-h-[32px] max-h-[80px] px-2 py-1.5 text-xs bg-background border border-border-subtle rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            rows={1}
          />
          <Button
            size="sm"
            className="h-8 w-8 p-0 flex-shrink-0"
            onClick={sendMessage}
            disabled={!input.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

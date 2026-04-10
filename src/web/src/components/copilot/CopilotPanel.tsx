import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { Bot, Send, Copy, Play, Loader2, X, Sparkles, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editor.store'
import { useCopilotStore, setCopilotMessages, clearCopilotConversation, clearPendingExplain } from '@/stores/copilot.store'
import { streamCopilot, type CopilotContext } from '@/api/copilot'
import type { CopilotMessage } from '@/stores/copilot.store'
import { SqlHighlight } from './SqlHighlight'
import { useI18n, type TranslationKey } from '@/i18n'

const emptyMessages: CopilotMessage[] = []

// ── Markdown inline: **bold**, *italic*, `code` ──
function parseInline(text: string): React.ReactNode[] {
  const segments = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g)
  return segments.map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
      return <strong key={i} className="font-semibold">{seg.slice(2, -2)}</strong>
    if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2)
      return <em key={i}>{seg.slice(1, -1)}</em>
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2)
      return <code key={i} className="px-1 py-0.5 rounded bg-surface-overlay text-xs font-mono text-primary">{seg.slice(1, -1)}</code>
    return seg || null
  })
}

// ── Markdown block renderer ──
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushList = () => {
    if (!listItems.length) return
    result.push(
      listType === 'ul'
        ? <ul key={result.length} className="list-disc list-inside space-y-0.5 my-1 ml-1">{listItems.map((item, i) => <li key={i}>{parseInline(item)}</li>)}</ul>
        : <ol key={result.length} className="list-decimal list-inside space-y-0.5 my-1 ml-1">{listItems.map((item, i) => <li key={i}>{parseInline(item)}</li>)}</ol>
    )
    listItems = []
    listType = null
  }

  for (const line of lines) {
    const ul = line.match(/^[-*+]\s+(.+)/)
    const ol = line.match(/^\d+\.\s+(.+)/)
    if (ul) {
      if (listType === 'ol') flushList()
      listType = 'ul'; listItems.push(ul[1]!)
      continue
    }
    if (ol) {
      if (listType === 'ul') flushList()
      listType = 'ol'; listItems.push(ol[1]!)
      continue
    }
    flushList()
    const h3 = line.match(/^###\s+(.+)/)
    const h2 = line.match(/^##\s+(.+)/)
    const h1 = line.match(/^#\s+(.+)/)
    if (h3) result.push(<h3 key={result.length} className="text-[13px] font-semibold mt-2 mb-0.5">{parseInline(h3[1]!)}</h3>)
    else if (h2) result.push(<h2 key={result.length} className="text-sm font-semibold mt-2 mb-0.5">{parseInline(h2[1]!)}</h2>)
    else if (h1) result.push(<h1 key={result.length} className="text-sm font-bold mt-2 mb-1">{parseInline(h1[1]!)}</h1>)
    else if (line.trim()) result.push(<p key={result.length}>{parseInline(line)}</p>)
  }
  flushList()
  return <>{result}</>
}

// ── Full message renderer with SQL syntax highlighting ──
function MessageContent({ content, onInsertSql, t }: { content: string; onInsertSql: (sql: string) => void; t: (key: TranslationKey, replacements?: Record<string, string | number>) => string }) {
  const parts = content.split(/(```sql[\s\S]*?```|```[\s\S]*?```)/g)

  return (
    <div className="text-[13px] leading-relaxed space-y-2">
      {parts.map((part, i) => {
        const sqlMatch = part.match(/^```sql\n?([\s\S]*?)```$/)
        if (sqlMatch) {
          const sql = sqlMatch[1]?.trim() ?? ''
          return (
            <div key={i} className="relative group/sql rounded-md border border-border-subtle bg-background overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-surface">
                <span className="text-[10px] font-mono text-text-muted uppercase tracking-wide">sql</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] gap-1" title={t('copilot.copySql')}
                    onClick={() => navigator.clipboard.writeText(sql)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] gap-1 text-primary" title={t('copilot.insertToEditor')}
                    onClick={() => onInsertSql(sql)}>
                    <Play className="h-3 w-3" />
                    {t('copilot.insert')}
                  </Button>
                </div>
              </div>
              <pre className="px-3 py-2 overflow-x-auto whitespace-pre-wrap">
                <SqlHighlight code={sql} />
              </pre>
            </div>
          )
        }

        const codeMatch = part.match(/^```\w*\n?([\s\S]*?)```$/)
        if (codeMatch) {
          return (
            <pre key={i} className="px-3 py-2 text-xs font-mono rounded-md border border-border-subtle bg-background overflow-x-auto whitespace-pre-wrap">
              {codeMatch[1]?.trim()}
            </pre>
          )
        }

        return part.trim() ? <div key={i}>{renderMarkdown(part)}</div> : null
      })}
    </div>
  )
}

export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { activeConnectionId, setSql, tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const { data: copilotInfo } = useQuery({
    queryKey: ['copilot-info'],
    queryFn: settingsApi.getCopilotInfo,
    staleTime: Infinity,
  })

  const connId = activeConnectionId ?? ''
  const messages = useCopilotStore((s) => s.conversations[connId] ?? emptyMessages)
  const pendingExplain = useCopilotStore((s) => s.pendingExplain)

  const setMessages = useCallback(
    (msgs: CopilotMessage[] | ((prev: CopilotMessage[]) => CopilotMessage[])) => {
      if (!activeConnectionId) return
      const prev = useCopilotStore.getState().conversations[activeConnectionId] ?? emptyMessages
      const next = typeof msgs === 'function' ? msgs(prev) : msgs
      setCopilotMessages(activeConnectionId, next)
    },
    [activeConnectionId],
  )

  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleInsertSql = useCallback((sql: string) => {
    const current = activeTab?.sql ?? ''
    setSql(current ? `${current}\n\n${sql}` : sql)
  }, [activeTab, setSql])

  const buildContext = useCallback((): CopilotContext | undefined => {
    if (!activeTab) return undefined
    return { tabKind: activeTab.kind, tabName: activeTab.name, sql: activeTab.sql }
  }, [activeTab])

  const streamResponse = useCallback(async (messagesToSend: CopilotMessage[]) => {
    if (!activeConnectionId) return
    setIsStreaming(true)
    setMessages([...messagesToSend, { role: 'assistant', content: '' }])

    try {
      let fullText = ''
      for await (const chunk of streamCopilot(activeConnectionId, messagesToSend, buildContext())) {
        if (chunk.type === 'text') {
          fullText += chunk.text
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: fullText }
            return updated
          })
        } else if (chunk.type === 'error') {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: `**Error:** ${chunk.message}` }
            return updated
          })
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: `**Error:** ${t('copilot.errorContact')}` }
        return updated
      })
    } finally {
      setIsStreaming(false)
    }
  }, [activeConnectionId, buildContext, setMessages, t])

  useEffect(() => {
    if (!pendingExplain || isStreaming || !activeConnectionId) return
    clearPendingExplain()
    const msgs = useCopilotStore.getState().conversations[activeConnectionId] ?? []
    streamResponse(msgs)
  }, [pendingExplain, isStreaming, activeConnectionId, streamResponse])

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !activeConnectionId || isStreaming) return
    const userMsg: CopilotMessage = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setInput('')
    await streamResponse(newMessages)
  }, [input, activeConnectionId, isStreaming, messages, streamResponse])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming || messages.length < 2) return
    // Remove last assistant message, keep everything up to the last user message
    const withoutLastAssistant = messages.slice(0, -1)
    await streamResponse(withoutLastAssistant)
  }, [isStreaming, messages, streamResponse])

  if (!activeConnectionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted p-4">
        <Bot className="h-8 w-8 opacity-20" />
        <span className="text-xs text-center">{t('copilot.selectConnection')}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 h-8 px-3 border-b border-border-subtle bg-surface flex-shrink-0">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">{t('copilot.title')}</span>
        <span className="text-[10px] text-text-muted">
          {copilotInfo?.provider === 'openai'
            ? t('copilot.subtitleOpenai')
            : copilotInfo?.provider === 'azure-openai'
            ? t('copilot.subtitleAzure')
            : t('copilot.subtitle')}
          {copilotInfo?.model && (
            <span className="ml-1 opacity-60">· {copilotInfo.model}</span>
          )}
        </span>
        <div className="flex-1" />
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" title={t('copilot.clear')}
            onClick={() => activeConnectionId && clearCopilotConversation(activeConnectionId)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <Bot className="h-10 w-10 opacity-15" />
            <p className="text-xs text-center max-w-[200px]">
              {t('copilot.emptyHint')}
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {[
                t('copilot.suggestion1'),
                t('copilot.suggestion2'),
                t('copilot.suggestion3'),
                t('copilot.suggestion4'),
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="px-2.5 py-1 rounded-full border border-border-subtle text-[11px] text-text-muted hover:text-foreground hover:border-primary/30 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 mt-0.5">
                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-3 w-3 text-primary" />
                </div>
              </div>
            )}
            <div className={cn(
              'max-w-[85%] rounded-lg px-3 py-2',
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground text-[13px]'
                : 'bg-surface-raised border border-border-subtle',
            )}>
              {msg.role === 'assistant' ? (
                <>
                  <MessageContent content={msg.content} onInsertSql={handleInsertSql} t={t} />
                  {isStreaming && i === messages.length - 1 && (
                    <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse rounded-sm ml-0.5" />
                  )}
                  {!isStreaming && i === messages.length - 1 && messages.length >= 2 && (
                    <button
                      onClick={handleRegenerate}
                      className="flex items-center gap-1 mt-1.5 text-[11px] text-text-muted hover:text-foreground transition-colors"
                      title={t('copilot.regenerate')}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t('copilot.regenerate')}
                    </button>
                  )}
                </>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border-subtle p-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder={t('copilot.placeholder')}
            rows={1}
            className="flex-1 resize-none rounded-md border border-border-subtle bg-surface-overlay px-3 py-2 text-sm placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px] max-h-[120px]"
            style={{ height: 'auto', overflow: 'hidden' }}
            onInput={(e) => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`
            }}
          />
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
            className="h-9 w-9 p-0 flex-shrink-0"
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

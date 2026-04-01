import { readSSE } from './client'

export type CopilotMessage = { role: 'user' | 'assistant'; content: string }

export type CopilotContext = {
  tabKind: 'query' | 'table' | 'function'
  tabName: string
  sql: string
}

export async function* streamCopilot(
  connectionId: string,
  messages: CopilotMessage[],
  context?: CopilotContext,
): AsyncGenerator<{ type: 'text'; text: string } | { type: 'done' } | { type: 'error'; message: string }> {
  for await (const { event, data } of readSSE('/copilot', { connectionId, messages, context })) {
    if (event === '__http') {
      const resp = data as { status: number; body: Record<string, unknown> }
      yield { type: 'error', message: (resp.body['message'] ?? 'Erreur') as string }
      return
    }
    if (event === 'text') {
      yield { type: 'text', text: (data as { text: string }).text }
    } else if (event === 'done') {
      yield { type: 'done' }
    } else if (event === 'error') {
      yield { type: 'error', message: (data as { message: string }).message }
    }
  }
}

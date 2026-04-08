import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CopilotMessage = { role: 'user' | 'assistant'; content: string }

type CopilotState = {
  conversations: Record<string, CopilotMessage[]>
  pendingExplain: string | null
}

export const useCopilotStore = create<CopilotState>()(
  persist(
    () => ({
      conversations: {} as Record<string, CopilotMessage[]>,
      pendingExplain: null as string | null,
    }),
    {
      name: 'dblumi-copilot',
      version: 1,
      partialize: (state) => ({ conversations: state.conversations }),
    },
  ),
)

export function setCopilotMessages(connectionId: string, messages: CopilotMessage[]) {
  useCopilotStore.setState((s) => ({
    conversations: { ...s.conversations, [connectionId]: messages },
  }))
}

export function clearCopilotConversation(connectionId: string) {
  useCopilotStore.setState((s) => {
    const { [connectionId]: _, ...rest } = s.conversations
    return { conversations: rest }
  })
}

export function explainError(connectionId: string, message: string) {
  useCopilotStore.setState((s) => {
    const prev = s.conversations[connectionId] ?? []
    return {
      conversations: { ...s.conversations, [connectionId]: [...prev, { role: 'user' as const, content: message }] },
      pendingExplain: message,
    }
  })
}

export function clearPendingExplain() {
  useCopilotStore.setState({ pendingExplain: null })
}

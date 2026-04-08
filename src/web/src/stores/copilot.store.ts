import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CopilotMessage = { role: 'user' | 'assistant'; content: string }

type CopilotState = {
  conversations: Record<string, CopilotMessage[]>
}

export const useCopilotStore = create<CopilotState>()(
  persist(
    () => ({
      conversations: {} as Record<string, CopilotMessage[]>,
    }),
    {
      name: 'dblumi-copilot',
      version: 1,
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

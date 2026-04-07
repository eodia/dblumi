import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CopilotMessage = { role: 'user' | 'assistant'; content: string }

type CopilotState = {
  /** conversations keyed by connectionId */
  conversations: Record<string, CopilotMessage[]>
  getMessages: (connectionId: string) => CopilotMessage[]
  setMessages: (connectionId: string, messages: CopilotMessage[]) => void
  clearConversation: (connectionId: string) => void
}

export const useCopilotStore = create<CopilotState>()(
  persist(
    (set, get) => ({
      conversations: {},

      getMessages: (connectionId) =>
        get().conversations[connectionId] ?? [],

      setMessages: (connectionId, messages) =>
        set((s) => ({
          conversations: { ...s.conversations, [connectionId]: messages },
        })),

      clearConversation: (connectionId) =>
        set((s) => {
          const { [connectionId]: _, ...rest } = s.conversations
          return { conversations: rest }
        }),
    }),
    {
      name: 'dblumi-copilot',
      version: 1,
    },
  ),
)

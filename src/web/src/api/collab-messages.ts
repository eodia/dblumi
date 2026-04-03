import { api } from './client'

export type ChatMessage = {
  id: string
  userId: string
  userName: string
  avatarUrl: string | null
  content: string
  createdAt: string
}

export const collabMessagesApi = {
  list: (queryId: string, before?: string, limit = 50) =>
    api.get<{ messages: ChatMessage[]; hasMore: boolean }>(
      `/saved-queries/${queryId}/messages?limit=${limit}${before ? `&before=${before}` : ''}`,
    ),
}

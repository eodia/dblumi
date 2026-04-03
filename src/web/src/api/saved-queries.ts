import { api } from './client'

export type SavedQuery = {
  id: string
  name: string
  sql: string
  description?: string
  connectionId?: string
  folder?: string
  sortOrder?: number
  shared?: boolean
  collaborative?: boolean
  isCollaborator?: boolean
  createdBy: string
  createdByName?: string
  createdAt: string
  updatedAt: string
}

export const savedQueriesApi = {
  list: () => api.get<{ savedQueries: SavedQuery[] }>('/saved-queries'),
  create: (data: { name: string; sql: string; description?: string; connectionId?: string; folder?: string }) =>
    api.post<{ savedQuery: SavedQuery }>('/saved-queries', data),
  update: (id: string, data: Partial<{ name: string; sql: string; description: string; folder: string; sortOrder: number }>) =>
    api.put<{ savedQuery: SavedQuery }>(`/saved-queries/${id}`, data),
  delete: (id: string) => api.del<void>(`/saved-queries/${id}`),
  reorder: (items: { id: string; sortOrder: number }[]) =>
    api.patch<void>('/saved-queries/reorder', { items }),
  getShares: (id: string) =>
    api.get<{
      groups: Array<{ id: string; name: string; color: string | null; collaborative: boolean }>
      users: Array<{ id: string; name: string; email: string; collaborative: boolean }>
    }>(`/saved-queries/${id}/shares`),
  setShares: (id: string, groupIds: string[], userIds: string[], collabGroupIds: string[], collabUserIds: string[]) =>
    api.put<{ groupIds: string[]; userIds: string[]; collabGroupIds: string[]; collabUserIds: string[] }>(
      `/saved-queries/${id}/shares`, { groupIds, userIds, collabGroupIds, collabUserIds },
    ),
}

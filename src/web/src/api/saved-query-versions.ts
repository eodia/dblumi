import { api } from './client'
import type { VersionsResponse } from '@dblumi/shared'

export type SavedQueryVersion = {
  id: string
  queryId: string
  sql: string
  label: string | null
  editedBy: { id: string; name: string }
  createdAt: string
}

export const savedQueryVersionsApi = {
  list: (queryId: string, cursor?: string, limit = 50) =>
    api.get<VersionsResponse>(
      `/saved-queries/${queryId}/versions?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    ),

  updateLabel: (queryId: string, versionId: string, label: string | null) =>
    api.patch<void>(`/saved-queries/${queryId}/versions/${versionId}`, { label }),
}

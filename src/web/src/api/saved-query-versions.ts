import { api } from './client'
import type { VersionsResponse, SavedQueryVersion } from '@dblumi/shared'

export type { SavedQueryVersion }

export const savedQueryVersionsApi = {
  list: (queryId: string, cursor?: string, limit = 50) =>
    api.get<VersionsResponse>(
      `/saved-queries/${queryId}/versions?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    ),

  updateLabel: (queryId: string, versionId: string, label: string | null) =>
    api.patch<void>(`/saved-queries/${queryId}/versions/${versionId}`, { label }),
}

import { api } from './client'

export const sharingApi = {
  groups: () => api.get<{ groups: Array<{ id: string; name: string; color: string | null }> }>('/sharing/groups'),
  users: () => api.get<{ users: Array<{ id: string; name: string; email: string }> }>('/sharing/users'),
}

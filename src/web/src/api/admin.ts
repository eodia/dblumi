import { api } from './client'

export type AdminUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  avatarUrl: string | null
  language: string | null
  createdAt: string
  updatedAt: string
}

export const adminApi = {
  listUsers: () => api.get<{ users: AdminUser[] }>('/admin/users'),
  updateUser: (id: string, data: { name?: string; role?: string; email?: string }) =>
    api.patch<{ user: AdminUser }>(`/admin/users/${id}`, data),
  deleteUser: (id: string) => api.del<void>(`/admin/users/${id}`),
}

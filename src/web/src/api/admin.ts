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

export type Group = {
  id: string
  name: string
  description: string | null
  color: string | null
  memberCount: number
  createdAt: string
  updatedAt: string
}

export type GroupMember = {
  id: string
  email: string
  name: string
  role: string
}

export const adminApi = {
  // Users
  listUsers: () => api.get<{ users: AdminUser[] }>('/admin/users'),
  updateUser: (id: string, data: { name?: string; role?: string; email?: string }) =>
    api.patch<{ user: AdminUser }>(`/admin/users/${id}`, data),
  deleteUser: (id: string) => api.del<void>(`/admin/users/${id}`),

  // Groups
  listGroups: () => api.get<{ groups: Group[] }>('/admin/groups'),
  createGroup: (data: { name: string; description?: string; color?: string }) =>
    api.post<{ group: Group }>('/admin/groups', data),
  updateGroup: (id: string, data: { name?: string; description?: string; color?: string }) =>
    api.patch<{ group: Group }>(`/admin/groups/${id}`, data),
  deleteGroup: (id: string) => api.del<void>(`/admin/groups/${id}`),
  listGroupMembers: (id: string) => api.get<{ members: GroupMember[] }>(`/admin/groups/${id}/members`),
  addGroupMembers: (id: string, userIds: string[]) =>
    api.post<void>(`/admin/groups/${id}/members`, { userIds }),
  removeGroupMember: (id: string, userId: string) =>
    api.del<void>(`/admin/groups/${id}/members/${userId}`),

  // User groups
  getUserGroups: (userId: string) =>
    api.get<{ groups: Array<{ id: string; name: string; color: string | null }> }>(`/admin/users/${userId}/groups`),
  setUserGroups: (userId: string, groupIds: string[]) =>
    api.put<{ groupIds: string[] }>(`/admin/users/${userId}/groups`, { groupIds }),
}

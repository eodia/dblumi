import { api } from './client'

export type User = {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  avatarUrl: string | null
  createdAt: string
}

type AuthResponse = { user: User; token: string }

export const authApi = {
  register: (data: { email: string; password: string; name: string }) =>
    api.post<AuthResponse>('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', data),
  logout: () => api.post<void>('/auth/logout'),
  me: () => api.get<{ user: User }>('/auth/me'),
}

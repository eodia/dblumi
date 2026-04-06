import { api } from './client'

export type User = {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  avatarUrl: string | null
  language: string
  createdAt: string
  hasPassword: boolean
}

type AuthResponse = { user: User; token: string }

export const authApi = {
  register: (data: { email: string; password: string; name: string; language?: string }) =>
    api.post<AuthResponse>('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', data),
  logout: () => api.post<void>('/auth/logout'),
  me: () => api.get<{ user: User }>('/auth/me'),
  updateLanguage: (language: string) => api.patch<{ language: string }>('/auth/language', { language }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<{ success: boolean }>('/auth/password', { currentPassword, newPassword }),
  forgotPassword: (email: string) =>
    api.post<{ success: boolean }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    api.post<{ success: boolean }>('/auth/reset-password', { token, newPassword }),
}

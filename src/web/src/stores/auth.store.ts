import { create } from 'zustand'
import { authApi, type User } from '../api/auth'

type AuthState = {
  user: User | null
  hydrated: boolean
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string, language?: string) => Promise<void>
  logout: () => Promise<void>
  setLanguage: (language: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const { user } = await authApi.me()
      set({ user, hydrated: true })
    } catch {
      set({ user: null, hydrated: true })
    }
  },

  login: async (email, password) => {
    const { user } = await authApi.login({ email, password })
    set({ user })
  },

  register: async (name, email, password, language) => {
    const payload: Parameters<typeof authApi.register>[0] = { name, email, password }
    if (language) payload.language = language
    const { user } = await authApi.register(payload)
    set({ user })
  },

  logout: async () => {
    await authApi.logout()
    set({ user: null })
  },

  setLanguage: async (language) => {
    await authApi.updateLanguage(language)
    const { user } = get()
    if (user) set({ user: { ...user, language } })
  },
}))

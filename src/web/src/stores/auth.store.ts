import { create } from 'zustand'
import { authApi, type User } from '../api/auth'

type AuthState = {
  user: User | null
  hydrated: boolean
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
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

  register: async (name, email, password) => {
    const { user } = await authApi.register({ name, email, password })
    set({ user })
  },

  logout: async () => {
    await authApi.logout()
    set({ user: null })
  },
}))

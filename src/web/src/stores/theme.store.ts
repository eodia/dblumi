import { create } from 'zustand'

export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

type ThemeState = {
  preference: ThemePreference
  theme: ResolvedTheme
  setTheme: (preference: ThemePreference) => void
}

export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference
}

export function applyTheme(theme: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', theme)
}

function getInitialPreference(): ThemePreference {
  const stored = localStorage.getItem('dblumi-theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'dark'
}

const initialPreference = getInitialPreference()
const initialResolved = resolve(initialPreference)
applyTheme(initialResolved)

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initialPreference,
  theme: initialResolved,
  setTheme: (preference) => {
    localStorage.setItem('dblumi-theme', preference)
    const theme = resolve(preference)
    applyTheme(theme)
    set({ preference, theme })
  },
}))

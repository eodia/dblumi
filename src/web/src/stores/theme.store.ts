import { create } from 'zustand'

type ThemePreference = 'dark' | 'light' | 'system'
type ResolvedTheme = 'dark' | 'light'

type ThemeState = {
  preference: ThemePreference
  theme: ResolvedTheme
  setTheme: (preference: ThemePreference) => void
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference
}

function apply(theme: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

function getInitialPreference(): ThemePreference {
  const stored = localStorage.getItem('dblumi-theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'dark'
}

const initialPreference = getInitialPreference()
const initialResolved = resolve(initialPreference)
apply(initialResolved)

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initialPreference,
  theme: initialResolved,
  setTheme: (preference) => {
    localStorage.setItem('dblumi-theme', preference)
    const theme = resolve(preference)
    apply(theme)
    set({ preference, theme })
  },
}))

// Listen for OS theme changes when preference is "system"
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  const { preference } = useThemeStore.getState()
  if (preference === 'system') {
    const theme = getSystemTheme()
    apply(theme)
    useThemeStore.setState({ theme })
  }
})

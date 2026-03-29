import { useEffect, useState, useMemo, useCallback } from 'react'
import { Toaster } from 'sonner'
import { useAuthStore } from './stores/auth.store'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { AppShell } from './components/layout/AppShell'
import { I18nContext, createTranslator, detectLocale, type Locale } from './i18n'

type AuthView = 'login' | 'register'

export function App() {
  const { user, hydrated, hydrate } = useAuthStore()
  const [view, setView] = useState<AuthView>('login')

  // Locale: from user preference, or browser default
  const [locale, setLocaleState] = useState<Locale>(detectLocale())

  // Sync locale when user logs in
  useEffect(() => {
    if (user?.language) {
      setLocaleState(user.language === 'en' ? 'en' : 'fr')
    }
  }, [user?.language])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    // If logged in, persist to backend
    if (user) useAuthStore.getState().setLanguage(l)
  }, [user])

  const t = useMemo(() => createTranslator(locale), [locale])
  const i18nValue = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  useEffect(() => {
    hydrate()
  }, [hydrate])

  // ── Splash screen ──────────────────────
  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight">
            db<span className="text-primary glow-primary">lumi</span>
          </h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            {t('common.init')}
          </div>
        </div>
      </div>
    )
  }

  // ── Auth flow ──────────────────────────
  if (!user) {
    return (
      <I18nContext.Provider value={i18nValue}>
        {view === 'login' ? (
          <LoginPage onSwitchToRegister={() => setView('register')} />
        ) : (
          <RegisterPage onSwitchToLogin={() => setView('login')} />
        )}
      </I18nContext.Provider>
    )
  }

  // ── Main app ───────────────────────────
  return (
    <I18nContext.Provider value={i18nValue}>
      <AppShell />
      <Toaster theme="dark" position="bottom-right" richColors />
    </I18nContext.Provider>
  )
}

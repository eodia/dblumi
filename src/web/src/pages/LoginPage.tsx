import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/api/client'
import { useI18n } from '@/i18n'
import { settingsApi } from '@/api/settings'
import { authApi } from '@/api/auth'
import { PasswordStrengthIndicator } from '@/components/ui/password-strength'
import logoSvg from '@/assets/logo-dblumi.svg'

type AuthView = 'login' | 'forgot' | 'reset'

type Props = { onSwitchToRegister: () => void }

export function LoginPage({ onSwitchToRegister }: Props) {
  const login = useAuthStore((s) => s.login)
  const { t } = useI18n()
  const { data: authProviders } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: settingsApi.getAuthProviders,
    staleTime: Infinity,
  })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [authView, setAuthView] = useState<AuthView>(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'reset-password' && params.get('token')) return 'reset'
    return 'login'
  })

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  // Reset password state
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    try {
      await authApi.forgotPassword(forgotEmail)
    } catch {
      // Silently succeed (anti-enumeration)
    }
    setForgotSent(true)
    setForgotLoading(false)
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError('')
    if (resetPassword !== resetConfirm) {
      setResetError(t('auth.changePassword.errorMismatch'))
      return
    }
    setResetLoading(true)
    try {
      await authApi.resetPassword(resetToken, resetPassword)
      setResetSuccess(true)
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : t('auth.reset.expired'))
    } finally {
      setResetLoading(false)
    }
  }

  const backToLogin = () => {
    setAuthView('login')
    setForgotSent(false)
    setForgotEmail('')
    setResetError('')
    setResetSuccess(false)
    window.history.replaceState({}, '', window.location.pathname)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.login.error'))
    } finally {
      setLoading(false)
    }
  }

  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w: number, h: number
    let animId: number
    const COUNT = 120
    const SPEED = 0.15

    function resize() {
      w = canvas!.width = window.innerWidth
      h = canvas!.height = window.innerHeight
    }

    resize()
    const stars = Array.from({ length: COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random() * 0.6 + 0.2,
      dx: (Math.random() - 0.5) * SPEED,
      dy: (Math.random() - 0.5) * SPEED,
      phase: Math.random() * Math.PI * 2,
      twinkle: Math.random() * 0.015 + 0.005,
    }))

    function draw() {
      ctx!.clearRect(0, 0, w, h)
      for (const s of stars) {
        s.x += s.dx
        s.y += s.dy
        if (s.x < 0) s.x = w
        if (s.x > w) s.x = 0
        if (s.y < 0) s.y = h
        if (s.y > h) s.y = 0
        s.phase += s.twinkle
        const alpha = s.a * (0.6 + 0.4 * Math.sin(s.phase))
        ctx!.beginPath()
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(255,255,255,${alpha})`
        ctx!.fill()
      }
      animId = requestAnimationFrame(draw)
    }

    window.addEventListener('resize', resize)
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animId)
    }
  }, [])

  // ── Forgot password view ──
  if (authView === 'forgot') {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-background overflow-hidden">
        <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />
        <div
          className="absolute pointer-events-none"
          style={{
            left: '-50%', bottom: '-80vh', width: '200%', height: '100vh',
            borderRadius: '50%', borderTop: '1px solid rgba(65,205,42,0.15)',
            background: 'hsl(var(--background))',
            boxShadow: '0 -60px 120px 20px rgba(65,205,42,0.15), 0 -20px 60px rgba(65,205,42,0.1)',
          }}
        />
        <div className="relative w-full max-w-[380px] mx-4">
          <div className="mb-10 text-center">
            <img src={logoSvg} alt="dblumi" className="h-10 mx-auto" />
            <p className="mt-2 text-sm text-muted-foreground">{t('auth.forgot.title')}</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-2xl shadow-black/40">
            {forgotSent ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('auth.forgot.success')}</p>
                <Button variant="outline" className="w-full" onClick={backToLogin}>
                  {t('auth.forgot.back')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">{t('auth.forgot.email')}</Label>
                  <Input id="forgot-email" type="email" placeholder="dev@company.com" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required autoFocus autoComplete="email" />
                </div>
                <Button type="submit" disabled={forgotLoading} className="w-full">
                  {forgotLoading ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg> : t('auth.forgot.submit')}
                </Button>
              </form>
            )}
          </div>
          <p className="mt-6 text-center text-xs text-text-muted">
            <button onClick={backToLogin} className="text-primary hover:text-dblumi-hover transition-colors font-medium">{t('auth.forgot.back')}</button>
          </p>
        </div>
      </div>
    )
  }

  // ── Reset password view ──
  if (authView === 'reset') {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-background overflow-hidden">
        <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />
        <div
          className="absolute pointer-events-none"
          style={{
            left: '-50%', bottom: '-80vh', width: '200%', height: '100vh',
            borderRadius: '50%', borderTop: '1px solid rgba(65,205,42,0.15)',
            background: 'hsl(var(--background))',
            boxShadow: '0 -60px 120px 20px rgba(65,205,42,0.15), 0 -20px 60px rgba(65,205,42,0.1)',
          }}
        />
        <div className="relative w-full max-w-[380px] mx-4">
          <div className="mb-10 text-center">
            <img src={logoSvg} alt="dblumi" className="h-10 mx-auto" />
            <p className="mt-2 text-sm text-muted-foreground">{t('auth.reset.title')}</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-2xl shadow-black/40">
            {resetSuccess ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('auth.reset.success')}</p>
                <Button className="w-full" onClick={backToLogin}>
                  {t('auth.forgot.back')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-password">{t('auth.reset.password')}</Label>
                  <Input id="reset-password" type="password" placeholder={t('auth.changePassword.passwordHint')} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} required minLength={8} autoFocus autoComplete="new-password" />
                  <PasswordStrengthIndicator password={resetPassword} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-confirm">{t('auth.reset.confirm')}</Label>
                  <Input id="reset-confirm" type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
                </div>
                {resetError && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{resetError}</div>}
                <Button type="submit" disabled={resetLoading} className="w-full">
                  {resetLoading ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg> : t('auth.reset.submit')}
                </Button>
              </form>
            )}
          </div>
          {!resetSuccess && (
            <p className="mt-6 text-center text-xs text-text-muted">
              <button onClick={() => setAuthView('forgot')} className="text-primary hover:text-dblumi-hover transition-colors font-medium">{t('auth.reset.tryAgain')}</button>
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-background overflow-hidden">
      <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />
      {/* Planet arc with aurora glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: '-50%',
          bottom: '-80vh',
          width: '200%',
          height: '100vh',
          borderRadius: '50%',
          borderTop: '1px solid rgba(65,205,42,0.15)',
          background: 'hsl(var(--background))',
          boxShadow: '0 -60px 120px 20px rgba(65,205,42,0.15), 0 -20px 60px rgba(65,205,42,0.1)',
        }}
      />
      <div className="relative w-full max-w-[380px] mx-4">
        <div className="mb-10 text-center">
          <img src={logoSvg} alt="dblumi" className="h-10 mx-auto" />
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.login.title')}</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-2xl shadow-black/40">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.login.email')}</Label>
              <Input id="email" type="email" placeholder="dev@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.login.password')}</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            {authProviders?.smtpConfigured && (
              <div className="text-right">
                <button type="button" onClick={() => setAuthView('forgot')} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                  {t('auth.forgot.link')}
                </button>
              </div>
            )}
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg> : t('auth.login.submit')}
            </Button>
            {authProviders?.keycloak && (
              <a
                href="/api/v1/auth/keycloak"
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-raised transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.5c4.142 0 7.5 3.358 7.5 7.5s-3.358 7.5-7.5 7.5S4.5 16.142 4.5 12 7.858 4.5 12 4.5zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"/>
                </svg>
                {t('auth.keycloak')}
              </a>
            )}
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-text-muted">
          {t('auth.login.noAccount')}{' '}
          <button onClick={onSwitchToRegister} className="text-primary hover:text-dblumi-hover transition-colors font-medium">{t('auth.login.createAccount')}</button>
        </p>
      </div>
    </div>
  )
}

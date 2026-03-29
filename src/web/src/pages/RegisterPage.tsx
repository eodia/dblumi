import { useState } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/api/client'

type Props = { onSwitchToLogin: () => void }

export function RegisterPage({ onSwitchToLogin }: Props) {
  const register = useAuthStore((s) => s.register)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(name, email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de creer le compte.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-dblumi/[0.03] blur-[120px]" />
      </div>

      <div className="relative w-full max-w-[380px] mx-4">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">
            db<span className="text-primary glow-primary">lumi</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Creez votre compte administrateur
          </p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-2xl shadow-black/40">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nom</Label>
              <Input
                id="name"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-email">Email</Label>
              <Input
                id="reg-email"
                type="email"
                placeholder="dev@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-password">Mot de passe</Label>
              <Input
                id="reg-password"
                type="password"
                placeholder="8 caracteres minimum"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                </svg>
              ) : (
                'Creer mon compte'
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          Deja un compte ?{' '}
          <button
            onClick={onSwitchToLogin}
            className="text-primary hover:text-dblumi-hover transition-colors font-medium"
          >
            Se connecter
          </button>
        </p>
      </div>
    </div>
  )
}

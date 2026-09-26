import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthProvider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardBody } from '../components/ui/Card'

export function LoginPage() {
  const { session, loading: sessionLoading } = useAuth()
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!sessionLoading && session) return <Navigate to="/" replace />

  function switchMode(next: 'signin' | 'forgot') {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) setError('Invalid email or password.')
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    // The link comes back to main.tsx, which signs them in and opens Set password.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    })
    setSubmitting(false)
    if (error) {
      setError(
        error.status === 429 || /rate limit/i.test(error.message)
          ? 'Too many emails have been sent in the last hour. Try again later, or ask your admin to set a new password for you in Settings → Users.'
          : error.message,
      )
      return
    }
    setNotice(
      'If that email has an account, a reset link is on its way. Open the newest email only; the link works once.',
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-text">HashirHub</h1>
          <p className="mt-1 text-sm text-text-muted">
            {mode === 'signin' ? 'Sign in to your business account' : 'Reset your password'}
          </p>
        </div>
        <Card>
          <CardBody>
            {mode === 'signin' ? (
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  endAdornment={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((s) => !s)}
                      className="text-text-muted hover:text-text"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                {error && <p className="text-sm text-danger-600">{error}</p>}
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm font-medium text-accent-600 hover:text-accent-700"
                >
                  Forgot password?
                </button>
              </form>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={handleForgot}>
                <p className="text-sm text-text-muted">
                  Enter your email and we'll send a link to choose a new password.
                </p>
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {error && <p className="text-sm text-danger-600">{error}</p>}
                {notice && <p className="text-sm text-success-600">{notice}</p>}
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? 'Sending…' : 'Send reset link'}
                </Button>
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="text-sm font-medium text-accent-600 hover:text-accent-700"
                >
                  Back to sign in
                </button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

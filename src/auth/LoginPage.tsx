import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthProvider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardBody } from '../components/ui/Card'

export function LoginPage() {
  const { session, loading: sessionLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!sessionLoading && session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) setError('Invalid email or password.')
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-text">Inventory</h1>
          <p className="mt-1 text-sm text-text-muted">Sign in to your business account</p>
        </div>
        <Card>
          <CardBody>
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
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <p className="text-sm text-danger-600">{error}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

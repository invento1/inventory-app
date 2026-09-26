import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthProvider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardBody } from '../components/ui/Card'
import { PageSpinner } from '../components/ui/Spinner'

export function SetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <PageSpinner />

  if (!session) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-surface-muted px-4 text-center">
        <div className="max-w-sm">
          <p className="text-sm text-text-muted">
            You're not signed in, so there's no account to set a password for. The link may have expired or already
            been used.
          </p>
          <Link to="/login" className="mt-3 inline-block text-sm font-medium text-accent-600 hover:text-accent-700">
            Go to sign in (use Forgot password? for a new link)
          </Link>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-text">Welcome</h1>
          <p className="mt-1 text-sm text-text-muted">Choose a password for</p>
          {/* A browser holds one sign-in at a time, and an email link replaces
              whoever was signed in. Show whose password this sets. */}
          <p className="mt-0.5 break-all text-sm font-semibold text-text">{session.user.email}</p>
        </div>
        <Card>
          <CardBody>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {error && <p className="text-sm text-danger-600">{error}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Saving…' : 'Set password & continue'}
              </Button>
            </form>
          </CardBody>
        </Card>
        <p className="mt-4 text-center text-xs text-text-muted">
          Not you?{' '}
          <button
            type="button"
            onClick={() => supabase.auth.signOut().then(() => navigate('/login', { replace: true }))}
            className="font-medium text-accent-600 hover:text-accent-700"
          >
            Sign out
          </button>
        </p>
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
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
        <p className="text-sm text-text-muted">
          This link has expired or is invalid. Ask the app owner to resend your invite.
        </p>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
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
          <p className="mt-1 text-sm text-text-muted">Set a password to finish creating your account</p>
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
      </div>
    </div>
  )
}

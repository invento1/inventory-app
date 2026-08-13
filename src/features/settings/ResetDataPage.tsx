import { useState, type FormEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { RESET_DATA_CATEGORIES, useResetOrgData } from './api'

export function ResetDataPage() {
  const { orgId, role } = useOrg()
  const { user } = useAuth()
  const toast = useToast()
  const resetData = useResetOrgData(orgId)

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  if (role !== 'owner') {
    return (
      <div>
        <PageHeader title="Reset data" />
        <Card>
          <CardBody className="py-10 text-center text-sm text-text-muted">
            Only the org owner can reset data.
          </CardBody>
        </Card>
      </div>
    )
  }

  const allKeys = RESET_DATA_CATEGORIES.flatMap((g) => g.categories.map((c) => c.key))
  const selectedKeys = allKeys.filter((k) => selected[k])
  const allSelected = selectedKeys.length === allKeys.length

  function toggle(key: string) {
    setSelected((current) => ({ ...current, [key]: !current[key] }))
  }

  function toggleAll() {
    if (allSelected) {
      setSelected({})
    } else {
      setSelected(Object.fromEntries(allKeys.map((k) => [k, true])))
    }
  }

  const canSubmit = selectedKeys.length > 0 && password.length > 0 && confirmText === 'RESET'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (selectedKeys.length === 0) {
      setError('Select at least one category to reset.')
      return
    }
    if (confirmText !== 'RESET') {
      setError('Type RESET exactly to confirm.')
      return
    }
    if (!user?.email) {
      setError('Could not determine your account email.')
      return
    }

    setVerifying(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    })
    setVerifying(false)
    if (authError) {
      setError('Incorrect password.')
      return
    }

    try {
      await resetData.mutateAsync(selectedKeys)
      toast.success('Data reset complete')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader title="Reset data" subtitle="Permanently delete selected data for this organization" />

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger-600/30 bg-danger-50 p-4">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger-600" />
        <div className="text-sm text-danger-700">
          <p className="font-semibold">This cannot be undone.</p>
          <p className="mt-1">
            Deleted data is gone permanently — there is no backup or recovery. Double-check what you've
            selected below before confirming.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="What to reset"
            action={
              <Button type="button" variant="secondary" size="sm" onClick={toggleAll}>
                {allSelected ? 'Deselect all' : 'Select all (full reset)'}
              </Button>
            }
          />
          <CardBody className="flex flex-col gap-6">
            {RESET_DATA_CATEGORIES.map((group) => (
              <div key={group.group}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {group.group}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {group.categories.map((cat) => (
                    <label
                      key={cat.key}
                      className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm hover:bg-surface-muted"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={!!selected[cat.key]}
                        onChange={() => toggle(cat.key)}
                      />
                      <span>
                        <span className="block font-medium text-text">{cat.label}</span>
                        <span className="block text-xs text-text-muted">{cat.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Confirm" />
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              {selectedKeys.length === 0
                ? 'Select at least one category above.'
                : `You're about to permanently delete: ${selectedKeys
                    .map((k) => allKeys.includes(k) && RESET_DATA_CATEGORIES.flatMap((g) => g.categories).find((c) => c.key === k)?.label)
                    .filter(Boolean)
                    .join(', ')}.`}
            </p>
            <Input
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              label='Type "RESET" to confirm'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {error && <p className="text-sm text-danger-600">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" variant="danger" disabled={!canSubmit || verifying || resetData.isPending}>
                {verifying ? 'Verifying…' : resetData.isPending ? 'Resetting…' : 'Permanently reset selected data'}
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  )
}

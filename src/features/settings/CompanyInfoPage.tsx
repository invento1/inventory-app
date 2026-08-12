import { useEffect, useState, type FormEvent } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { useOrgDetails, useUpdateOrgDetails, type OrgDetailsInput } from './api'

export function CompanyInfoPage() {
  const { orgId, role } = useOrg()
  const toast = useToast()
  const { data: org, isLoading } = useOrgDetails(orgId)
  const updateOrg = useUpdateOrgDetails(orgId)
  const canEdit = role !== 'staff'

  const [form, setForm] = useState<OrgDetailsInput | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (org) {
      setForm({
        name: org.name,
        address: org.address,
        phone: org.phone,
        email: org.email,
        currency_symbol: org.currency_symbol,
        currency_code: org.currency_code,
      })
    }
  }, [org])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    try {
      await updateOrg.mutateAsync(form)
      toast.success('Company info saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (isLoading || !form) return <PageSpinner />

  return (
    <div>
      <PageHeader
        title="Company Info"
        subtitle="Shown on printed documents and used for currency formatting"
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Input
              label="Company name"
              required
              disabled={!canEdit}
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">Address</span>
              <textarea
                rows={3}
                disabled={!canEdit}
                className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500 disabled:bg-surface-muted disabled:text-text-muted"
                value={form.address ?? ''}
                onChange={(e) => setForm({ ...form, address: e.target.value || null })}
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Phone"
                disabled={!canEdit}
                value={form.phone ?? ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value || null })}
              />
              <Input
                label="Email"
                type="email"
                disabled={!canEdit}
                value={form.email ?? ''}
                onChange={(e) => setForm({ ...form, email: e.target.value || null })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Currency symbol"
                required
                disabled={!canEdit}
                placeholder="$"
                value={form.currency_symbol ?? ''}
                onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })}
              />
              <Input
                label="Currency code"
                required
                disabled={!canEdit}
                placeholder="USD"
                value={form.currency_code ?? ''}
                onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
              />
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" disabled={updateOrg.isPending}>
              {updateOrg.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}

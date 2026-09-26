import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { fieldBase } from '../../components/ui/fieldStyles'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { Select } from '../../components/ui/Select'
import { localTimeZone } from '../../lib/dates'
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
        timezone: org.timezone,
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

  const timeZones = useTimeZoneOptions(form?.timezone ?? null)
  const deviceZone = localTimeZone()

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
                className={`px-3 py-2 ${fieldBase}`}
                value={form.address ?? ''}
                onChange={(e) => setForm({ ...form, address: e.target.value || null })}
              />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div>
              <Select
                label="Timezone"
                disabled={!canEdit}
                value={form.timezone ?? ''}
                onChange={(e) => setForm({ ...form, timezone: e.target.value || null })}
              >
                <option value="">Not set (UTC)</option>
                {timeZones.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs text-text-muted">
                Invoices, receipts, bills, and reports are dated in this timezone, so something created just after
                midnight gets today's date, not yesterday's.
              </p>
              {!form.timezone && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning-600/20 bg-warning-50 px-3 py-2 text-xs text-warning-600">
                  <span>Not set yet, so documents are dated in UTC.</span>
                  {canEdit && deviceZone !== 'UTC' && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, timezone: deviceZone })}
                      className="font-semibold underline underline-offset-2 hover:no-underline"
                    >
                      Use this device's timezone ({deviceZone})
                    </button>
                  )}
                </div>
              )}
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

// Every IANA timezone the browser knows, labelled with its current UTC offset
// ("Europe/London (GMT+1)"). The saved value stays listed even if this
// browser happens not to know it.
function useTimeZoneOptions(current: string | null) {
  return useMemo(() => {
    let zones: string[] = []
    try {
      zones = Intl.supportedValuesOf('timeZone')
    } catch {
      zones = ['UTC']
    }
    if (current && !zones.includes(current)) zones = [current, ...zones]
    return zones.map((zone) => {
      let offset = ''
      try {
        offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
          .formatToParts(new Date())
          .find((p) => p.type === 'timeZoneName')?.value ?? ''
      } catch {
        offset = ''
      }
      return { value: zone, label: offset ? `${zone.replace(/_/g, ' ')} (${offset})` : zone.replace(/_/g, ' ') }
    })
  }, [current])
}

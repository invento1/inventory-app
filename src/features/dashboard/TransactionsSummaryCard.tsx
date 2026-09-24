import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/currency'
import { todayYmd, ymd } from '../../lib/dates'
import { useUserPreference } from '../../lib/userPreferences'
import { useDailyActivity } from './api'

// Every transaction type the summary can show (daily_activity_summary
// returns all of them). `parts` marks a derived row summed client-side.
const SUMMARY_TYPES = [
  { key: 'all_sales', label: 'All sales', hint: 'Invoices + sales receipts', to: '/transactions', parts: ['invoices', 'sales_receipts'] },
  { key: 'invoices', label: 'Invoices', to: '/invoices' },
  { key: 'sales_receipts', label: 'Sales receipts', to: '/sales' },
  { key: 'quotations', label: 'Quotations', to: '/quotations' },
  { key: 'credit_memos', label: 'Credit memos', to: '/credit-memos' },
  { key: 'refunds', label: 'Refunds', to: '/refunds' },
  { key: 'customer_payments', label: 'Customer payments', to: '/account/view-payments' },
  { key: 'deposits', label: 'Bank deposits', to: '/account/view-deposits' },
  { key: 'purchase_orders', label: 'Purchase orders', to: '/purchase-orders' },
  { key: 'supplier_bills', label: 'Supplier bills', to: '/supplier-bills' },
  { key: 'supplier_payments', label: 'Supplier payments', to: '/account/view-paid-bills' },
  { key: 'expenses', label: 'Expenses', to: '/expenses' },
  { key: 'inventory_adjustments', label: 'Inventory adjustments', hint: 'Net value change', to: '/inventory-adjustments' },
  { key: 'fund_transfers', label: 'Fund transfers', to: '/account/banking' },
] as const satisfies readonly { key: string; label: string; to: string; hint?: string; parts?: readonly string[] }[]

type SummaryType = (typeof SUMMARY_TYPES)[number]
const TYPE_BY_KEY = new Map<string, SummaryType>(SUMMARY_TYPES.map((t) => [t.key, t]))

const DEFAULT_ROWS = [
  'invoices',
  'sales_receipts',
  'credit_memos',
  'refunds',
  'customer_payments',
  'supplier_bills',
  'supplier_payments',
  'expenses',
]

const PREFERENCE_KEY = 'dashboard.transactions_summary'
interface SummaryPreference {
  rows: string[]
}

// Drop unknown/duplicate keys (e.g. a type removed in a later version); an
// empty or missing layout falls back to the default.
function sanitizeRows(rows: unknown): string[] {
  if (!Array.isArray(rows)) return DEFAULT_ROWS
  const clean = [...new Set(rows.filter((k): k is string => typeof k === 'string' && TYPE_BY_KEY.has(k)))]
  return clean.length ? clean : DEFAULT_ROWS
}

// 7-day Transactions Summary: the user's chosen rows (saved per user in
// user_preferences), one column per local day, today last and highlighted,
// plus a 7-day total. "Edit table" adds, removes, reorders, or resets rows.
export function TransactionsSummaryCard() {
  const { orgId, currencySymbol } = useOrg()
  const toast = useToast()
  const preference = useUserPreference<SummaryPreference>(PREFERENCE_KEY)
  const rows = sanitizeRows(preference.value?.rows)
  const [editing, setEditing] = useState(false)

  // Recomputed when the local date changes (e.g. the tab stays open past midnight).
  const today = todayYmd()
  const days = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number)
    return Array.from({ length: 7 }, (_, i) => ymd(new Date(y, m - 1, d - 6 + i)))
  }, [today])
  const { data, isLoading } = useDailyActivity(orgId, days[0], days[6])

  const cell = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of data ?? []) map.set(`${r.metric}|${r.day}`, r.amount)
    const raw = (metric: string, day: string) => map.get(`${metric}|${day}`) ?? 0
    return (type: SummaryType, day: string) =>
      'parts' in type ? type.parts.reduce((sum, part) => sum + raw(part, day), 0) : raw(type.key, day)
  }, [data])

  const dayHead = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return `${new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'short' })} ${day}`
  }

  async function save(next: string[]) {
    // Saving exactly the default clears the stored preference, so the user
    // keeps getting the default if it's ever improved.
    const isDefault = next.length === DEFAULT_ROWS.length && next.every((k, i) => k === DEFAULT_ROWS[i])
    try {
      await preference.save(isDefault ? undefined : { rows: next })
      setEditing(false)
      toast.success('Summary layout saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the layout')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Transactions summary"
        subtitle="Last 7 days"
        action={
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <SlidersHorizontal size={14} />
            Edit table
          </Button>
        }
      />
      <CardBody className="p-0">
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Type</Th>
              {days.map((d, i) => (
                <Th key={d} className={cn('text-right whitespace-nowrap', i === 6 && 'bg-accent-50/70 text-accent-700')}>
                  {i === 6 ? 'Today' : dayHead(d)}
                </Th>
              ))}
              <Th className="text-right">7 days</Th>
            </THead>
            <tbody>
              {rows.map((key) => {
                const type = TYPE_BY_KEY.get(key)!
                const values = days.map((d) => cell(type, d))
                const total = values.reduce((a, b) => a + b, 0)
                return (
                  <Tr key={key}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link to={type.to} className="hover:text-accent-700">
                        {type.label}
                      </Link>
                    </Td>
                    {values.map((v, i) => (
                      <Td
                        key={days[i]}
                        className={cn(
                          'text-right tabular-nums whitespace-nowrap',
                          v === 0 && 'text-text-subtle',
                          v < 0 && 'text-danger-600',
                          i === 6 && 'bg-accent-50/40',
                        )}
                      >
                        {v === 0 ? '–' : formatMoney(v, currencySymbol)}
                      </Td>
                    ))}
                    <Td
                      className={cn(
                        'text-right font-semibold tabular-nums whitespace-nowrap',
                        total === 0 && 'font-normal text-text-subtle',
                        total < 0 && 'text-danger-600',
                      )}
                    >
                      {total === 0 ? '–' : formatMoney(total, currencySymbol)}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </CardBody>

      {editing && (
        <EditSummaryModal
          rows={rows}
          saving={preference.isSaving}
          onSave={save}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  )
}

function EditSummaryModal({
  rows,
  saving,
  onSave,
  onClose,
}: {
  rows: string[]
  saving: boolean
  onSave: (rows: string[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(rows)
  const available = SUMMARY_TYPES.filter((t) => !draft.includes(t.key))
  const isDefault = draft.length === DEFAULT_ROWS.length && draft.every((k, i) => k === DEFAULT_ROWS[i])

  const move = (index: number, by: -1 | 1) =>
    setDraft((current) => {
      const next = [...current]
      ;[next[index], next[index + by]] = [next[index + by], next[index]]
      return next
    })

  return (
    <Modal title="Edit transactions summary" onClose={onClose} width="max-w-md">
      <p className="mb-4 text-sm text-text-muted">
        Choose which transaction types appear, and in what order. Your layout is saved to your account.
      </p>

      <ol className="flex flex-col divide-y divide-divider rounded-lg border border-border">
        {draft.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-text-muted">No rows — add at least one below.</li>
        )}
        {draft.map((key, i) => {
          const type = TYPE_BY_KEY.get(key)!
          return (
            <li key={key} className="flex items-center gap-2 px-3 py-2">
              <span className="w-5 shrink-0 text-xs tabular-nums text-text-subtle">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text">{type.label}</span>
                {'hint' in type && <span className="block text-xs text-text-muted">{type.hint}</span>}
              </span>
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${type.label} up`}
                className="rounded-md p-1 text-text-subtle transition-colors hover:bg-surface-muted hover:text-text disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === draft.length - 1}
                aria-label={`Move ${type.label} down`}
                className="rounded-md p-1 text-text-subtle transition-colors hover:bg-surface-muted hover:text-text disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                onClick={() => setDraft((current) => current.filter((k) => k !== key))}
                aria-label={`Remove ${type.label}`}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-danger-50 hover:text-danger-600"
              >
                <X size={14} />
                Remove
              </button>
            </li>
          )
        })}
      </ol>

      <div className="mt-4">
        {available.length > 0 ? (
          <Select
            label="Add a transaction type"
            value=""
            onChange={(e) => {
              const key = e.target.value
              if (key) setDraft((current) => [...current, key])
            }}
          >
            <option value="">Choose a type to add…</option>
            {available.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
                {'hint' in t ? ` (${t.hint})` : ''}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-sm text-text-muted">Every transaction type is already shown.</p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(DEFAULT_ROWS)} disabled={isDefault}>
          <RotateCcw size={14} />
          Reset to default
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => onSave(draft)} disabled={draft.length === 0 || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

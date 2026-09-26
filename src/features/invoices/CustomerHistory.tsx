import { useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { cn } from '../../lib/cn'
import { formatDate } from '../reports/dates'
import { paymentMethodLabel } from '../reports/references'
import { useInvoiceHistory, useSetInvoiceHistoryOptions, type CustomerHistory, type HistoryOptions } from './api'

// The old HashirHub's "Balance Forward" and "Last 5 invoices / payments",
// as a per-invoice choice. Shared by New Invoice (picker + preview), the
// invoice page (change later) and the printed invoice.

export function HistoryOptionsPicker({
  value,
  onChange,
  history,
  loading,
  symbol,
  disabled,
}: {
  value: HistoryOptions
  onChange: (next: HistoryOptions) => void
  history: CustomerHistory | undefined
  loading?: boolean
  symbol: string
  disabled?: boolean
}) {
  const money = (v: number) => formatMoney(v, symbol)
  const options: { key: keyof HistoryOptions; label: string; detail: string }[] = [
    {
      key: 'previousBalance',
      label: 'Previous balance',
      detail: loading
        ? 'Checking…'
        : history
          ? history.previous_balance > 0.005
            ? `${money(history.previous_balance)} still owed on earlier invoices${
                history.open_invoice_count ? ` (${history.open_invoice_count} open)` : ''
              }. Adds "Previous balance" and "Total amount due" to the invoice.`
            : history.previous_balance < -0.005
              ? `${money(-history.previous_balance)} in the customer's favour (credit). Shown as a negative previous balance.`
              : 'Nothing owed on earlier invoices. Shows a previous balance of 0.'
          : '',
    },
    {
      key: 'recentInvoices',
      label: 'Recent invoices',
      detail: history ? `Their last ${history.invoices.length || 0} invoice(s), with what's still owed on each.` : '',
    },
    {
      key: 'recentPayments',
      label: 'Recent payments',
      detail: history ? `Their last ${history.payments.length || 0} payment(s).` : '',
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <label
          key={o.key}
          className={cn(
            'flex items-start gap-2.5 rounded-lg border border-border p-3 text-sm transition-colors',
            disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-muted/60',
            value[o.key] && 'border-accent-600/40 bg-accent-50/50',
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value[o.key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [o.key]: e.target.checked })}
          />
          <span>
            <span className="font-medium text-text">{o.label}</span>
            {o.detail && <span className="block text-xs text-text-muted">{o.detail}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

// Recent invoices / payments tables. `print` tightens them for the A4 page.
export function CustomerHistoryTables({
  history,
  options,
  symbol,
  print = false,
}: {
  history: CustomerHistory
  options: HistoryOptions
  symbol: string
  print?: boolean
}) {
  const money = (v: number) => formatMoney(v, symbol)
  if (!options.recentInvoices && !options.recentPayments) return null
  const both = options.recentInvoices && options.recentPayments
  const th = 'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted'
  const td = 'px-2 py-1.5 align-top'

  return (
    <div className={cn('grid gap-5', both ? 'grid-cols-1 sm:grid-cols-2 print:grid-cols-2' : 'grid-cols-1')}>
      {options.recentInvoices && (
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Recent invoices</p>
          <table className={cn('mt-1.5 w-full border-collapse', print ? 'text-[11px]' : 'text-xs')}>
            <thead>
              <tr className="border-y border-border bg-surface-muted/80">
                <th className={th}>Invoice</th>
                <th className={th}>Date</th>
                <th className={cn(th, 'text-right')}>Total</th>
                <th className={cn(th, 'text-right')}>Owed</th>
              </tr>
            </thead>
            <tbody>
              {history.invoices.length === 0 && (
                <tr>
                  <td colSpan={4} className={cn(td, 'text-center text-text-muted')}>
                    No earlier invoices
                  </td>
                </tr>
              )}
              {history.invoices.map((i) => (
                <tr key={i.invoice_number} className="border-b border-divider">
                  <td className={cn(td, 'whitespace-nowrap text-text')}>{i.invoice_number}</td>
                  <td className={cn(td, 'whitespace-nowrap text-text-muted')}>{formatDate(i.issue_date)}</td>
                  <td className={cn(td, 'text-right tabular-nums text-text')}>{money(i.total)}</td>
                  <td className={cn(td, 'text-right tabular-nums', i.balance > 0.005 ? 'text-danger-600' : 'text-text-muted')}>
                    {i.balance > 0.005 ? money(i.balance) : 'Paid'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {options.recentPayments && (
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Recent payments</p>
          <table className={cn('mt-1.5 w-full border-collapse', print ? 'text-[11px]' : 'text-xs')}>
            <thead>
              <tr className="border-y border-border bg-surface-muted/80">
                <th className={th}>Date</th>
                <th className={th}>For</th>
                <th className={th}>Method</th>
                <th className={cn(th, 'text-right')}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {history.payments.length === 0 && (
                <tr>
                  <td colSpan={4} className={cn(td, 'text-center text-text-muted')}>
                    No earlier payments
                  </td>
                </tr>
              )}
              {history.payments.map((p, idx) => (
                <tr key={`${p.created_at}-${idx}`} className="border-b border-divider">
                  <td className={cn(td, 'whitespace-nowrap text-text-muted')}>{formatDate(p.paid_at.slice(0, 10))}</td>
                  <td className={cn(td, 'whitespace-nowrap text-text')}>{p.invoice_number}</td>
                  <td className={cn(td, 'text-text-muted')}>
                    {paymentMethodLabel(p.payment_method)}
                    {p.reference_number ? ` · ${p.reference_number}` : ''}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums text-text')}>{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Invoice page: see or change what the printout shows. The figures are the
// customer's position when this invoice was created, so reprints stay the same.
export function InvoiceHistoryCard({
  invoiceId,
  options,
  canEdit,
}: {
  invoiceId: string
  options: HistoryOptions
  canEdit: boolean
}) {
  const { orgId, currencySymbol } = useOrg()
  const toast = useToast()
  const { data: history, isLoading } = useInvoiceHistory(orgId, invoiceId)
  const setOptions = useSetInvoiceHistoryOptions(orgId)
  const [draft, setDraft] = useState<HistoryOptions | null>(null)
  const current = draft ?? options
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(options)

  async function save() {
    try {
      await setOptions.mutateAsync({ invoiceId, options: current })
      setDraft(null)
      toast.success('Printout updated')
    } catch (err) {
      toast.error((err as { message?: string } | null)?.message ?? 'Something went wrong')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Customer history on the printout"
        subtitle={
          history
            ? `As it stood when this invoice was created (${new Date(history.as_of).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })})`
            : undefined
        }
        action={
          canEdit && dirty ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDraft(null)} disabled={setOptions.isPending}>
                Undo
              </Button>
              <Button size="sm" onClick={save} disabled={setOptions.isPending}>
                {setOptions.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-4">
        <HistoryOptionsPicker
          value={current}
          onChange={setDraft}
          history={history}
          loading={isLoading}
          symbol={currencySymbol}
          disabled={!canEdit}
        />
        {history && (current.recentInvoices || current.recentPayments) && (
          <CustomerHistoryTables history={history} options={current} symbol={currencySymbol} />
        )}
      </CardBody>
    </Card>
  )
}

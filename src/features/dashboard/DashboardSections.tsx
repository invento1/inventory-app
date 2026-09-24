import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/currency'
import { accountTypeLabel, useLedgerAccounts } from '../accounts/api'
import { groupLedger, useGeneralLedger } from '../reports/api'
import { formatDate, rangeForPreset, ymd } from '../reports/dates'
import { referenceLabel } from '../reports/references'
import { useDailyActivity, useRecentTransactions } from './api'

// ---------------------------------------------------------------------------
// 7-day Transactions Summary: one row per transaction type, one column per
// day (today last and highlighted), plus a 7-day total.

const ACTIVITY_ROWS = [
  { key: 'invoices', label: 'Invoices', to: '/invoices' },
  { key: 'sales_receipts', label: 'Sales receipts', to: '/sales' },
  { key: 'credit_memos', label: 'Credit memos', to: '/credit-memos' },
  { key: 'refunds', label: 'Refunds', to: '/refunds' },
  { key: 'customer_payments', label: 'Customer payments', to: '/account/view-payments' },
  { key: 'supplier_bills', label: 'Supplier bills', to: '/supplier-bills' },
  { key: 'supplier_payments', label: 'Supplier payments', to: '/account/view-paid-bills' },
  { key: 'expenses', label: 'Expenses', to: '/expenses' },
] as const

export function WeeklySummaryCard() {
  const { orgId, currencySymbol } = useOrg()
  const days = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 7 }, (_, i) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i)))
  }, [])
  const { data, isLoading } = useDailyActivity(orgId, days[0], days[6])

  const cell = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of data ?? []) map.set(`${r.metric}|${r.day}`, r.amount)
    return (metric: string, day: string) => map.get(`${metric}|${day}`) ?? 0
  }, [data])

  const dayHead = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    const date = new Date(y, m - 1, day)
    return { weekday: date.toLocaleDateString(undefined, { weekday: 'short' }), date: day }
  }

  return (
    <Card>
      <CardHeader title="Transactions summary" subtitle="Last 7 days" />
      <CardBody className="p-0">
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Type</Th>
              {days.map((d, i) => {
                const h = dayHead(d)
                return (
                  <Th key={d} className={cn('text-right whitespace-nowrap', i === 6 && 'bg-accent-50/70 text-accent-700')}>
                    {i === 6 ? 'Today' : `${h.weekday} ${h.date}`}
                  </Th>
                )
              })}
              <Th className="text-right">7 days</Th>
            </THead>
            <tbody>
              {ACTIVITY_ROWS.map((row) => {
                const values = days.map((d) => cell(row.key, d))
                const total = values.reduce((a, b) => a + b, 0)
                return (
                  <Tr key={row.key}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link to={row.to} className="hover:text-accent-700">
                        {row.label}
                      </Link>
                    </Td>
                    {values.map((v, i) => (
                      <Td
                        key={days[i]}
                        className={cn(
                          'text-right tabular-nums whitespace-nowrap',
                          v === 0 && 'text-text-subtle',
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
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Account balances: every balance-sheet account (P&L accounts excluded, as in
// the old app). Clicking a row expands this month's activity for it.

const PL_TYPES = new Set(['income', 'other_income', 'expense', 'other_expense', 'cost_of_goods_sold'])
const TYPE_ORDER = [
  'bank',
  'accounts_receivable',
  'other_current_asset',
  'fixed_asset',
  'other_asset',
  'accounts_payable',
  'other_current_liability',
  'long_term_liability',
  'equity',
]

export function AccountBalancesCard() {
  const { orgId, currencySymbol } = useOrg()
  const { data: accounts, isLoading } = useLedgerAccounts(orgId)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = (accounts ?? [])
    .filter((a) => !PL_TYPES.has(a.account_type) && (a.balance !== 0 || a.account_type === 'bank'))
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.account_type) - TYPE_ORDER.indexOf(b.account_type) || a.name.localeCompare(b.name),
    )

  return (
    <Card>
      <CardHeader title="Account balances" subtitle="Click an account for this month's activity" />
      <CardBody className="p-0">
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Account</Th>
              <Th>Type</Th>
              <Th className="text-right">Balance</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyState message="No account activity yet." />}
              {rows.map((a) => {
                const open = openId === a.id
                return (
                  <Fragment key={a.id}>
                    <Tr onClick={() => setOpenId(open ? null : a.id)}>
                      <Td className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronRight
                            size={14}
                            className={cn('text-text-subtle transition-transform duration-150', open && 'rotate-90')}
                          />
                          {a.name}
                        </span>
                      </Td>
                      <Td className="text-text-muted">{accountTypeLabel(a.account_type)}</Td>
                      <Td className={cn('text-right tabular-nums', a.balance < 0 && 'text-danger-600')}>
                        {formatMoney(a.balance, currencySymbol)}
                      </Td>
                    </Tr>
                    {open && (
                      <tr className="border-b border-divider bg-surface-muted/50">
                        <td colSpan={3} className="px-4 py-3">
                          <MonthActivity accountId={a.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  )
}

function MonthActivity({ accountId }: { accountId: string }) {
  const { orgId, currencySymbol } = useOrg()
  const { start, end } = rangeForPreset('this-month-to-date')
  const { data, isLoading } = useGeneralLedger(orgId, start, end, accountId)
  const block = useMemo(() => groupLedger(data ?? [])[0], [data])
  const money = (v: number) => formatMoney(v, currencySymbol)

  if (isLoading) return <p className="text-sm text-text-muted">Loading…</p>
  if (!block) return null

  // Each line's effect on the balance, sign-normalized for the account type
  // (a credit raises Accounts Payable but lowers Cash), from the running
  // balance general_ledger already computes.
  let previous = block.opening
  const withChange = block.lines.map((l) => {
    const change = l.running_balance - previous
    previous = l.running_balance
    return { ...l, change }
  })
  const lines = withChange.slice(-8)
  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-muted">
        <span>
          This month · opening {money(block.opening)} · closing{' '}
          <span className="font-semibold text-text">{money(block.closing)}</span>
        </span>
        <Link
          to={`/reports/account-statement?account=${accountId}&from=${start}&to=${end}`}
          className="shrink-0 font-medium text-accent-700 hover:underline"
        >
          Full statement →
        </Link>
      </div>
      {block.lines.length === 0 ? (
        <p className="text-xs text-text-muted">No activity this month.</p>
      ) : (
        <ul className="divide-y divide-divider rounded-lg border border-border bg-surface">
          {block.lines.length > lines.length && (
            <li className="px-3 py-1.5 text-xs text-text-muted">
              {block.lines.length - lines.length} earlier entries this month…
            </li>
          )}
          {lines.map((l) => {
            const amount = l.change
            return (
              <li key={l.line_id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <span className="w-20 shrink-0 text-text-muted">{formatDate(l.entry_date)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {referenceLabel(l.reference_type)}
                  {l.memo && <span className="text-text-muted"> · {l.memo}</span>}
                </span>
                <span className={cn('shrink-0 tabular-nums', amount < 0 ? 'text-danger-600' : 'text-success-600')}>
                  {amount < 0 ? '−' : '+'}
                  {money(Math.abs(amount))}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent transactions: the latest documents of any type.

const DOC_TYPES: Record<string, { label: string; path: string; detail: boolean }> = {
  sales_receipt: { label: 'Sales receipt', path: '/sales', detail: true },
  invoice: { label: 'Invoice', path: '/invoices', detail: true },
  supplier_bill: { label: 'Supplier bill', path: '/supplier-bills', detail: true },
  purchase_order: { label: 'Purchase order', path: '/purchase-orders', detail: true },
  quotation: { label: 'Quotation', path: '/quotations', detail: true },
  credit_memo: { label: 'Credit memo', path: '/credit-memos', detail: true },
  expense: { label: 'Expense', path: '/expenses', detail: false },
  refund: { label: 'Refund', path: '/refunds', detail: false },
}

export function RecentTransactionsCard() {
  const { orgId, currencySymbol } = useOrg()
  const { data, isLoading } = useRecentTransactions(orgId)

  return (
    <Card>
      <CardHeader
        title="Recent transactions"
        action={
          <Link to="/transactions" className="text-xs font-medium text-accent-700 hover:underline">
            View all →
          </Link>
        }
      />
      <CardBody className="p-0">
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Transaction</Th>
              <Th>Name</Th>
              <Th className="text-right">Amount</Th>
            </THead>
            <tbody>
              {(data ?? []).length === 0 && <EmptyState message="No transactions yet." />}
              {(data ?? []).map((t) => {
                const type = DOC_TYPES[t.doc_type ?? '']
                const to = type ? (type.detail ? `${type.path}/${t.doc_id}` : type.path) : '/transactions'
                return (
                  <Tr key={`${t.doc_type}-${t.doc_id}`}>
                    <Td className="whitespace-nowrap text-text-muted">{formatDate(t.txn_date)}</Td>
                    <Td className="whitespace-nowrap">
                      <Link to={to} className="font-medium hover:text-accent-700">
                        {t.doc_number}
                      </Link>
                      <span className="ml-2 text-xs text-text-muted">{type?.label ?? t.doc_type}</span>
                      {t.status === 'void' && (
                        <span className="ml-2">
                          <Badge>Void</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="max-w-40 truncate">{t.party_name || <span className="text-text-muted">Walk-in</span>}</Td>
                    <Td className="text-right tabular-nums whitespace-nowrap">{formatMoney(t.total ?? 0, currencySymbol)}</Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  )
}

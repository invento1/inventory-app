import { useOrg } from '../../auth/OrgProvider'
import type { Json } from '../../types/supabase'
import { formatMoney } from '../../lib/currency'
import { DOC_TYPE_LABELS, DOC_TYPE_ROUTES } from '../transactions/api'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, ReportLink, ReportTable, Row } from './ReportParts'
import { useRangeReport } from './api'

// Deleted / Updated Transactions, from the audit log the database keeps on
// every document table (see the audit_log migration). HashirHub voids rather
// than deletes, so "deleted" includes voids and cancellations.

const EXTRA_LABELS: Record<string, string> = { inventory_adjustment: 'Inventory Adjustment' }
const EXTRA_ROUTES: Record<string, (id: string) => string> = {
  inventory_adjustment: (id) => `/inventory-adjustments/${id}`,
}
const docLabel = (type: string) => DOC_TYPE_LABELS[type] ?? EXTRA_LABELS[type] ?? type.replace(/_/g, ' ')
const docRoute = (type: string, id: string | null) => {
  const routes = { ...EXTRA_ROUTES, ...DOC_TYPE_ROUTES }
  return id && type in routes ? routes[type](id) : null
}

function formatWhen(ts: string) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const RESET_LABELS: Record<string, string> = {
  sales_receipts: 'Sales receipts',
  invoices: 'Invoices',
  supplier_bills: 'Supplier bills',
  purchase_orders: 'Purchase orders',
  quotations: 'Quotations',
  sales_orders: 'Sales orders',
  credit_memos: 'Credit memos',
  refunds: 'Refunds',
  expenses: 'Expenses',
  inventory_activity: 'Inventory transfers & adjustments',
  ledger_entries: 'Manual ledger entries',
  audit_log: 'Audit log',
  items: 'Items',
  customers: 'Customers',
  suppliers: 'Suppliers',
  locations: 'Locations',
  reference_data: 'Reference lists',
  chart_of_accounts: 'Chart of accounts',
}

export function DeletedTransactionsReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('deleted_transactions', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []

  const what = (r: (typeof rows)[number]) =>
    r.doc_type === 'reset_data'
      ? `Reset Data: ${(r.party_name ?? '').split(', ').map((k) => RESET_LABELS[k] ?? k).join(', ')}`
      : `${docLabel(r.doc_type)} ${r.doc_number ?? ''}`

  function exportCsv() {
    const out: CsvRow[] = [
      ['Deleted Transactions', dates.label],
      [],
      ['When', 'Action', 'Document', 'Document date', 'Party', 'Total', 'By', 'Note'],
      ...rows.map((r): CsvRow => [
        r.changed_at, r.action, what(r), r.doc_date ?? '', r.doc_type === 'reset_data' ? '' : (r.party_name ?? ''),
        r.total ?? '', r.changed_by_name ?? '', r.note ?? '',
      ]),
    ]
    downloadCsv(`deleted-transactions-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Deleted Transactions"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>When</HeadCell>
            <HeadCell>Action</HeadCell>
            <HeadCell>Document</HeadCell>
            <HeadCell>Date</HeadCell>
            <HeadCell>Party</HeadCell>
            <HeadCell right>Total</HeadCell>
            <HeadCell>By</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={7} message="Nothing was deleted, voided or cancelled in this period." />}
        {rows.map((r) => {
          const route = docRoute(r.doc_type, r.doc_id)
          return (
            <Row key={r.log_id}>
              <Cell className="whitespace-nowrap text-text-muted">{formatWhen(r.changed_at)}</Cell>
              <Cell className={r.action === 'Reset Data' || r.action === 'Deleted' ? 'font-medium text-danger-600' : 'font-medium'}>
                {r.action}
              </Cell>
              <Cell>
                {route ? <ReportLink to={route}>{what(r)}</ReportLink> : what(r)}
                {r.note && r.doc_type !== 'reset_data' && <p className="text-xs text-text-muted">{r.note}</p>}
              </Cell>
              <Cell className="whitespace-nowrap text-text-muted">{r.doc_date ? formatDate(r.doc_date) : ''}</Cell>
              <Cell>{r.doc_type === 'reset_data' ? '' : (r.party_name ?? '')}</Cell>
              {r.total == null ? <Cell /> : <MoneyTd value={r.total} symbol={currencySymbol} />}
              <Cell className="text-text-muted">{r.changed_by_name ?? '—'}</Cell>
            </Row>
          )
        })}
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        HashirHub voids and cancels documents rather than deleting them, so this lists voids and cancellations too.
        Reset Data runs are listed as one line each. Recorded from 22 October 2026; earlier voids show no user.
      </p>
    </ReportShell>
  )
}

// Readable names for the columns people actually change.
const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  notes: 'Notes',
  customer_id: 'Customer',
  supplier_id: 'Supplier',
  sales_rep_id: 'Sales rep',
  due_date: 'Due date',
  delivery_date: 'Delivery date',
  expected_date: 'Expected date',
  expiry_date: 'Expiry date',
  discount: 'Discount',
  subtotal: 'Subtotal',
  total: 'Total',
  bill_id: 'Converted to bill',
  invoice_id: 'Invoice',
  show_previous_balance: 'Printout: previous balance',
  show_recent_invoices: 'Printout: recent invoices',
  show_recent_payments: 'Printout: recent payments',
}

function fieldLabel(key: string) {
  return FIELD_LABELS[key] ?? key.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function readable(value: Json | undefined, key: string, symbol: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return ['discount', 'subtotal', 'total', 'amount', 'amount_paid'].includes(key) ? formatMoney(value, symbol) : String(value)
  if (typeof value === 'string') return key.endsWith('_date') ? formatDate(value) : value.replace(/_/g, ' ')
  return JSON.stringify(value)
}

// "Status: open → invoiced". Ids aren't shown (they mean nothing to a reader).
function describeChange(key: string, oldData: Json | null, newData: Json | null, symbol: string) {
  const o = oldData && typeof oldData === 'object' && !Array.isArray(oldData) ? oldData[key] : undefined
  const n = newData && typeof newData === 'object' && !Array.isArray(newData) ? newData[key] : undefined
  if (key.endsWith('_id')) return `${fieldLabel(key)} changed`
  return `${fieldLabel(key)}: ${readable(o, key, symbol)} → ${readable(n, key, symbol)}`
}

export function UpdatedTransactionsReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('updated_transactions', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []

  const changes = (r: (typeof rows)[number]) =>
    r.changed_fields
      // Totals move with the lines; the line edit is the change worth reading.
      .filter((f) => !['subtotal'].includes(f))
      .map((f) => describeChange(f, r.old_data, r.new_data, currencySymbol))

  function exportCsv() {
    const out: CsvRow[] = [
      ['Updated Transactions', dates.label],
      [],
      ['When', 'Document', 'Document date', 'Party', 'Changes', 'By'],
      ...rows.map((r): CsvRow => [
        r.changed_at, `${docLabel(r.doc_type)} ${r.doc_number ?? ''}`, r.doc_date ?? '', r.party_name ?? '',
        changes(r).join('; '), r.changed_by_name ?? '',
      ]),
    ]
    downloadCsv(`updated-transactions-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Updated Transactions"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>When</HeadCell>
            <HeadCell>Document</HeadCell>
            <HeadCell>Party</HeadCell>
            <HeadCell>What changed</HeadCell>
            <HeadCell>By</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={5} message="No document changes in this period." />}
        {rows.map((r) => {
          const route = docRoute(r.doc_type, r.doc_id)
          const label = `${docLabel(r.doc_type)} ${r.doc_number ?? ''}`
          return (
            <Row key={r.log_id}>
              <Cell className="whitespace-nowrap align-top text-text-muted">{formatWhen(r.changed_at)}</Cell>
              <Cell className="whitespace-nowrap align-top">{route ? <ReportLink to={route}>{label}</ReportLink> : label}</Cell>
              <Cell className="align-top">{r.party_name ?? ''}</Cell>
              <Cell className="align-top">
                <ul className="flex flex-col gap-0.5">
                  {changes(r).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </Cell>
              <Cell className="align-top text-text-muted">{r.changed_by_name ?? '—'}</Cell>
            </Row>
          )
        })}
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Payments aren't listed here (they're their own records), and voids and cancellations are in Deleted Transactions.
      </p>
    </ReportShell>
  )
}

import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, NumTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { CostMissingNote } from './SalesMetrics'
import { useRangeReport } from './api'

// Income by Customer: sales less credit memos and refunds, less COGS. The
// net sales total equals the Sales Income account's activity for the period.
export function IncomeByCustomerReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('income_by_customer', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const sum = (key: 'sales' | 'credit_memos' | 'refunds' | 'net_sales' | 'cogs' | 'gross_profit') =>
    rows.reduce((s, r) => s + r[key], 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Income by Customer', dates.label],
      [],
      ['Customer', 'Sales', 'Credit memos', 'Refunds', 'Net sales', 'COGS', 'Gross profit'],
      ...rows.map((r): CsvRow => [
        r.customer_name,
        r.sales,
        r.credit_memos,
        r.refunds,
        r.net_sales,
        r.cogs,
        r.gross_profit,
      ]),
      ['Total', sum('sales'), sum('credit_memos'), sum('refunds'), sum('net_sales'), sum('cogs'), sum('gross_profit')],
    ]
    downloadCsv(`income-by-customer-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Income by Customer"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Customer</HeadCell>
            <HeadCell right>Sales</HeadCell>
            <HeadCell right>Credit memos</HeadCell>
            <HeadCell right>Refunds</HeadCell>
            <HeadCell right>Net sales</HeadCell>
            <HeadCell right>COGS</HeadCell>
            <HeadCell right>Gross profit</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={7} message="No customer income in this period." />}
        {rows.map((r) => (
          <Row key={r.customer_id ?? 'walk-in'}>
            <Cell>
              {r.customer_id ? (
                <ReportLink to={`/reports/customer-statement?customer=${r.customer_id}&from=${dates.start}&to=${dates.end}`}>
                  {r.customer_name}
                </ReportLink>
              ) : (
                <span className="text-text-muted">{r.customer_name}</span>
              )}
            </Cell>
            <MoneyTd value={r.sales} symbol={currencySymbol} />
            <MoneyTd value={-r.credit_memos} symbol={currencySymbol} blankZero className="text-text-muted" />
            <MoneyTd value={-r.refunds} symbol={currencySymbol} blankZero className="text-text-muted" />
            <MoneyTd value={r.net_sales} symbol={currencySymbol} className="font-medium" />
            <MoneyTd value={-r.cogs} symbol={currencySymbol} blankZero className="text-text-muted" />
            <MoneyTd
              value={r.gross_profit}
              symbol={currencySymbol}
              className={r.gross_profit < 0 ? 'text-danger-600' : undefined}
            />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <MoneyTd value={sum('sales')} symbol={currencySymbol} />
          <MoneyTd value={-sum('credit_memos')} symbol={currencySymbol} />
          <MoneyTd value={-sum('refunds')} symbol={currencySymbol} />
          <MoneyTd value={sum('net_sales')} symbol={currencySymbol} />
          <MoneyTd value={-sum('cogs')} symbol={currencySymbol} />
          <MoneyTd value={sum('gross_profit')} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <CostMissingNote show={rows.some((r) => r.cost_missing)} />
    </ReportShell>
  )
}

const DOC_TYPES: Record<string, { label: string; path: string }> = {
  sales_receipt: { label: 'Sales receipts', path: '/sales' },
  invoice: { label: 'Invoices', path: '/invoices' },
  credit_memo: { label: 'Credit memos', path: '/credit-memos' },
  refund: { label: 'Refunds', path: '/refunds' },
  quotation: { label: 'Quotations', path: '/quotations' },
  purchase_order: { label: 'Purchase orders', path: '/purchase-orders' },
  supplier_bill: { label: 'Supplier bills', path: '/supplier-bills' },
  expense: { label: 'Expenses', path: '/expenses' },
}

const DOC_ORDER = Object.keys(DOC_TYPES)

// Transactions Summary: how many of each document type, and their total,
// in a period. Totals of different document types aren't additive (a bill
// and an invoice move money in opposite directions), so there's no grand
// total amount -- only a document count.
export function TransactionsSummaryReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('transactions_summary', orgId, dates.start, dates.end, dates.valid)
  const rows = [...(data ?? [])].sort((a, b) => DOC_ORDER.indexOf(a.doc_type) - DOC_ORDER.indexOf(b.doc_type))
  const totalCount = rows.reduce((s, r) => s + r.doc_count, 0)
  const totalVoid = rows.reduce((s, r) => s + r.void_count, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Transactions Summary', dates.label],
      [],
      ['Transaction type', 'Count', 'Total', 'Voided'],
      ...rows.map((r): CsvRow => [DOC_TYPES[r.doc_type]?.label ?? r.doc_type, r.doc_count, r.total, r.void_count]),
      ['Total', totalCount, '', totalVoid],
    ]
    downloadCsv(`transactions-summary-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Transactions Summary"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Transaction type</HeadCell>
            <HeadCell right>Count</HeadCell>
            <HeadCell right>Total</HeadCell>
            <HeadCell right>Voided</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={4} message="No transactions in this period." />}
        {rows.map((r) => {
          const type = DOC_TYPES[r.doc_type]
          return (
            <Row key={r.doc_type}>
              <Cell>{type ? <ReportLink to={type.path}>{type.label}</ReportLink> : r.doc_type}</Cell>
              <NumTd value={r.doc_count} />
              <MoneyTd value={r.total} symbol={currencySymbol} />
              <NumTd value={r.void_count} className="text-text-muted" />
            </Row>
          )
        })}
        <TotalRow grand>
          <Cell>Total</Cell>
          <NumTd value={totalCount} />
          <Cell />
          <NumTd value={totalVoid} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

// Purchases by Supplier: bills issued in the period (count, total, paid so
// far, still owed) and purchase orders raised in the period.
export function PurchasesBySupplierReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('purchases_by_supplier', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const sum = (key: 'bill_count' | 'po_count' | 'purchases' | 'paid' | 'balance') =>
    rows.reduce((s, r) => s + r[key], 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Purchases by Supplier', dates.label],
      [],
      ['Supplier', 'Bills', 'Purchase orders', 'Purchases', 'Paid', 'Balance'],
      ...rows.map((r): CsvRow => [r.supplier_name, r.bill_count, r.po_count, r.purchases, r.paid, r.balance]),
      ['Total', sum('bill_count'), sum('po_count'), sum('purchases'), sum('paid'), sum('balance')],
    ]
    downloadCsv(`purchases-by-supplier-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Purchases by Supplier"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Supplier</HeadCell>
            <HeadCell right>Bills</HeadCell>
            <HeadCell right>POs</HeadCell>
            <HeadCell right>Purchases</HeadCell>
            <HeadCell right>Paid</HeadCell>
            <HeadCell right>Balance</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={6} message="No supplier bills or purchase orders in this period." />}
        {rows.map((r) => (
          <Row key={r.supplier_id}>
            <Cell>
              <ReportLink to={`/reports/supplier-statement?supplier=${r.supplier_id}&from=${dates.start}&to=${dates.end}`}>
                {r.supplier_name}
              </ReportLink>
            </Cell>
            <NumTd value={r.bill_count} />
            <NumTd value={r.po_count} className="text-text-muted" />
            <MoneyTd value={r.purchases} symbol={currencySymbol} />
            <MoneyTd value={r.paid} symbol={currencySymbol} />
            <MoneyTd value={r.balance} symbol={currencySymbol} className={r.balance > 0 ? 'font-medium' : undefined} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <NumTd value={sum('bill_count')} />
          <NumTd value={sum('po_count')} />
          <MoneyTd value={sum('purchases')} symbol={currencySymbol} />
          <MoneyTd value={sum('paid')} symbol={currencySymbol} />
          <MoneyTd value={sum('balance')} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 py-3 text-xs text-text-muted">
        Purchases = supplier bills issued in the period (voids excluded). Paid and Balance are as of today for those
        bills.
      </p>
    </ReportShell>
  )
}

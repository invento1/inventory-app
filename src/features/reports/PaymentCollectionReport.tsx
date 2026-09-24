import { useMemo } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange, ymd } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, ReportLink, ReportTable, Row, SectionRow, TotalRow } from './ReportParts'
import { paymentMethodLabel } from './references'
import { usePaymentCollection } from './api'

export function PaymentCollectionReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = usePaymentCollection(orgId, dates.start, dates.end, dates.valid)

  const rows = data ?? []
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const byMethod = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.payment_method, (map.get(r.payment_method) ?? 0) + r.amount)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  function exportCsv() {
    const out: CsvRow[] = [
      ['Payment Collection Summary', dates.label],
      [],
      ['Date', 'Customer', 'Invoice', 'Method', 'Reference', 'Deposit', 'Amount'],
      ...rows.map((r): CsvRow => [
        ymd(new Date(r.paid_at)),
        r.customer_name,
        r.invoice_number,
        paymentMethodLabel(r.payment_method),
        r.reference_number,
        r.deposit_number ?? 'Undeposited',
        r.amount,
      ]),
      ['Total', '', '', '', '', '', total],
    ]
    downloadCsv(`payment-collection-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Payment Collection Summary"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Date</HeadCell>
            <HeadCell>Customer</HeadCell>
            <HeadCell>Invoice</HeadCell>
            <HeadCell>Method</HeadCell>
            <HeadCell>Reference</HeadCell>
            <HeadCell>Deposit</HeadCell>
            <HeadCell right>Amount</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={7} message="No customer payments in this period." />}
        {rows.map((r) => (
          <Row key={r.payment_id}>
            <Cell className="whitespace-nowrap">{formatDate(r.paid_at)}</Cell>
            <Cell>{r.customer_name}</Cell>
            <Cell className="whitespace-nowrap">
              <ReportLink to={`/invoices/${r.invoice_id}`}>{r.invoice_number}</ReportLink>
            </Cell>
            <Cell>{paymentMethodLabel(r.payment_method)}</Cell>
            <Cell className="text-text-muted">{r.reference_number}</Cell>
            <Cell className={r.deposit_number ? 'whitespace-nowrap' : 'whitespace-nowrap text-warning-600'}>
              {r.deposit_number ?? 'Undeposited'}
            </Cell>
            <MoneyTd value={r.amount} symbol={currencySymbol} />
          </Row>
        ))}
        {byMethod.length > 1 && (
          <>
            <SectionRow label="By payment method" colSpan={7} />
            {byMethod.map(([method, amount]) => (
              <Row key={method}>
                <Cell indent colSpan={6}>
                  {paymentMethodLabel(method)}
                </Cell>
                <MoneyTd value={amount} symbol={currencySymbol} />
              </Row>
            ))}
          </>
        )}
        <TotalRow grand>
          <Cell colSpan={6}>Total collected</Cell>
          <MoneyTd value={total} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

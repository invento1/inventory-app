import { useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useAsOfDate } from './dates'
import { AsOfControls, CheckboxControl } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { useCustomerBalances } from './api'

export function CustomerBalancesReport() {
  const { orgId, currencySymbol } = useOrg()
  const asOf = useAsOfDate()
  const [showZero, setShowZero] = useState(false)
  const { data, isLoading, error } = useCustomerBalances(orgId, asOf.asOf, asOf.valid)

  const rows = (data ?? []).filter((r) => showZero || Math.round(r.balance * 100) !== 0)
  const total = (key: 'invoiced' | 'paid' | 'credited' | 'balance') => rows.reduce((s, r) => s + r[key], 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Customer Balance Summary', asOf.label],
      [],
      ['Customer', 'Invoiced', 'Paid', 'Credits', 'Balance'],
      ...rows.map((r): CsvRow => [r.customer_name, r.invoiced, r.paid, r.credited, r.balance]),
      ['Total', total('invoiced'), total('paid'), total('credited'), total('balance')],
    ]
    downloadCsv(`customer-balances-${asOf.asOf}`, out)
  }

  return (
    <ReportShell
      title="Customer Balance Summary"
      period={asOf.label}
      controls={
        <>
          <AsOfControls state={asOf} />
          <CheckboxControl label="Show zero balances" checked={showZero} onChange={setShowZero} />
        </>
      }
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Customer</HeadCell>
            <HeadCell right>Invoiced</HeadCell>
            <HeadCell right>Paid</HeadCell>
            <HeadCell right>Credits</HeadCell>
            <HeadCell right>Balance</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={5} message="No customers owe anything as of this date." />}
        {rows.map((r) => (
          <Row key={r.customer_id}>
            <Cell>
              <ReportLink to={`/reports/customer-statement?customer=${r.customer_id}&from=2000-01-01&to=${asOf.asOf}`}>
                {r.customer_name}
              </ReportLink>
            </Cell>
            <MoneyTd value={r.invoiced} symbol={currencySymbol} />
            <MoneyTd value={r.paid} symbol={currencySymbol} />
            <MoneyTd value={r.credited} symbol={currencySymbol} blankZero />
            <MoneyTd
              value={r.balance}
              symbol={currencySymbol}
              className={r.balance > 0 ? 'font-medium text-danger-600' : undefined}
            />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <MoneyTd value={total('invoiced')} symbol={currencySymbol} />
          <MoneyTd value={total('paid')} symbol={currencySymbol} />
          <MoneyTd value={total('credited')} symbol={currencySymbol} />
          <MoneyTd value={total('balance')} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 py-3 text-xs text-text-muted">
        Balance = invoiced − payments − credit memos, matching the Accounts Receivable account. Refunds aren't
        included since they don't post to Accounts Receivable.
      </p>
    </ReportShell>
  )
}

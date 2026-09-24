import { useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useAsOfDate } from './dates'
import { AsOfControls, CheckboxControl } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { useSupplierBalances } from './api'

export function SupplierBalancesReport() {
  const { orgId, currencySymbol } = useOrg()
  const asOf = useAsOfDate()
  const [showZero, setShowZero] = useState(false)
  const { data, isLoading, error } = useSupplierBalances(orgId, asOf.asOf, asOf.valid)

  const rows = (data ?? []).filter((r) => showZero || Math.round(r.balance * 100) !== 0)
  const total = (key: 'billed' | 'paid' | 'balance') => rows.reduce((s, r) => s + r[key], 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Supplier Balance Summary', asOf.label],
      [],
      ['Supplier', 'Billed', 'Paid', 'Balance'],
      ...rows.map((r): CsvRow => [r.supplier_name, r.billed, r.paid, r.balance]),
      ['Total', total('billed'), total('paid'), total('balance')],
    ]
    downloadCsv(`supplier-balances-${asOf.asOf}`, out)
  }

  return (
    <ReportShell
      title="Supplier Balance Summary"
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
            <HeadCell>Supplier</HeadCell>
            <HeadCell right>Billed</HeadCell>
            <HeadCell right>Paid</HeadCell>
            <HeadCell right>Balance</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={4} message="Nothing owed to suppliers as of this date." />}
        {rows.map((r) => (
          <Row key={r.supplier_id}>
            <Cell>
              <ReportLink to={`/reports/supplier-statement?supplier=${r.supplier_id}&from=2000-01-01&to=${asOf.asOf}`}>
                {r.supplier_name}
              </ReportLink>
            </Cell>
            <MoneyTd value={r.billed} symbol={currencySymbol} />
            <MoneyTd value={r.paid} symbol={currencySymbol} />
            <MoneyTd value={r.balance} symbol={currencySymbol} className={r.balance > 0 ? 'font-medium' : undefined} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <MoneyTd value={total('billed')} symbol={currencySymbol} />
          <MoneyTd value={total('paid')} symbol={currencySymbol} />
          <MoneyTd value={total('balance')} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

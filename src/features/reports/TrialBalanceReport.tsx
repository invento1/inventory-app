import { useOrg } from '../../auth/OrgProvider'
import { accountTypeLabel } from '../accounts/api'
import { downloadCsv, type CsvRow } from './csv'
import { useAsOfDate } from './dates'
import { AsOfControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { useTrialBalance } from './api'

export function TrialBalanceReport() {
  const { orgId, currencySymbol } = useOrg()
  const asOf = useAsOfDate()
  const { data: rows, isLoading, error } = useTrialBalance(orgId, asOf.asOf, asOf.valid)

  const list = rows ?? []
  const totalDebit = list.reduce((s, r) => s + r.debit, 0)
  const totalCredit = list.reduce((s, r) => s + r.credit, 0)

  function exportCsv() {
    const out: CsvRow[] = [['Trial Balance', asOf.label], [], ['Account', 'Type', 'Debit', 'Credit']]
    list.forEach((r) => out.push([r.account_name, accountTypeLabel(r.account_type), r.debit || null, r.credit || null]))
    out.push(['Total', '', totalDebit, totalCredit])
    downloadCsv(`trial-balance-${asOf.asOf}`, out)
  }

  return (
    <ReportShell
      title="Trial Balance"
      period={asOf.label}
      controls={<AsOfControls state={asOf} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Account</HeadCell>
            <HeadCell>Type</HeadCell>
            <HeadCell right>Debit</HeadCell>
            <HeadCell right>Credit</HeadCell>
          </>
        }
      >
        {list.length === 0 && <EmptyRow colSpan={4} message="No account activity up to this date." />}
        {list.map((r) => (
          <Row key={r.account_id}>
            <Cell>
              <ReportLink to={`/reports/account-statement?account=${r.account_id}&from=2000-01-01&to=${asOf.asOf}`}>
                {r.account_name}
              </ReportLink>
            </Cell>
            <Cell className="text-text-muted">{accountTypeLabel(r.account_type)}</Cell>
            <MoneyTd value={r.debit} symbol={currencySymbol} blankZero />
            <MoneyTd value={r.credit} symbol={currencySymbol} blankZero />
          </Row>
        ))}
        <TotalRow grand>
          <Cell colSpan={2}>Total</Cell>
          <MoneyTd value={totalDebit} symbol={currencySymbol} />
          <MoneyTd value={totalCredit} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

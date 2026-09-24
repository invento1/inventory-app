import { useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useDateRange } from './dates'
import { CheckboxControl, DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, HeadCell, MoneyTd, ReportLink, ReportTable, Row, SectionRow, TotalRow } from './ReportParts'
import { useProfitAndLossReport, type ProfitAndLossRow } from './api'

const INCOME_TYPES = new Set(['income', 'other_income'])
const COGS_TYPE = 'cost_of_goods_sold'

export function ProfitLossReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const [showZero, setShowZero] = useState(false)
  const { data: rows, isLoading, error } = useProfitAndLossReport(orgId, dates.start, dates.end, dates.valid)

  const report = useMemo(() => {
    const visible = (rows ?? []).filter((r) => showZero || Math.round(r.amount * 100) !== 0)
    const income = visible.filter((r) => INCOME_TYPES.has(r.account_type))
    const cogs = visible.filter((r) => r.account_type === COGS_TYPE)
    const expenses = visible.filter((r) => !INCOME_TYPES.has(r.account_type) && r.account_type !== COGS_TYPE)
    const sum = (list: ProfitAndLossRow[]) => list.reduce((s, r) => s + r.amount, 0)
    const totalIncome = sum(income)
    const totalCogs = sum(cogs)
    const totalExpenses = sum(expenses)
    const grossProfit = totalIncome - totalCogs
    return {
      income,
      cogs,
      expenses,
      totalIncome,
      totalCogs,
      totalExpenses,
      grossProfit,
      netProfit: grossProfit - totalExpenses,
    }
  }, [rows, showZero])

  const statementLink = (accountId: string) =>
    `/reports/account-statement?account=${accountId}&from=${dates.start}&to=${dates.end}`

  function exportCsv() {
    const out: CsvRow[] = [['Profit & Loss', dates.label], [], ['Account', 'Amount']]
    const section = (title: string, list: ProfitAndLossRow[], totalLabel: string, total: number) => {
      out.push([title])
      list.forEach((r) => out.push([r.account_name, r.amount]))
      out.push([totalLabel, total])
    }
    section('Income', report.income, 'Total Income', report.totalIncome)
    section('Cost of Goods Sold', report.cogs, 'Total Cost of Goods Sold', report.totalCogs)
    out.push(['Gross Profit', report.grossProfit])
    section('Expenses', report.expenses, 'Total Expenses', report.totalExpenses)
    out.push(['Net Profit', report.netProfit])
    downloadCsv(`profit-and-loss-${dates.start}-to-${dates.end}`, out)
  }

  const accountRows = (list: ProfitAndLossRow[]) =>
    list.map((r) => (
      <Row key={r.account_id}>
        <Cell indent>
          <ReportLink to={statementLink(r.account_id)}>{r.account_name}</ReportLink>
        </Cell>
        <MoneyTd value={r.amount} symbol={currencySymbol} />
      </Row>
    ))

  return (
    <ReportShell
      title="Profit & Loss"
      period={dates.label}
      controls={
        <>
          <DateRangeControls state={dates} />
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
            <HeadCell>Account</HeadCell>
            <HeadCell right>Amount</HeadCell>
          </>
        }
      >
        <SectionRow label="Income" colSpan={2} />
        {accountRows(report.income)}
        <TotalRow>
          <Cell>Total Income</Cell>
          <MoneyTd value={report.totalIncome} symbol={currencySymbol} />
        </TotalRow>

        <SectionRow label="Cost of Goods Sold" colSpan={2} />
        {accountRows(report.cogs)}
        <TotalRow>
          <Cell>Total Cost of Goods Sold</Cell>
          <MoneyTd value={report.totalCogs} symbol={currencySymbol} />
        </TotalRow>

        <TotalRow grand>
          <Cell>Gross Profit</Cell>
          <MoneyTd value={report.grossProfit} symbol={currencySymbol} />
        </TotalRow>

        <SectionRow label="Expenses" colSpan={2} />
        {accountRows(report.expenses)}
        <TotalRow>
          <Cell>Total Expenses</Cell>
          <MoneyTd value={report.totalExpenses} symbol={currencySymbol} />
        </TotalRow>

        <TotalRow grand>
          <Cell>Net Profit</Cell>
          <MoneyTd
            value={report.netProfit}
            symbol={currencySymbol}
            className={report.netProfit >= 0 ? 'text-success-600' : 'text-danger-600'}
          />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

import { useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useAsOfDate } from './dates'
import { AsOfControls, CheckboxControl } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, HeadCell, MoneyTd, ReportLink, ReportTable, Row, SectionRow, TotalRow } from './ReportParts'
import { useBalanceSheet, type BalanceSheetRow } from './api'

const SECTIONS = {
  currentAssets: { title: 'Current Assets', types: ['bank', 'accounts_receivable', 'other_current_asset'] },
  fixedAssets: { title: 'Fixed Assets', types: ['fixed_asset'] },
  otherAssets: { title: 'Other Assets', types: ['other_asset'] },
  currentLiabilities: { title: 'Current Liabilities', types: ['accounts_payable', 'other_current_liability'] },
  longTermLiabilities: { title: 'Long-term Liabilities', types: ['long_term_liability'] },
  equity: { title: 'Equity', types: ['equity'] },
} as const

type SectionKey = keyof typeof SECTIONS

export function BalanceSheetReport() {
  const { orgId, currencySymbol } = useOrg()
  const asOf = useAsOfDate()
  const [showZero, setShowZero] = useState(false)
  const { data: rows, isLoading, error } = useBalanceSheet(orgId, asOf.asOf, asOf.valid)

  const report = useMemo(() => {
    const visible = (rows ?? []).filter((r) => showZero || Math.round(r.balance * 100) !== 0)
    const bySection = {} as Record<SectionKey, { rows: BalanceSheetRow[]; total: number }>
    for (const key of Object.keys(SECTIONS) as SectionKey[]) {
      const list = visible.filter((r) => (SECTIONS[key].types as readonly string[]).includes(r.account_type))
      // Real accounts alphabetically, then the synthetic Retained Earnings / Net Income rows.
      list.sort((a, b) => Number(!a.account_id) - Number(!b.account_id) || a.account_name.localeCompare(b.account_name))
      bySection[key] = { rows: list, total: list.reduce((s, r) => s + r.balance, 0) }
    }
    const totalAssets = bySection.currentAssets.total + bySection.fixedAssets.total + bySection.otherAssets.total
    const totalLiabilities = bySection.currentLiabilities.total + bySection.longTermLiabilities.total
    return {
      bySection,
      totalAssets,
      totalLiabilities,
      totalEquity: bySection.equity.total,
      totalLiabilitiesEquity: totalLiabilities + bySection.equity.total,
    }
  }, [rows, showZero])

  const statementLink = (accountId: string) =>
    `/reports/account-statement?account=${accountId}&from=2000-01-01&to=${asOf.asOf}`

  function exportCsv() {
    const out: CsvRow[] = [['Balance Sheet', asOf.label], [], ['Account', 'Balance']]
    const section = (key: SectionKey) => {
      const { rows: list, total } = report.bySection[key]
      out.push([SECTIONS[key].title])
      list.forEach((r) => out.push([r.account_name, r.balance]))
      out.push([`Total ${SECTIONS[key].title}`, total])
    }
    out.push(['ASSETS'])
    section('currentAssets')
    section('fixedAssets')
    section('otherAssets')
    out.push(['TOTAL ASSETS', report.totalAssets])
    out.push(['LIABILITIES & EQUITY'])
    section('currentLiabilities')
    section('longTermLiabilities')
    out.push(['Total Liabilities', report.totalLiabilities])
    section('equity')
    out.push(['TOTAL LIABILITIES & EQUITY', report.totalLiabilitiesEquity])
    downloadCsv(`balance-sheet-${asOf.asOf}`, out)
  }

  function renderSection(key: SectionKey) {
    const { rows: list, total } = report.bySection[key]
    if (list.length === 0 && Math.round(total * 100) === 0) return null
    return (
      <>
        <Row>
          <Cell className="font-medium">{SECTIONS[key].title}</Cell>
          <Cell />
        </Row>
        {list.map((r) => (
          <Row key={r.account_id ?? r.account_name}>
            <Cell indent>
              {r.account_id ? <ReportLink to={statementLink(r.account_id)}>{r.account_name}</ReportLink> : r.account_name}
            </Cell>
            <MoneyTd value={r.balance} symbol={currencySymbol} />
          </Row>
        ))}
        <TotalRow>
          <Cell>Total {SECTIONS[key].title}</Cell>
          <MoneyTd value={total} symbol={currencySymbol} />
        </TotalRow>
      </>
    )
  }

  const outOfBalance = Math.round((report.totalAssets - report.totalLiabilitiesEquity) * 100) !== 0

  return (
    <ReportShell
      title="Balance Sheet"
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
            <HeadCell>Account</HeadCell>
            <HeadCell right>Balance</HeadCell>
          </>
        }
      >
        <SectionRow label="Assets" colSpan={2} />
        {renderSection('currentAssets')}
        {renderSection('fixedAssets')}
        {renderSection('otherAssets')}
        <TotalRow grand>
          <Cell>Total Assets</Cell>
          <MoneyTd value={report.totalAssets} symbol={currencySymbol} />
        </TotalRow>

        <SectionRow label="Liabilities & Equity" colSpan={2} />
        {renderSection('currentLiabilities')}
        {renderSection('longTermLiabilities')}
        <TotalRow>
          <Cell>Total Liabilities</Cell>
          <MoneyTd value={report.totalLiabilities} symbol={currencySymbol} />
        </TotalRow>
        {renderSection('equity')}
        <TotalRow grand>
          <Cell>Total Liabilities & Equity</Cell>
          <MoneyTd value={report.totalLiabilitiesEquity} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      {outOfBalance && (
        <p className="px-5 py-3 text-sm text-danger-600">
          Assets and Liabilities & Equity differ — the ledger has an unbalanced entry.
        </p>
      )}
      <p className="px-5 py-3 text-xs text-text-muted">
        Retained Earnings is all profit and loss before this calendar year; Net Income is this calendar year to the
        report date.
      </p>
    </ReportShell>
  )
}

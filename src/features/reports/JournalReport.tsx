import { Fragment, useMemo } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, ReportLink, ReportTable, Row, SectionRow, TotalRow } from './ReportParts'
import { referenceLabel, referencePath } from './references'
import { useJournalReport, type JournalReportRow } from './api'

export function JournalReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data: rows, isLoading, error } = useJournalReport(orgId, dates.start, dates.end, dates.valid)

  const entries = useMemo(() => {
    const byEntry: { first: JournalReportRow; lines: JournalReportRow[] }[] = []
    for (const row of rows ?? []) {
      const last = byEntry[byEntry.length - 1]
      if (last && last.first.entry_id === row.entry_id) last.lines.push(row)
      else byEntry.push({ first: row, lines: [row] })
    }
    return byEntry
  }, [rows])

  const totalDebit = (rows ?? []).reduce((s, r) => s + r.debit, 0)
  const totalCredit = (rows ?? []).reduce((s, r) => s + r.credit, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Journal', dates.label],
      [],
      ['Date', 'Entry', 'Source', 'Account', 'Name', 'Memo', 'Debit', 'Credit'],
    ]
    for (const r of rows ?? []) {
      out.push([
        r.entry_date,
        r.entry_number,
        referenceLabel(r.reference_type),
        r.account_name,
        r.line_name,
        r.line_memo || r.entry_memo,
        r.debit || null,
        r.credit || null,
      ])
    }
    out.push(['Total', '', '', '', '', '', totalDebit, totalCredit])
    downloadCsv(`journal-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Journal"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Account</HeadCell>
            <HeadCell>Name</HeadCell>
            <HeadCell>Memo</HeadCell>
            <HeadCell right>Debit</HeadCell>
            <HeadCell right>Credit</HeadCell>
          </>
        }
      >
        {entries.length === 0 && <EmptyRow colSpan={5} message="No journal entries in this period." />}
        {entries.map(({ first, lines }) => {
          const path = referencePath(first.reference_type, first.reference_id)
          const source = referenceLabel(first.reference_type)
          return (
            <Fragment key={first.entry_id}>
              <SectionRow
                colSpan={5}
                label={
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{formatDate(first.entry_date)}</span>
                    <span className="text-text-muted">{first.entry_number}</span>
                    <span className="font-normal">{path ? <ReportLink to={path}>{source}</ReportLink> : source}</span>
                    {first.entry_memo && <span className="font-normal text-text-muted">{first.entry_memo}</span>}
                  </span>
                }
              />
              {lines.map((l) => (
                <Row key={l.line_id}>
                  <Cell indent>{l.account_name}</Cell>
                  <Cell>{l.line_name}</Cell>
                  <Cell className="text-text-muted">{l.line_memo}</Cell>
                  <MoneyTd value={l.debit} symbol={currencySymbol} blankZero />
                  <MoneyTd value={l.credit} symbol={currencySymbol} blankZero />
                </Row>
              ))}
            </Fragment>
          )
        })}
        <TotalRow grand>
          <Cell colSpan={3}>Total</Cell>
          <MoneyTd value={totalDebit} symbol={currencySymbol} />
          <MoneyTd value={totalCredit} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

import { useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { accountTypeLabel, useLedgerAccounts } from '../accounts/api'
import { downloadCsv, type CsvRow } from './csv'
import { useDateRange } from './dates'
import { DateRangeControls, FilterSelect } from './ReportControls'
import { ReportShell } from './ReportShell'
import { EmptyRow, HeadCell, ReportTable, SectionRow } from './ReportParts'
import { LEDGER_COLUMNS, LedgerBlockRows, ledgerBlockCsv } from './LedgerBlock'
import { groupLedger, useGeneralLedger } from './api'

export function GeneralLedgerReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const [accountId, setAccountId] = useState('')
  const { data: accounts } = useLedgerAccounts(orgId)
  const { data: rows, isLoading, error } = useGeneralLedger(
    orgId,
    dates.start,
    dates.end,
    accountId || null,
    dates.valid,
  )

  const blocks = useMemo(() => groupLedger(rows ?? []), [rows])

  function exportCsv() {
    const out: CsvRow[] = [['General Ledger', dates.label], [], LEDGER_COLUMNS]
    for (const block of blocks) {
      out.push([`${block.accountName} (${accountTypeLabel(block.accountType)})`])
      out.push(...ledgerBlockCsv(block))
    }
    downloadCsv(`general-ledger-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="General Ledger"
      period={dates.label}
      controls={
        <>
          <DateRangeControls state={dates} />
          <FilterSelect
            label="Account"
            value={accountId}
            onChange={setAccountId}
            allLabel="All accounts"
            options={(accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
          />
        </>
      }
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable head={LEDGER_COLUMNS.map((c, i) => <HeadCell key={c} right={i >= 5}>{c}</HeadCell>)}>
        {blocks.length === 0 && <EmptyRow colSpan={8} message="No account activity in this period." />}
        {blocks.map((block) => (
          <LedgerSection key={block.accountId} block={block} symbol={currencySymbol} />
        ))}
      </ReportTable>
    </ReportShell>
  )
}

function LedgerSection({ block, symbol }: { block: ReturnType<typeof groupLedger>[number]; symbol: string }) {
  return (
    <>
      <SectionRow
        colSpan={8}
        label={
          <>
            {block.accountName}{' '}
            <span className="font-normal text-text-muted">· {accountTypeLabel(block.accountType)}</span>
          </>
        }
      />
      <LedgerBlockRows block={block} symbol={symbol} />
    </>
  )
}

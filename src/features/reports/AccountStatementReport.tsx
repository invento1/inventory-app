import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useOrg } from '../../auth/OrgProvider'
import { Select } from '../../components/ui/Select'
import { accountTypeLabel, useLedgerAccounts } from '../accounts/api'
import { downloadCsv, type CsvRow } from './csv'
import { useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { HeadCell, ReportTable } from './ReportParts'
import { LEDGER_COLUMNS, LedgerBlockRows, ledgerBlockCsv } from './LedgerBlock'
import { groupLedger, useGeneralLedger } from './api'

export function AccountStatementReport() {
  const { orgId, currencySymbol } = useOrg()
  const [params] = useSearchParams()
  const dates = useDateRange('this-month-to-date')
  const [accountId, setAccountId] = useState(params.get('account') ?? '')
  const { data: accounts } = useLedgerAccounts(orgId)
  const { data: rows, isLoading, error } = useGeneralLedger(
    orgId,
    dates.start,
    dates.end,
    accountId,
    dates.valid && !!accountId,
  )

  const account = accounts?.find((a) => a.id === accountId)
  const block = useMemo(() => groupLedger(rows ?? [])[0], [rows])

  function exportCsv() {
    if (!block) return
    const out: CsvRow[] = [
      ['Account Statement', block.accountName, dates.label],
      [],
      LEDGER_COLUMNS,
      ...ledgerBlockCsv(block),
    ]
    downloadCsv(`account-statement-${block.accountName}-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title={account ? `Account Statement — ${account.name}` : 'Account Statement'}
      period={
        account ? `${accountTypeLabel(account.account_type)} · ${dates.label}` : dates.label
      }
      controls={
        <>
          <div className="w-full sm:w-64">
            <Select label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select an account…</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <DateRangeControls state={dates} />
        </>
      }
      onExportCsv={block ? exportCsv : undefined}
      prompt={accountId ? undefined : 'Select an account to see its statement.'}
      isLoading={isLoading}
      error={error}
    >
      {block && (
        <ReportTable head={LEDGER_COLUMNS.map((c, i) => <HeadCell key={c} right={i >= 5}>{c}</HeadCell>)}>
          <LedgerBlockRows block={block} symbol={currencySymbol} />
        </ReportTable>
      )}
    </ReportShell>
  )
}

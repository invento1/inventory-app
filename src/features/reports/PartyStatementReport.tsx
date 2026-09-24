import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useOrg } from '../../auth/OrgProvider'
import { Select } from '../../components/ui/Select'
import { useCustomers } from '../customers/api'
import { useSuppliers } from '../suppliers/api'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { usePartyStatement, type StatementRow } from './api'

const DOC_TYPES: Record<string, { label: string; path: string }> = {
  invoice: { label: 'Invoice', path: '/invoices' },
  payment: { label: 'Payment', path: '/invoices' },
  credit_memo: { label: 'Credit memo', path: '/credit-memos' },
  supplier_bill: { label: 'Bill', path: '/supplier-bills' },
  bill_payment: { label: 'Bill payment', path: '/supplier-bills' },
}

const COPY = {
  customer: {
    title: 'Customer Statement',
    party: 'Customer',
    pick: 'Select a customer to see their statement.',
    charges: 'Charges',
    payments: 'Payments & credits',
    file: 'customer-statement',
  },
  supplier: {
    title: 'Supplier Statement',
    party: 'Supplier',
    pick: 'Select a supplier to see their statement.',
    charges: 'Bills',
    payments: 'Payments',
    file: 'supplier-statement',
  },
}

// Customer Statement and Supplier Statement: an opening balance, every
// document in range with a running balance, and a closing balance. The
// customer balance is what they owe you; the supplier balance is what you owe
// them.
export function PartyStatementReport({ kind }: { kind: 'customer' | 'supplier' }) {
  const { orgId, currencySymbol } = useOrg()
  const [params] = useSearchParams()
  const copy = COPY[kind]
  const dates = useDateRange('this-year-to-date')
  const [partyId, setPartyId] = useState(params.get(kind) ?? '')
  const { data: customers } = useCustomers(orgId)
  const { data: suppliers } = useSuppliers(orgId)
  const parties = (kind === 'customer' ? customers : suppliers) ?? []
  const party = parties.find((p) => p.id === partyId)

  const { data: rows, isLoading, error } = usePartyStatement(
    kind,
    orgId,
    partyId,
    dates.start,
    dates.end,
    dates.valid && !!partyId,
  )

  const opening = rows?.find((r) => r.doc_type === 'opening')?.balance ?? 0
  const lines = (rows ?? []).filter((r) => r.doc_type !== 'opening')
  const closing = lines.length ? lines[lines.length - 1].balance : opening
  const totalCharges = lines.reduce((s, r) => s + r.charge, 0)
  const totalPayments = lines.reduce((s, r) => s + r.payment, 0)

  const docLabel = (r: StatementRow) => DOC_TYPES[r.doc_type]?.label ?? r.doc_type

  function exportCsv() {
    const out: CsvRow[] = [
      [copy.title, party?.name ?? '', dates.label],
      [],
      ['Date', 'Type', 'Number', 'Memo', copy.charges, copy.payments, 'Balance'],
      ['Opening balance', '', '', '', '', '', opening],
      ...lines.map((r): CsvRow => [
        r.txn_date,
        docLabel(r),
        r.doc_number,
        r.memo,
        r.charge || null,
        r.payment || null,
        r.balance,
      ]),
      ['Closing balance', '', '', '', totalCharges, totalPayments, closing],
    ]
    downloadCsv(`${copy.file}-${party?.name ?? ''}-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title={party ? `${copy.title} — ${party.name}` : copy.title}
      period={dates.label}
      controls={
        <>
          <div className="w-full sm:w-64">
            <Select label={copy.party} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">Select a {copy.party.toLowerCase()}…</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <DateRangeControls state={dates} />
        </>
      }
      onExportCsv={exportCsv}
      prompt={partyId ? undefined : copy.pick}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Date</HeadCell>
            <HeadCell>Type</HeadCell>
            <HeadCell>Number</HeadCell>
            <HeadCell>Memo</HeadCell>
            <HeadCell right>{copy.charges}</HeadCell>
            <HeadCell right>{copy.payments}</HeadCell>
            <HeadCell right>Balance</HeadCell>
          </>
        }
      >
        <Row className="bg-surface-muted/60 print:bg-transparent">
          <Cell colSpan={6} className="text-text-muted">
            Opening balance
          </Cell>
          <MoneyTd value={opening} symbol={currencySymbol} />
        </Row>
        {lines.length === 0 && <EmptyRow colSpan={7} message="No activity in this period." />}
        {lines.map((r, i) => {
          const base = DOC_TYPES[r.doc_type]?.path
          return (
            <Row key={`${r.doc_type}-${r.doc_id}-${i}`}>
              <Cell className="whitespace-nowrap">{formatDate(r.txn_date)}</Cell>
              <Cell className="whitespace-nowrap">{docLabel(r)}</Cell>
              <Cell className="whitespace-nowrap">
                {base && r.doc_id ? <ReportLink to={`${base}/${r.doc_id}`}>{r.doc_number}</ReportLink> : r.doc_number}
              </Cell>
              <Cell className="capitalize text-text-muted">{r.memo}</Cell>
              <MoneyTd value={r.charge} symbol={currencySymbol} blankZero />
              <MoneyTd value={r.payment} symbol={currencySymbol} blankZero />
              <MoneyTd value={r.balance} symbol={currencySymbol} />
            </Row>
          )
        })}
        <TotalRow grand>
          <Cell colSpan={4}>Closing balance</Cell>
          <MoneyTd value={totalCharges} symbol={currencySymbol} />
          <MoneyTd value={totalPayments} symbol={currencySymbol} />
          <MoneyTd value={closing} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

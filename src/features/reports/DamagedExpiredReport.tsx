import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOrg } from '../../auth/OrgProvider'
import { supabase } from '../../lib/supabaseClient'
import { adjustmentReasonLabel } from '../inventory/api'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange } from './dates'
import { DateRangeControls, FilterSelect } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, NumTd, ReportLink, ReportTable, Row, SectionRow, TotalRow } from './ReportParts'
import { useRangeReport } from './api'

// Damaged / Expired Inventory:
// * stock written off as damaged or expired in the period (inventory
//   adjustments with that reason);
// * stock still on hand past its expiry date, or expiring within 30 days, as
//   at the end of the period (items' expiry dates).

const EXPIRING_WITHIN_DAYS = 30

type Kind = '' | 'damaged' | 'expired'

function useExpiredStock(orgId: string, asOf: string, enabled: boolean) {
  return useQuery({
    queryKey: ['report', 'expired_stock', orgId, asOf],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('expired_stock', {
        p_org_id: orgId,
        p_as_of: asOf,
        p_within_days: EXPIRING_WITHIN_DAYS,
      })
      if (error) throw error
      return data ?? []
    },
  })
}

export function DamagedExpiredReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const [kind, setKind] = useState<Kind>('')
  const writeOffs = useRangeReport('stock_write_offs', orgId, dates.start, dates.end, dates.valid)
  const expiry = useExpiredStock(orgId, dates.end, dates.valid && kind !== 'damaged')

  const writeOffRows = (writeOffs.data ?? []).filter((r) => !kind || r.reason === kind)
  const expiryRows = kind === 'damaged' ? [] : (expiry.data ?? [])
  const expired = expiryRows.filter((r) => r.status === 'expired')
  const expiring = expiryRows.filter((r) => r.status === 'expiring')
  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Damaged / Expired Inventory', dates.label],
      [],
      ['Written off in the period'],
      ['Date', 'Adjustment', 'Reason', 'Location', 'Item', 'SKU', 'Category', 'Quantity', 'Value'],
      ...writeOffRows.map((r): CsvRow => [
        r.adjustment_date, r.adjustment_number, adjustmentReasonLabel(r.reason), r.location_name ?? '', r.item_name,
        r.sku, r.category_name ?? '', r.quantity, r.value,
      ]),
    ]
    if (kind !== 'damaged') {
      out.push([], [`Expired or expiring stock on hand at ${dates.end}`])
      out.push(['Status', 'Item', 'SKU', 'Category', 'Expiry date', 'Quantity', 'Value'])
      for (const r of expiryRows) {
        out.push([r.status === 'expired' ? 'Expired' : 'Expiring soon', r.item_name, r.sku, r.category_name ?? '',
          r.expiry_date, r.quantity, r.value])
      }
    }
    downloadCsv(`damaged-expired-${dates.start}-to-${dates.end}`, out)
  }

  const expiryTable = (title: string, rows: typeof expiryRows, tone: string) => (
    <>
      <SectionRow label={title} colSpan={6} />
      {rows.map((r) => (
        <Row key={r.item_id}>
          <Cell indent>
            {r.item_name} <span className="text-xs text-text-muted">{r.sku}</span>
          </Cell>
          <Cell className="text-text-muted">{r.category_name ?? ''}</Cell>
          <Cell className={`whitespace-nowrap font-medium ${tone}`}>{formatDate(r.expiry_date)}</Cell>
          <Cell />
          <NumTd value={r.quantity} />
          <MoneyTd value={r.value} symbol={currencySymbol} />
        </Row>
      ))}
      <TotalRow>
        <Cell colSpan={4}>Total {title.charAt(0).toLowerCase() + title.slice(1)}</Cell>
        <NumTd value={sum(rows, (r) => r.quantity)} />
        <MoneyTd value={sum(rows, (r) => r.value)} symbol={currencySymbol} />
      </TotalRow>
    </>
  )

  return (
    <ReportShell
      title="Damaged / Expired Inventory"
      period={dates.label}
      controls={
        <>
          <DateRangeControls state={dates} />
          <FilterSelect
            label="Show"
            value={kind}
            onChange={(v) => setKind(v as Kind)}
            allLabel="Damaged and expired"
            options={[
              { value: 'damaged', label: 'Damaged only' },
              { value: 'expired', label: 'Expired only' },
            ]}
          />
        </>
      }
      onExportCsv={exportCsv}
      isLoading={writeOffs.isLoading || (kind !== 'damaged' && expiry.isLoading)}
      error={writeOffs.error ?? expiry.error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Item</HeadCell>
            <HeadCell>Category</HeadCell>
            <HeadCell>Date / expiry</HeadCell>
            <HeadCell>Adjustment</HeadCell>
            <HeadCell right>Qty</HeadCell>
            <HeadCell right>Value</HeadCell>
          </>
        }
      >
        <SectionRow label="Written off in the period" colSpan={6} />
        {writeOffRows.length === 0 && (
          <EmptyRow colSpan={6} message="No stock written off as damaged or expired in this period." />
        )}
        {writeOffRows.map((r, i) => (
          <Row key={`${r.adjustment_id}-${r.item_id}-${i}`}>
            <Cell indent>
              {r.item_name} <span className="text-xs text-text-muted">{r.sku}</span>
            </Cell>
            <Cell className="text-text-muted">{r.category_name ?? ''}</Cell>
            <Cell className="whitespace-nowrap">{formatDate(r.adjustment_date)}</Cell>
            <Cell className="whitespace-nowrap">
              <ReportLink to={`/inventory-adjustments/${r.adjustment_id}`}>{r.adjustment_number}</ReportLink>
              <span className="ml-2 text-xs text-warning-600">{adjustmentReasonLabel(r.reason)}</span>
            </Cell>
            <NumTd value={r.quantity} />
            <MoneyTd value={r.value} symbol={currencySymbol} />
          </Row>
        ))}
        {writeOffRows.length > 0 && (
          <TotalRow>
            <Cell colSpan={4}>Total written off</Cell>
            <NumTd value={sum(writeOffRows, (r) => r.quantity)} />
            <MoneyTd value={sum(writeOffRows, (r) => r.value)} symbol={currencySymbol} />
          </TotalRow>
        )}

        {kind !== 'damaged' && (
          <>
            {expired.length > 0 && expiryTable(`Expired, still in stock on ${formatDate(dates.end)}`, expired, 'text-danger-600')}
            {expiring.length > 0 && expiryTable(`Expiring within ${EXPIRING_WITHIN_DAYS} days`, expiring, 'text-warning-600')}
            {expiryRows.length === 0 && (
              <>
                <SectionRow label="Expired stock on hand" colSpan={6} />
                <EmptyRow colSpan={6} message="No stock past, or close to, its expiry date." />
              </>
            )}
          </>
        )}
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Written off = inventory adjustments with the reason Damaged or Expired (quantity removed, at moving average
        cost). Expiry uses each item's expiry date and its stock across all locations, valued at moving average cost.
      </p>
    </ReportShell>
  )
}

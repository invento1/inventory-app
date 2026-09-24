import { Fragment, useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { Input } from '../../components/ui/Input'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import {
  Cell,
  EmptyRow,
  HeadCell,
  MoneyTd,
  NumTd,
  ReportLink,
  ReportTable,
  Row,
  SectionRow,
  TotalRow,
} from './ReportParts'
import { CostMissingNote, SalesMetricCells, SalesMetricHeads } from './SalesMetrics'
import { useInvoiceItemsSummary, useRangeReport, type RangeRpcRow } from './api'

const DOC_TYPES: Record<string, { label: string; path: string }> = {
  invoice: { label: 'Invoice', path: '/invoices' },
  sales_receipt: { label: 'Sales receipt', path: '/sales' },
}

// Invoices Summary: one row per sale document (invoices + sales receipts).
export function InvoicesSummaryReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_documents', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
  const totalCogs = rows.reduce((s, r) => s + r.cogs, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Invoices Summary', dates.label],
      [],
      ['Type', 'Date', 'Number', 'Customer', 'Lines', 'Amount', 'COGS', 'Gross margin'],
      ...rows.map((r): CsvRow => [
        DOC_TYPES[r.doc_type]?.label ?? r.doc_type,
        r.txn_date,
        r.doc_number,
        r.customer_name ?? 'Walk-in',
        r.line_count,
        r.amount,
        r.cogs,
        r.amount - r.cogs,
      ]),
      ['Total', '', '', '', '', totalAmount, totalCogs, totalAmount - totalCogs],
    ]
    downloadCsv(`invoices-summary-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Invoices Summary"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Date</HeadCell>
            <HeadCell>Number</HeadCell>
            <HeadCell>Type</HeadCell>
            <HeadCell>Customer</HeadCell>
            <HeadCell right>Lines</HeadCell>
            <SalesMetricHeads share={false} />
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={9} message="No invoices or sales receipts in this period." />}
        {rows.map((r) => {
          const type = DOC_TYPES[r.doc_type]
          return (
            <Row key={r.doc_id}>
              <Cell className="whitespace-nowrap">{formatDate(r.txn_date)}</Cell>
              <Cell className="whitespace-nowrap">
                {type ? <ReportLink to={`${type.path}/${r.doc_id}`}>{r.doc_number}</ReportLink> : r.doc_number}
              </Cell>
              <Cell className="text-text-muted">{type?.label ?? r.doc_type}</Cell>
              <Cell>{r.customer_name ?? <span className="text-text-muted">Walk-in</span>}</Cell>
              <NumTd value={r.line_count} className="text-text-muted" />
              <SalesMetricCells amount={r.amount} cogs={r.cogs} totalAmount={totalAmount} symbol={currencySymbol} share={false} />
            </Row>
          )
        })}
        <TotalRow grand>
          <Cell colSpan={4}>Total · {rows.length} documents</Cell>
          <NumTd value={rows.reduce((s, r) => s + r.line_count, 0)} />
          <SalesMetricCells amount={totalAmount} cogs={totalCogs} totalAmount={totalAmount} symbol={currencySymbol} share={false} />
        </TotalRow>
      </ReportTable>
      <CostMissingNote show={rows.some((r) => r.cost_missing)} />
    </ReportShell>
  )
}

// Customer Item Sales: every item line sold, grouped by customer.
export function CustomerItemSalesReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_lines', orgId, dates.start, dates.end, dates.valid)

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; walkIn: boolean; rows: RangeRpcRow<'sales_lines'>[] }>()
    for (const r of data ?? []) {
      const key = r.customer_id ?? ''
      const group = map.get(key) ?? { name: r.customer_name ?? 'Walk-in customers', walkIn: !r.customer_id, rows: [] }
      group.rows.push(r)
      map.set(key, group)
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        rows: g.rows.sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.doc_number.localeCompare(b.doc_number)),
        quantity: g.rows.reduce((s, r) => s + r.quantity, 0),
        amount: g.rows.reduce((s, r) => s + r.amount, 0),
      }))
      .sort((a, b) => Number(a.walkIn) - Number(b.walkIn) || a.name.localeCompare(b.name))
  }, [data])
  const grandQty = groups.reduce((s, g) => s + g.quantity, 0)
  const grandAmount = groups.reduce((s, g) => s + g.amount, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Customer Item Sales', dates.label],
      [],
      ['Customer', 'Date', 'Number', 'Item', 'SKU', 'Quantity', 'Unit price', 'Amount'],
    ]
    for (const g of groups) {
      for (const r of g.rows) {
        out.push([g.name, r.txn_date, r.doc_number, r.item_name, r.sku, r.quantity, r.quantity ? r.amount / r.quantity : 0, r.amount])
      }
    }
    out.push(['Total', '', '', '', '', grandQty, '', grandAmount])
    downloadCsv(`customer-item-sales-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Customer Item Sales"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Date</HeadCell>
            <HeadCell>Number</HeadCell>
            <HeadCell>Item</HeadCell>
            <HeadCell right>Qty</HeadCell>
            <HeadCell right>Unit price</HeadCell>
            <HeadCell right>Amount</HeadCell>
          </>
        }
      >
        {groups.length === 0 && <EmptyRow colSpan={6} message="No sales in this period." />}
        {groups.map((g) => (
          <Fragment key={g.name}>
            <SectionRow label={g.name} colSpan={6} />
            {g.rows.map((r, i) => {
              const type = DOC_TYPES[r.doc_type]
              return (
                <Row key={`${r.doc_id}-${r.item_id}-${i}`}>
                  <Cell indent className="whitespace-nowrap">
                    {formatDate(r.txn_date)}
                  </Cell>
                  <Cell className="whitespace-nowrap">
                    {type ? <ReportLink to={`${type.path}/${r.doc_id}`}>{r.doc_number}</ReportLink> : r.doc_number}
                  </Cell>
                  <Cell>
                    {r.item_name} <span className="text-xs text-text-muted">{r.sku}</span>
                  </Cell>
                  <NumTd value={r.quantity} />
                  <MoneyTd value={r.quantity ? r.amount / r.quantity : 0} symbol={currencySymbol} className="text-text-muted" />
                  <MoneyTd value={r.amount} symbol={currencySymbol} />
                </Row>
              )
            })}
            <TotalRow>
              <Cell colSpan={3}>Total {g.name}</Cell>
              <NumTd value={g.quantity} />
              <Cell />
              <MoneyTd value={g.amount} symbol={currencySymbol} />
            </TotalRow>
          </Fragment>
        ))}
        {groups.length > 0 && (
          <TotalRow grand>
            <Cell colSpan={3}>Grand total</Cell>
            <NumTd value={grandQty} />
            <Cell />
            <MoneyTd value={grandAmount} symbol={currencySymbol} />
          </TotalRow>
        )}
      </ReportTable>
    </ReportShell>
  )
}

function parseInvoiceNumber(value: string): number | null {
  const digits = value.match(/(\d+)\s*$/)
  return digits ? Number(digits[1]) : null
}

// Invoice Items Summary: total quantity of each item across a range of
// invoice numbers -- e.g. a picking/loading list for a batch of invoices.
export function InvoiceItemsSummaryReport() {
  const { orgId, currencySymbol } = useOrg()
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const fromNumber = parseInvoiceNumber(fromText)
  const toNumber = parseInvoiceNumber(toText)
  const { data, isLoading, error } = useInvoiceItemsSummary(orgId, fromNumber, toNumber)

  const rows = data ?? []
  const invoiceCount = rows[0]?.invoice_count ?? 0
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0)
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
  const rangeLabel =
    fromNumber === null && toNumber === null
      ? 'All invoices'
      : `Invoices ${fromNumber ?? 'first'} to ${toNumber ?? 'latest'}`

  function exportCsv() {
    const out: CsvRow[] = [
      ['Invoice Items Summary', rangeLabel, `${invoiceCount} invoices`],
      [],
      ['#', 'Item', 'SKU', 'Quantity', 'Amount'],
      ...rows.map((r, i): CsvRow => [i + 1, r.item_name, r.sku, r.quantity, r.amount]),
      ['Total', '', '', totalQty, totalAmount],
    ]
    downloadCsv('invoice-items-summary', out)
  }

  return (
    <ReportShell
      title="Invoice Items Summary"
      period={`${rangeLabel} · ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`}
      controls={
        <>
          <div className="w-full sm:w-44">
            <Input label="From invoice #" placeholder="e.g. 1" value={fromText} onChange={(e) => setFromText(e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <Input label="To invoice #" placeholder="e.g. 25" value={toText} onChange={(e) => setToText(e.target.value)} />
          </div>
        </>
      }
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell right>#</HeadCell>
            <HeadCell>Item</HeadCell>
            <HeadCell>SKU</HeadCell>
            <HeadCell right>Total qty</HeadCell>
            <HeadCell right>Amount</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={5} message="No invoice items in this range." />}
        {rows.map((r, i) => (
          <Row key={r.item_id}>
            <NumTd value={i + 1} className="text-text-muted" />
            <Cell>{r.item_name}</Cell>
            <Cell className="text-text-muted">{r.sku}</Cell>
            <NumTd value={r.quantity} />
            <MoneyTd value={r.amount} symbol={currencySymbol} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell colSpan={3}>Total</Cell>
          <NumTd value={totalQty} />
          <MoneyTd value={totalAmount} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 py-3 text-xs text-text-muted">
        Enter the number part of the invoice number — "12" matches INV-000012. Leave either box empty for an
        open-ended range. Voided invoices are excluded.
      </p>
    </ReportShell>
  )
}

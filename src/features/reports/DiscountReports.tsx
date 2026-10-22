import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, NumTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { useRangeReport } from './api'

// Discounts given on invoices and sales receipts (voids excluded): line
// discounts plus each document's whole-document discount, which sales_lines
// spreads across its lines in proportion.

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0)

export function CustomerDiscountsReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('customer_discounts', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const sum = (key: 'doc_count' | 'gross_amount' | 'line_discount' | 'document_discount' | 'discount' | 'amount') =>
    rows.reduce((s, r) => s + r[key], 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Customer Discounts Summary', dates.label],
      [],
      ['Customer', 'Documents', 'Sales before discount', 'Line discounts', 'Invoice discounts', 'Total discount', 'Net sales', 'Discount %'],
      ...rows.map((r): CsvRow => [
        r.customer_name, r.doc_count, r.gross_amount, r.line_discount, r.document_discount, r.discount, r.amount,
        pct(r.discount, r.gross_amount),
      ]),
      ['Total', sum('doc_count'), sum('gross_amount'), sum('line_discount'), sum('document_discount'), sum('discount'),
        sum('amount'), pct(sum('discount'), sum('gross_amount'))],
    ]
    downloadCsv(`customer-discounts-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Customer Discounts Summary"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Customer</HeadCell>
            <HeadCell right>Documents</HeadCell>
            <HeadCell right>Before discount</HeadCell>
            <HeadCell right>Line discounts</HeadCell>
            <HeadCell right>Invoice discounts</HeadCell>
            <HeadCell right>Total discount</HeadCell>
            <HeadCell right>Net sales</HeadCell>
            <HeadCell right>Discount %</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={8} message="No discounts given in this period." />}
        {rows.map((r) => (
          <Row key={r.customer_id ?? 'walk-in'}>
            <Cell>
              {r.customer_id ? (
                <ReportLink to={`/reports/customer-statement?customer=${r.customer_id}&from=${dates.start}&to=${dates.end}`}>
                  {r.customer_name}
                </ReportLink>
              ) : (
                r.customer_name
              )}
            </Cell>
            <NumTd value={r.doc_count} />
            <MoneyTd value={r.gross_amount} symbol={currencySymbol} className="text-text-muted" />
            <MoneyTd value={r.line_discount} symbol={currencySymbol} blankZero />
            <MoneyTd value={r.document_discount} symbol={currencySymbol} blankZero />
            <MoneyTd value={r.discount} symbol={currencySymbol} className="font-medium text-warning-600" />
            <MoneyTd value={r.amount} symbol={currencySymbol} />
            <NumTd value={pct(r.discount, r.gross_amount)} className="text-text-muted" />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <NumTd value={sum('doc_count')} />
          <MoneyTd value={sum('gross_amount')} symbol={currencySymbol} />
          <MoneyTd value={sum('line_discount')} symbol={currencySymbol} />
          <MoneyTd value={sum('document_discount')} symbol={currencySymbol} />
          <MoneyTd value={sum('discount')} symbol={currencySymbol} />
          <MoneyTd value={sum('amount')} symbol={currencySymbol} />
          <NumTd value={pct(sum('discount'), sum('gross_amount'))} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Invoices and sales receipts, voids excluded. Only customers who were given a discount are listed.
      </p>
    </ReportShell>
  )
}

export function ItemDiscountsReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('item_discounts', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const sum = (key: 'quantity' | 'gross_amount' | 'discount' | 'amount') => rows.reduce((s, r) => s + r[key], 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Item Discounts Summary', dates.label],
      [],
      ['Item', 'SKU', 'Category', 'Brand', 'Quantity sold', 'Sales before discount', 'Discount', 'Net sales', 'Discount %'],
      ...rows.map((r): CsvRow => [
        r.item_name, r.sku, r.category_name, r.brand_name, r.quantity, r.gross_amount, r.discount, r.amount,
        pct(r.discount, r.gross_amount),
      ]),
      ['Total', '', '', '', sum('quantity'), sum('gross_amount'), sum('discount'), sum('amount'), pct(sum('discount'), sum('gross_amount'))],
    ]
    downloadCsv(`item-discounts-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Item Discounts Summary"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Item</HeadCell>
            <HeadCell>Category</HeadCell>
            <HeadCell>Brand</HeadCell>
            <HeadCell right>Qty sold</HeadCell>
            <HeadCell right>Before discount</HeadCell>
            <HeadCell right>Discount</HeadCell>
            <HeadCell right>Net sales</HeadCell>
            <HeadCell right>Discount %</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={8} message="No item discounts in this period." />}
        {rows.map((r) => (
          <Row key={r.item_id}>
            <Cell>
              {r.item_name} <span className="text-xs text-text-muted">{r.sku}</span>
            </Cell>
            <Cell className="text-text-muted">{r.category_name ?? ''}</Cell>
            <Cell className="text-text-muted">{r.brand_name ?? ''}</Cell>
            <NumTd value={r.quantity} />
            <MoneyTd value={r.gross_amount} symbol={currencySymbol} className="text-text-muted" />
            <MoneyTd value={r.discount} symbol={currencySymbol} className="font-medium text-warning-600" />
            <MoneyTd value={r.amount} symbol={currencySymbol} />
            <NumTd value={pct(r.discount, r.gross_amount)} className="text-text-muted" />
          </Row>
        ))}
        <TotalRow grand>
          <Cell colSpan={3}>Total</Cell>
          <NumTd value={sum('quantity')} />
          <MoneyTd value={sum('gross_amount')} symbol={currencySymbol} />
          <MoneyTd value={sum('discount')} symbol={currencySymbol} />
          <MoneyTd value={sum('amount')} symbol={currencySymbol} />
          <NumTd value={pct(sum('discount'), sum('gross_amount'))} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Includes each item's share of whole-invoice discounts, so the totals match the Customer Discounts Summary.
      </p>
    </ReportShell>
  )
}

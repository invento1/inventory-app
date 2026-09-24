import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, NumTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { CostMissingNote, SALES_METRIC_CSV_HEADERS, SalesMetricCells, SalesMetricHeads, salesMetricCsv } from './SalesMetrics'
import { useRangeReport } from './api'

// Sales by Item / Category / Customer. Sales = invoices + sales receipts,
// excluding voids, dated at creation (see the sales_lines SQL function).

const SALES_NOTE = 'Sales = invoices + sales receipts (voids excluded). Credit memos and refunds are netted in Income by Customer.'

function totals<T extends { amount: number; cogs: number; cost_missing: boolean }>(rows: T[]) {
  return {
    amount: rows.reduce((s, r) => s + r.amount, 0),
    cogs: rows.reduce((s, r) => s + r.cogs, 0),
    costMissing: rows.some((r) => r.cost_missing),
  }
}

export function SalesByItemReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_by_item', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const t = totals(rows)
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Sales by Item', dates.label],
      [],
      ['Item', 'SKU', 'Category', 'Quantity', 'Avg price', ...SALES_METRIC_CSV_HEADERS],
      ...rows.map((r): CsvRow => [
        r.item_name,
        r.sku,
        r.category_name,
        r.quantity,
        r.quantity ? r.amount / r.quantity : 0,
        ...salesMetricCsv(r.amount, r.cogs, t.amount),
      ]),
      ['Total', '', '', totalQty, '', ...salesMetricCsv(t.amount, t.cogs, t.amount)],
    ]
    downloadCsv(`sales-by-item-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Sales by Item"
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
            <HeadCell right>Qty</HeadCell>
            <HeadCell right>Avg price</HeadCell>
            <SalesMetricHeads />
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={9} message="No sales in this period." />}
        {rows.map((r) => (
          <Row key={r.item_id}>
            <Cell>
              {r.item_name} <span className="text-xs text-text-muted">{r.sku}</span>
            </Cell>
            <Cell className="text-text-muted">{r.category_name}</Cell>
            <NumTd value={r.quantity} />
            <MoneyTd value={r.quantity ? r.amount / r.quantity : 0} symbol={currencySymbol} className="text-text-muted" />
            <SalesMetricCells amount={r.amount} cogs={r.cogs} totalAmount={t.amount} symbol={currencySymbol} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell colSpan={2}>Total</Cell>
          <NumTd value={totalQty} />
          <Cell />
          <SalesMetricCells amount={t.amount} cogs={t.cogs} totalAmount={t.amount} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">{SALES_NOTE}</p>
      <CostMissingNote show={t.costMissing} />
    </ReportShell>
  )
}

export function SalesByCategoryReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_by_category', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const t = totals(rows)
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Sales by Category', dates.label],
      [],
      ['Category', 'Quantity', ...SALES_METRIC_CSV_HEADERS],
      ...rows.map((r): CsvRow => [r.category_name, r.quantity, ...salesMetricCsv(r.amount, r.cogs, t.amount)]),
      ['Total', totalQty, ...salesMetricCsv(t.amount, t.cogs, t.amount)],
    ]
    downloadCsv(`sales-by-category-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Sales by Category"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Category</HeadCell>
            <HeadCell right>Qty</HeadCell>
            <SalesMetricHeads />
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={7} message="No sales in this period." />}
        {rows.map((r) => (
          <Row key={r.category_id ?? 'uncategorized'}>
            <Cell>{r.category_name}</Cell>
            <NumTd value={r.quantity} />
            <SalesMetricCells amount={r.amount} cogs={r.cogs} totalAmount={t.amount} symbol={currencySymbol} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <NumTd value={totalQty} />
          <SalesMetricCells amount={t.amount} cogs={t.cogs} totalAmount={t.amount} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">{SALES_NOTE}</p>
      <CostMissingNote show={t.costMissing} />
    </ReportShell>
  )
}

export function SalesByCustomerReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_by_customer', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const t = totals(rows)
  const totalDocs = rows.reduce((s, r) => s + r.doc_count, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Sales by Customer', dates.label],
      [],
      ['Customer', 'Sales', ...SALES_METRIC_CSV_HEADERS],
      ...rows.map((r): CsvRow => [r.customer_name, r.doc_count, ...salesMetricCsv(r.amount, r.cogs, t.amount)]),
      ['Total', totalDocs, ...salesMetricCsv(t.amount, t.cogs, t.amount)],
    ]
    downloadCsv(`sales-by-customer-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Sales by Customer"
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
            <HeadCell right>Sales</HeadCell>
            <SalesMetricHeads />
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={7} message="No sales in this period." />}
        {rows.map((r) => (
          <Row key={r.customer_id ?? 'walk-in'}>
            <Cell>
              {r.customer_id ? (
                <ReportLink
                  to={`/reports/customer-statement?customer=${r.customer_id}&from=${dates.start}&to=${dates.end}`}
                >
                  {r.customer_name}
                </ReportLink>
              ) : (
                <span className="text-text-muted">{r.customer_name}</span>
              )}
            </Cell>
            <NumTd value={r.doc_count} />
            <SalesMetricCells amount={r.amount} cogs={r.cogs} totalAmount={t.amount} symbol={currencySymbol} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <NumTd value={totalDocs} />
          <SalesMetricCells amount={t.amount} cogs={t.cogs} totalAmount={t.amount} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">{SALES_NOTE}</p>
      <CostMissingNote show={t.costMissing} />
    </ReportShell>
  )
}

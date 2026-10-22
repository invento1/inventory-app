import { Fragment, useMemo } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, NumTd, ReportLink, ReportTable, Row, SectionRow, TotalRow } from './ReportParts'
import { useRangeReport, type RangeRpcRow } from './api'

// Reports built on the sales representative on each document (invoices,
// sales receipts, credit memos), set from the customer's rep when the document
// is created. Documents without one show as "Unassigned".

const DOC_PATHS: Record<string, string> = {
  invoice: '/invoices',
  sales_receipt: '/sales',
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0)

// Sales By Representative: what each rep sold, the discounts they gave and
// what came back on credit memos.
export function SalesByRepReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_by_rep', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const sum = (key: 'doc_count' | 'gross_amount' | 'discount' | 'amount' | 'returns' | 'net_amount') =>
    rows.reduce((s, r) => s + r[key], 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Sales by Representative', dates.label],
      [],
      ['Representative', 'Documents', 'Gross sales', 'Discounts', 'Sales', 'Returns', 'Net sales', '% of net'],
      ...rows.map((r): CsvRow => [
        r.rep_name,
        r.doc_count,
        r.gross_amount,
        r.discount,
        r.amount,
        r.returns,
        r.net_amount,
        pct(r.net_amount, sum('net_amount')),
      ]),
      ['Total', sum('doc_count'), sum('gross_amount'), sum('discount'), sum('amount'), sum('returns'), sum('net_amount'), 100],
    ]
    downloadCsv(`sales-by-rep-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Sales by Representative"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Representative</HeadCell>
            <HeadCell right>Documents</HeadCell>
            <HeadCell right>Gross sales</HeadCell>
            <HeadCell right>Discounts</HeadCell>
            <HeadCell right>Sales</HeadCell>
            <HeadCell right>Returns</HeadCell>
            <HeadCell right>Net sales</HeadCell>
            <HeadCell right>% of net</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={8} message="No sales in this period." />}
        {rows.map((r) => (
          <Row key={r.sales_rep_id ?? 'unassigned'}>
            <Cell className={r.sales_rep_id ? undefined : 'text-text-muted'}>{r.rep_name}</Cell>
            <NumTd value={r.doc_count} />
            <MoneyTd value={r.gross_amount} symbol={currencySymbol} className="text-text-muted" />
            <MoneyTd value={r.discount} symbol={currencySymbol} blankZero className="text-warning-600" />
            <MoneyTd value={r.amount} symbol={currencySymbol} />
            <MoneyTd value={r.returns} symbol={currencySymbol} blankZero className="text-danger-600" />
            <MoneyTd value={r.net_amount} symbol={currencySymbol} className="font-medium" />
            <NumTd value={pct(r.net_amount, sum('net_amount'))} className="text-text-muted" />
          </Row>
        ))}
        <TotalRow grand>
          <Cell>Total</Cell>
          <NumTd value={sum('doc_count')} />
          <MoneyTd value={sum('gross_amount')} symbol={currencySymbol} />
          <MoneyTd value={sum('discount')} symbol={currencySymbol} />
          <MoneyTd value={sum('amount')} symbol={currencySymbol} />
          <MoneyTd value={sum('returns')} symbol={currencySymbol} />
          <MoneyTd value={sum('net_amount')} symbol={currencySymbol} />
          <Cell />
        </TotalRow>
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Sales = invoices + sales receipts after discounts (voids excluded). Returns = credit memos with that representative.
      </p>
    </ReportShell>
  )
}

type ReturnRow = RangeRpcRow<'return_stock_by_rep'>

// Return Stock By Representative: per rep and item, sold vs returned.
export function ReturnStockByRepReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('return_stock_by_rep', orgId, dates.start, dates.end, dates.valid)

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: ReturnRow[] }>()
    for (const r of data ?? []) {
      const key = r.sales_rep_id ?? ''
      const g = map.get(key) ?? { name: r.rep_name, rows: [] }
      g.rows.push(r)
      map.set(key, g)
    }
    return [...map.entries()].map(([key, g]) => ({ key, ...g, t: totalsOf(g.rows) }))
  }, [data])
  const grand = totalsOf(data ?? [])

  function exportCsv() {
    const out: CsvRow[] = [
      ['Return Stock by Representative', dates.label],
      [],
      ['Representative', 'Item', 'SKU', 'Sold qty', 'Sold amount', 'Returned qty', 'Returned amount', 'Balance qty', 'Balance amount'],
    ]
    for (const g of groups) {
      for (const r of g.rows) {
        out.push([g.name, r.item_name, r.sku, r.sold_qty, r.sold_amount, r.returned_qty, r.returned_amount,
          r.sold_qty - r.returned_qty, r.sold_amount - r.returned_amount])
      }
    }
    out.push(['Total', '', '', grand.soldQty, grand.soldAmount, grand.retQty, grand.retAmount,
      grand.soldQty - grand.retQty, grand.soldAmount - grand.retAmount])
    downloadCsv(`return-stock-by-rep-${dates.start}-to-${dates.end}`, out)
  }

  const totalCells = (t: ReturnType<typeof totalsOf>) => (
    <>
      <NumTd value={t.soldQty} />
      <MoneyTd value={t.soldAmount} symbol={currencySymbol} />
      <NumTd value={t.retQty} />
      <MoneyTd value={t.retAmount} symbol={currencySymbol} />
      <NumTd value={t.soldQty - t.retQty} />
      <MoneyTd value={t.soldAmount - t.retAmount} symbol={currencySymbol} />
    </>
  )

  return (
    <ReportShell
      title="Return Stock by Representative"
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
            <HeadCell right>Sold qty</HeadCell>
            <HeadCell right>Sold amount</HeadCell>
            <HeadCell right>Returned qty</HeadCell>
            <HeadCell right>Returned amount</HeadCell>
            <HeadCell right>Balance qty</HeadCell>
            <HeadCell right>Balance amount</HeadCell>
          </>
        }
      >
        {groups.length === 0 && <EmptyRow colSpan={7} message="No sales or returns in this period." />}
        {groups.map((g) => (
          <Fragment key={g.key}>
            <SectionRow label={g.name} colSpan={7} />
            {g.rows.map((r) => (
              <Row key={r.item_id}>
                <Cell indent>
                  {r.item_name} <span className="text-xs text-text-muted">{r.sku}</span>
                </Cell>
                <NumTd value={r.sold_qty} />
                <MoneyTd value={r.sold_amount} symbol={currencySymbol} />
                <NumTd value={r.returned_qty} className={r.returned_qty ? 'text-danger-600' : 'text-text-muted'} />
                <MoneyTd value={r.returned_amount} symbol={currencySymbol} blankZero className="text-danger-600" />
                <NumTd value={r.sold_qty - r.returned_qty} />
                <MoneyTd value={r.sold_amount - r.returned_amount} symbol={currencySymbol} />
              </Row>
            ))}
            <TotalRow>
              <Cell>Total {g.name}</Cell>
              {totalCells(g.t)}
            </TotalRow>
          </Fragment>
        ))}
        {groups.length > 0 && (
          <TotalRow grand>
            <Cell>Grand total</Cell>
            {totalCells(grand)}
          </TotalRow>
        )}
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Sold = invoices + sales receipts after discounts. Returned = credit memos, by the representative on the credit memo.
      </p>
    </ReportShell>
  )
}

function totalsOf(rows: ReturnRow[]) {
  return {
    soldQty: rows.reduce((s, r) => s + r.sold_qty, 0),
    soldAmount: rows.reduce((s, r) => s + r.sold_amount, 0),
    retQty: rows.reduce((s, r) => s + r.returned_qty, 0),
    retAmount: rows.reduce((s, r) => s + r.returned_amount, 0),
  }
}

type SalesmanRow = RangeRpcRow<'sales_by_salesman'>

// Sales By Salesman: every sold line per rep, with the commission it earned
// (net line amount x the item's commission % recorded at the sale).
export function SalesBySalesmanReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_by_salesman', orgId, dates.start, dates.end, dates.valid)

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: SalesmanRow[] }>()
    for (const r of data ?? []) {
      const key = r.sales_rep_id ?? ''
      const g = map.get(key) ?? { name: r.rep_name, rows: [] }
      g.rows.push(r)
      map.set(key, g)
    }
    return [...map.entries()].map(([key, g]) => ({
      key,
      ...g,
      amount: g.rows.reduce((s, r) => s + r.amount, 0),
      commission: g.rows.reduce((s, r) => s + r.commission, 0),
    }))
  }, [data])
  const grandAmount = groups.reduce((s, g) => s + g.amount, 0)
  const grandCommission = groups.reduce((s, g) => s + g.commission, 0)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Sales by Salesman', dates.label],
      [],
      ['Salesman', 'Date', 'Number', 'Item', 'Quantity', 'Price', 'Amount', 'Commission %', 'Commission'],
    ]
    for (const g of groups) {
      for (const r of g.rows) {
        out.push([g.name, r.txn_date, r.doc_number, r.item_name, r.quantity,
          r.quantity ? r.gross_amount / r.quantity : 0, r.amount, r.commission_rate, r.commission])
      }
      out.push([`Total ${g.name}`, '', '', '', '', '', g.amount, '', g.commission])
    }
    out.push(['Grand total', '', '', '', '', '', grandAmount, '', grandCommission])
    downloadCsv(`sales-by-salesman-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Sales by Salesman"
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
            <HeadCell right>Price</HeadCell>
            <HeadCell right>Amount</HeadCell>
            <HeadCell right>Comm. %</HeadCell>
            <HeadCell right>Commission</HeadCell>
          </>
        }
      >
        {groups.length === 0 && <EmptyRow colSpan={8} message="No sales in this period." />}
        {groups.map((g) => (
          <Fragment key={g.key}>
            <SectionRow label={g.name} colSpan={8} />
            {g.rows.map((r, i) => {
              const path = DOC_PATHS[r.doc_type]
              return (
                <Row key={`${r.doc_id}-${r.item_id}-${i}`}>
                  <Cell indent className="whitespace-nowrap">
                    {formatDate(r.txn_date)}
                  </Cell>
                  <Cell className="whitespace-nowrap">
                    {path ? <ReportLink to={`${path}/${r.doc_id}`}>{r.doc_number}</ReportLink> : r.doc_number}
                  </Cell>
                  <Cell>{r.item_name}</Cell>
                  <NumTd value={r.quantity} />
                  <MoneyTd value={r.quantity ? r.gross_amount / r.quantity : 0} symbol={currencySymbol} className="text-text-muted" />
                  <MoneyTd value={r.amount} symbol={currencySymbol} />
                  <NumTd value={r.commission_rate} className="text-text-muted" />
                  <MoneyTd value={r.commission} symbol={currencySymbol} blankZero />
                </Row>
              )
            })}
            <TotalRow>
              <Cell colSpan={5}>Total {g.name}</Cell>
              <MoneyTd value={g.amount} symbol={currencySymbol} />
              <Cell />
              <MoneyTd value={g.commission} symbol={currencySymbol} />
            </TotalRow>
          </Fragment>
        ))}
        {groups.length > 0 && (
          <TotalRow grand>
            <Cell colSpan={5}>Grand total</Cell>
            <MoneyTd value={grandAmount} symbol={currencySymbol} />
            <Cell />
            <MoneyTd value={grandCommission} symbol={currencySymbol} />
          </TotalRow>
        )}
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Commission = amount after discounts × the item's commission % at the time of the sale (set on each item).
      </p>
    </ReportShell>
  )
}

type RecoveryRow = RangeRpcRow<'financial_recovery'>

// Financial Recovery & Sales Performance: per customer, grouped by their
// credit manager (the customer's sales rep).
export function FinancialRecoveryReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('financial_recovery', orgId, dates.start, dates.end, dates.valid)

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: RecoveryRow[] }>()
    for (const r of data ?? []) {
      const key = r.credit_manager_id ?? ''
      const g = map.get(key) ?? { name: r.credit_manager ?? 'No credit manager', rows: [] }
      g.rows.push(r)
      map.set(key, g)
    }
    return [...map.entries()].map(([key, g]) => ({ key, ...g, t: recoveryTotals(g.rows) }))
  }, [data])
  const grand = recoveryTotals(data ?? [])

  function exportCsv() {
    const out: CsvRow[] = [
      ['Financial Recovery & Sales Performance', dates.label],
      [],
      ['Credit manager', 'Customer', 'Region', 'Area', 'Total sales', 'Recovered', 'Outstanding dues', 'Collection efficiency %'],
    ]
    for (const g of groups) {
      for (const r of g.rows) {
        out.push([g.name, r.customer_name, r.region, r.area, r.total_sales, r.recovered, r.outstanding, pct(r.recovered, r.total_sales)])
      }
    }
    out.push(['Grand total', '', '', '', grand.sales, grand.recovered, grand.outstanding, pct(grand.recovered, grand.sales)])
    downloadCsv(`financial-recovery-${dates.start}-to-${dates.end}`, out)
  }

  const totalCells = (t: ReturnType<typeof recoveryTotals>) => (
    <>
      <MoneyTd value={t.sales} symbol={currencySymbol} />
      <MoneyTd value={t.recovered} symbol={currencySymbol} />
      <MoneyTd value={t.outstanding} symbol={currencySymbol} />
      <NumTd value={pct(t.recovered, t.sales)} />
    </>
  )

  return (
    <ReportShell
      title="Financial Recovery & Sales Performance"
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
            <HeadCell>Region</HeadCell>
            <HeadCell>Area</HeadCell>
            <HeadCell right>Total sales</HeadCell>
            <HeadCell right>Recovered</HeadCell>
            <HeadCell right>Outstanding dues</HeadCell>
            <HeadCell right>Efficiency %</HeadCell>
          </>
        }
      >
        {groups.length === 0 && <EmptyRow colSpan={7} message="No sales, payments or dues in this period." />}
        {groups.map((g) => (
          <Fragment key={g.key}>
            <SectionRow label={g.name} colSpan={7} />
            {g.rows.map((r) => (
              <Row key={r.customer_id ?? 'walk-in'}>
                <Cell indent>
                  {r.customer_id ? (
                    <ReportLink to={`/reports/customer-statement?customer=${r.customer_id}&from=${dates.start}&to=${dates.end}`}>
                      {r.customer_name}
                    </ReportLink>
                  ) : (
                    r.customer_name
                  )}
                </Cell>
                <Cell className="text-text-muted">{r.region ?? ''}</Cell>
                <Cell className="text-text-muted">{r.area ?? ''}</Cell>
                <MoneyTd value={r.total_sales} symbol={currencySymbol} />
                <MoneyTd value={r.recovered} symbol={currencySymbol} />
                <MoneyTd value={r.outstanding} symbol={currencySymbol} className={r.outstanding > 0.005 ? 'text-danger-600' : undefined} />
                <NumTd value={pct(r.recovered, r.total_sales)} className="text-text-muted" />
              </Row>
            ))}
            <TotalRow>
              <Cell colSpan={3}>Total {g.name}</Cell>
              {totalCells(g.t)}
            </TotalRow>
          </Fragment>
        ))}
        {groups.length > 0 && (
          <TotalRow grand>
            <Cell colSpan={3}>Grand total</Cell>
            {totalCells(grand)}
          </TotalRow>
        )}
      </ReportTable>
      <p className="px-5 pt-3 text-xs text-text-muted">
        Total sales and Recovered (customer payments plus cash sales) are within the period. Outstanding dues is each
        customer's balance at the end of the period. Credit manager = the sales rep set on the customer.
      </p>
    </ReportShell>
  )
}

function recoveryTotals(rows: RecoveryRow[]) {
  return {
    sales: rows.reduce((s, r) => s + r.total_sales, 0),
    recovered: rows.reduce((s, r) => s + r.recovered, 0),
    outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
  }
}

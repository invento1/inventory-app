import { useQuery } from '@tanstack/react-query'
import { useOrg } from '../../auth/OrgProvider'
import { supabase } from '../../lib/supabaseClient'
import { Badge } from '../../components/ui/Badge'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, useDateRange } from './dates'
import { DateRangeControls } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, NumTd, ReportLink, ReportTable, Row, TotalRow } from './ReportParts'
import { useRangeReport } from './api'
import { SALES_ORDER_STATUS, type SalesOrderStatus } from '../sales-orders/api'
import { todayYmd } from '../../lib/dates'
import { formatMoney } from '../../lib/currency'

// Sales Orders Summary: every order dated in the period, any status.
export function SalesOrdersSummaryReport() {
  const { orgId, currencySymbol } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const { data, isLoading, error } = useRangeReport('sales_orders_summary', orgId, dates.start, dates.end, dates.valid)
  const rows = data ?? []
  const total = rows.reduce((s, r) => s + r.total, 0)
  const byStatus = (['open', 'invoiced', 'cancelled'] as SalesOrderStatus[]).map((s) => ({
    status: s,
    count: rows.filter((r) => r.status === s).length,
    total: rows.filter((r) => r.status === s).reduce((sum, r) => sum + r.total, 0),
  }))

  function exportCsv() {
    const out: CsvRow[] = [
      ['Sales Orders Summary', dates.label],
      [],
      ['Order', 'Date', 'Delivery', 'Customer', 'Representative', 'Status', 'Invoice', 'Total'],
      ...rows.map((r): CsvRow => [
        r.order_number, r.order_date, r.delivery_date ?? '', r.customer_name, r.rep_name ?? '',
        SALES_ORDER_STATUS[r.status as SalesOrderStatus]?.label ?? r.status, r.invoice_number ?? '', r.total,
      ]),
      ['Total', '', '', '', '', `${rows.length} orders`, '', total],
    ]
    downloadCsv(`sales-orders-${dates.start}-to-${dates.end}`, out)
  }

  return (
    <ReportShell
      title="Sales Orders Summary"
      period={dates.label}
      controls={<DateRangeControls state={dates} />}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 pb-3 text-sm">
          {byStatus.map((s) => (
            <span key={s.status} className="text-text-muted">
              {SALES_ORDER_STATUS[s.status].label}: <span className="font-medium text-text">{s.count}</span> ·{' '}
              <span className="tabular-nums">{formatMoney(s.total, currencySymbol)}</span>
            </span>
          ))}
        </div>
      )}
      <ReportTable
        head={
          <>
            <HeadCell>Order</HeadCell>
            <HeadCell>Date</HeadCell>
            <HeadCell>Delivery</HeadCell>
            <HeadCell>Customer</HeadCell>
            <HeadCell>Representative</HeadCell>
            <HeadCell>Status</HeadCell>
            <HeadCell right>Total</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={7} message="No sales orders in this period." />}
        {rows.map((r) => {
          const status = SALES_ORDER_STATUS[r.status as SalesOrderStatus] ?? SALES_ORDER_STATUS.open
          return (
            <Row key={r.order_id}>
              <Cell className="whitespace-nowrap">
                <ReportLink to={`/sales-orders/${r.order_id}`}>{r.order_number}</ReportLink>
              </Cell>
              <Cell className="whitespace-nowrap">{formatDate(r.order_date)}</Cell>
              <Cell className="whitespace-nowrap text-text-muted">{r.delivery_date ? formatDate(r.delivery_date) : ''}</Cell>
              <Cell>{r.customer_name}</Cell>
              <Cell className="text-text-muted">{r.rep_name ?? ''}</Cell>
              <Cell className="whitespace-nowrap">
                <Badge tone={status.tone}>{status.label}</Badge>
                {r.invoice_id && r.invoice_number && (
                  <span className="ml-2 text-xs">
                    <ReportLink to={`/invoices/${r.invoice_id}`}>{r.invoice_number}</ReportLink>
                  </span>
                )}
              </Cell>
              <MoneyTd value={r.total} symbol={currencySymbol} />
            </Row>
          )
        })}
        <TotalRow grand>
          <Cell colSpan={6}>Total ({rows.length} orders)</Cell>
          <MoneyTd value={total} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

function useOpenOrders(orgId: string) {
  return useQuery({
    queryKey: ['report', 'open_orders', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('open_orders', { p_org_id: orgId })
      if (error) throw error
      return data ?? []
    },
  })
}

// Open Orders Summary: orders still waiting to be invoiced, oldest first.
export function OpenOrdersReport() {
  const { orgId, currencySymbol } = useOrg()
  const { data, isLoading, error } = useOpenOrders(orgId)
  const rows = data ?? []
  const total = rows.reduce((s, r) => s + r.total, 0)
  const overdue = rows.filter((r) => r.is_overdue)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Open Orders Summary', `As of ${todayYmd()}`],
      [],
      ['Order', 'Date', 'Delivery', 'Customer', 'Representative', 'Days open', 'Overdue', 'Total'],
      ...rows.map((r): CsvRow => [
        r.order_number, r.order_date, r.delivery_date ?? '', r.customer_name, r.rep_name ?? '', r.days_open,
        r.is_overdue ? 'Yes' : '', r.total,
      ]),
      ['Total', '', '', '', '', '', `${rows.length} open`, total],
    ]
    downloadCsv(`open-orders-${todayYmd()}`, out)
  }

  return (
    <ReportShell
      title="Open Orders Summary"
      period={`${rows.length} open order${rows.length === 1 ? '' : 's'}${overdue.length ? `, ${overdue.length} past delivery date` : ''}`}
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Order</HeadCell>
            <HeadCell>Date</HeadCell>
            <HeadCell>Delivery</HeadCell>
            <HeadCell>Customer</HeadCell>
            <HeadCell>Representative</HeadCell>
            <HeadCell right>Days open</HeadCell>
            <HeadCell right>Total</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={7} message="No open sales orders." />}
        {rows.map((r) => (
          <Row key={r.order_id}>
            <Cell className="whitespace-nowrap">
              <ReportLink to={`/sales-orders/${r.order_id}`}>{r.order_number}</ReportLink>
            </Cell>
            <Cell className="whitespace-nowrap">{formatDate(r.order_date)}</Cell>
            <Cell className={r.is_overdue ? 'whitespace-nowrap font-medium text-danger-600' : 'whitespace-nowrap text-text-muted'}>
              {r.delivery_date ? formatDate(r.delivery_date) : ''}
              {r.is_overdue && ' (overdue)'}
            </Cell>
            <Cell>{r.customer_name}</Cell>
            <Cell className="text-text-muted">{r.rep_name ?? ''}</Cell>
            <NumTd value={r.days_open} />
            <MoneyTd value={r.total} symbol={currencySymbol} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell colSpan={6}>Total</Cell>
          <MoneyTd value={total} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}


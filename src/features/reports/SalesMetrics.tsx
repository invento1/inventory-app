import type { CsvCell } from './csv'
import { HeadCell, MoneyTd } from './ReportParts'

// Shared Amount / % of sales / COGS / Gross margin / Margin % columns for the
// sales reports (by item, category, customer, document).

function ratio(part: number, whole: number) {
  return whole ? (part / whole) * 100 : 0
}

function PctTd({ value, className }: { value: number; className?: string }) {
  return (
    <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${className ?? ''}`}>
      {value.toFixed(1)}%
    </td>
  )
}

export function SalesMetricHeads({ share = true }: { share?: boolean }) {
  return (
    <>
      <HeadCell right>Amount</HeadCell>
      {share && <HeadCell right>% of sales</HeadCell>}
      <HeadCell right>COGS</HeadCell>
      <HeadCell right>Gross margin</HeadCell>
      <HeadCell right>Margin %</HeadCell>
    </>
  )
}

export function SalesMetricCells({
  amount,
  cogs,
  totalAmount,
  symbol,
  share = true,
}: {
  amount: number
  cogs: number
  totalAmount: number
  symbol: string
  share?: boolean
}) {
  const margin = amount - cogs
  return (
    <>
      <MoneyTd value={amount} symbol={symbol} />
      {share && <PctTd value={ratio(amount, totalAmount)} className="text-text-muted" />}
      <MoneyTd value={cogs} symbol={symbol} className="text-text-muted" />
      <MoneyTd value={margin} symbol={symbol} className={margin < 0 ? 'text-danger-600' : undefined} />
      <PctTd value={ratio(margin, amount)} className={margin < 0 ? 'text-danger-600' : 'text-text-muted'} />
    </>
  )
}

export const SALES_METRIC_CSV_HEADERS = ['Amount', '% of sales', 'COGS', 'Gross margin', 'Margin %']

export function salesMetricCsv(amount: number, cogs: number, totalAmount: number): CsvCell[] {
  const margin = amount - cogs
  return [amount, Math.round(ratio(amount, totalAmount) * 10) / 10, cogs, margin, Math.round(ratio(margin, amount) * 10) / 10]
}

export function CostMissingNote({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <p className="px-5 py-3 text-xs text-text-muted">
      Some sales here predate moving average costing and carry no cost, so their COGS counts as zero and margins are
      overstated for those lines.
    </p>
  )
}

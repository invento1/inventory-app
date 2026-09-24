import { formatDate } from './dates'
import type { CsvRow } from './csv'
import { Cell, MoneyTd, ReportLink, Row, TotalRow } from './ReportParts'
import { referenceLabel, referencePath } from './references'
import type { LedgerAccountBlock } from './api'

export const LEDGER_COLUMNS = ['Date', 'Entry', 'Source', 'Name', 'Memo', 'Debit', 'Credit', 'Balance']

// Opening row, one row per journal line with running balance, closing row --
// shared by General Ledger (one block per account) and Account Statement.
export function LedgerBlockRows({ block, symbol }: { block: LedgerAccountBlock; symbol: string }) {
  return (
    <>
      <Row className="bg-surface-muted/60 print:bg-transparent">
        <Cell colSpan={7} className="text-text-muted">
          Opening balance
        </Cell>
        <MoneyTd value={block.opening} symbol={symbol} />
      </Row>
      {block.lines.map((line) => {
        const path = referencePath(line.reference_type, line.reference_id)
        const source = referenceLabel(line.reference_type)
        return (
          <Row key={line.line_id}>
            <Cell className="whitespace-nowrap">{formatDate(line.entry_date)}</Cell>
            <Cell className="whitespace-nowrap text-text-muted">{line.entry_number}</Cell>
            <Cell className="whitespace-nowrap">{path ? <ReportLink to={path}>{source}</ReportLink> : source}</Cell>
            <Cell>{line.line_name}</Cell>
            <Cell className="text-text-muted">{line.memo}</Cell>
            <MoneyTd value={line.debit} symbol={symbol} blankZero />
            <MoneyTd value={line.credit} symbol={symbol} blankZero />
            <MoneyTd value={line.running_balance} symbol={symbol} />
          </Row>
        )
      })}
      <TotalRow>
        <Cell colSpan={5}>Closing balance</Cell>
        <MoneyTd value={block.totalDebit} symbol={symbol} />
        <MoneyTd value={block.totalCredit} symbol={symbol} />
        <MoneyTd value={block.closing} symbol={symbol} />
      </TotalRow>
    </>
  )
}

export function ledgerBlockCsv(block: LedgerAccountBlock): CsvRow[] {
  return [
    ['Opening balance', '', '', '', '', '', '', block.opening],
    ...block.lines.map((l): CsvRow => [
      l.entry_date,
      l.entry_number,
      referenceLabel(l.reference_type),
      l.line_name,
      l.memo,
      l.debit || null,
      l.credit || null,
      l.running_balance,
    ]),
    ['Closing balance', '', '', '', '', block.totalDebit, block.totalCredit, block.closing],
  ]
}

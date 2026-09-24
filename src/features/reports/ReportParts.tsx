import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/currency'

// Cells inherit the body text color (no text-text here) so a caller's
// className color, e.g. text-danger-600, always wins -- cn() is plain clsx.

// Right-aligned money cell. blankZero leaves debit/credit style columns empty
// instead of printing $0 on every other line.
export function MoneyTd({
  value,
  symbol,
  blankZero = false,
  className,
}: {
  value: number | null | undefined
  symbol: string
  blankZero?: boolean
  className?: string
}) {
  const v = value ?? 0
  return (
    <td className={cn('px-4 py-2.5 text-right tabular-nums whitespace-nowrap', className)}>
      {blankZero && Math.round(v * 100) === 0 ? '' : formatMoney(v, symbol)}
    </td>
  )
}

export function NumTd({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <td className={cn('px-4 py-2.5 text-right tabular-nums whitespace-nowrap', className)}>
      {(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
    </td>
  )
}

export function Cell({
  children,
  className,
  indent = false,
  colSpan,
}: {
  children?: ReactNode
  className?: string
  indent?: boolean
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={cn('py-2.5 pr-4', indent ? 'pl-8' : 'pl-4', className)}>
      {children}
    </td>
  )
}

export function HeadCell({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={cn('px-4 py-3 font-medium whitespace-nowrap', right && 'text-right', className)}>{children}</th>
  )
}

export function ReportTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-text-muted">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('border-b border-border/60', className)}>{children}</tr>
}

// Group heading inside a report table (e.g. "Current Assets", an account name).
export function SectionRow({ label, colSpan, className }: { label: ReactNode; colSpan: number; className?: string }) {
  return (
    <tr className={cn('border-b border-border bg-surface-muted print:bg-transparent', className)}>
      <td colSpan={colSpan} className="px-4 py-2 text-sm font-semibold text-text">
        {label}
      </td>
    </tr>
  )
}

export function TotalRow({ children, grand = false }: { children: ReactNode; grand?: boolean }) {
  return (
    <tr className={cn('font-semibold', grand ? 'border-t-2 border-text/70 border-b-4 border-double' : 'border-t border-border')}>
      {children}
    </tr>
  )
}

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-text-muted">
        {message}
      </td>
    </tr>
  )
}

// Link that prints as plain text.
export function ReportLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-accent-700 hover:underline print:text-text print:no-underline">
      {children}
    </Link>
  )
}

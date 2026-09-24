import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-surface shadow-card transition-shadow duration-200 hover:shadow-card-hover', className)}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  action,
  subtitle,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-text">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// Default p-5, dropped on whichever axis the caller sets its own padding --
// cn() is plain clsx (no tailwind-merge), so 'p-5' + 'p-0' would otherwise
// both apply and stylesheet order, not intent, would pick the winner (this is
// what kept p-0 table cards from going edge-to-edge).
export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const cls = className ?? ''
  const all = /(^|\s)p-/.test(cls)
  const x = /(^|\s)(px|pl|pr)-/.test(cls)
  const y = /(^|\s)(py|pt|pb)-/.test(cls)
  const base = all || (x && y) ? '' : x ? 'py-5' : y ? 'px-5' : 'p-5'
  return <div className={cn(base, className)} {...props} />
}

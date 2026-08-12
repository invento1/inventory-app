import type { ReactNode } from 'react'

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-text-muted">
        {children}
      </tr>
    </thead>
  )
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-text ${className}`}>{children}</td>
}

export function Tr({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-border last:border-0 ${onClick ? 'cursor-pointer hover:bg-surface-muted' : ''} ${className}`}
    >
      {children}
    </tr>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <tr>
      <td colSpan={100} className="px-4 py-10 text-center text-sm text-text-muted">
        {message}
      </td>
    </tr>
  )
}

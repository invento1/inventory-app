import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-accent-600 text-white hover:bg-accent-700 focus-visible:outline-accent-600 disabled:bg-accent-300',
  secondary:
    'bg-white text-text border border-border hover:bg-surface-muted focus-visible:outline-accent-600 disabled:text-text-muted',
  ghost:
    'bg-transparent text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-accent-600',
  danger:
    'bg-danger-600 text-white hover:bg-red-700 focus-visible:outline-danger-600 disabled:bg-red-300',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  )
}

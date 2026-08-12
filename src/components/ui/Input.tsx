import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className, id, ...props },
  ref,
) {
  const inputId = id ?? props.name
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label && (
        <span className="font-medium text-text">
          {label}
          {props.required && <span className="text-danger-600"> *</span>}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'h-10 rounded-lg border border-border bg-white px-3 text-sm text-text placeholder:text-text-muted',
          'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
          'disabled:bg-surface-muted disabled:text-text-muted',
          error && 'border-danger-600 focus:ring-danger-600 focus:border-danger-600',
          className,
        )}
        {...props}
      />
      {error && <span className="text-xs text-danger-600">{error}</span>}
    </label>
  )
})

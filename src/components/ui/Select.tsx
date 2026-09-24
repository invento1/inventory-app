import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { fieldBase, fieldError } from './fieldStyles'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, className, id, children, ...props },
  ref,
) {
  const selectId = id ?? props.name
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label && (
        <span className="font-medium text-text">
          {label}
          {props.required && <span className="text-danger-600"> *</span>}
        </span>
      )}
      <select
        ref={ref}
        id={selectId}
        className={cn(
          'h-10 px-3',
          fieldBase,
          error && fieldError,
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error && <span className="text-xs text-danger-600">{error}</span>}
    </label>
  )
})

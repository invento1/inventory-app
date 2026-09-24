import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { fieldBase, fieldError } from './fieldStyles'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  endAdornment?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className, id, endAdornment, ...props },
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
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-10 w-full px-3',
            fieldBase,
            error && fieldError,
            endAdornment && 'pr-10',
            className,
          )}
          {...props}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">{endAdornment}</div>
        )}
      </div>
      {error && <span className="text-xs text-danger-600">{error}</span>}
    </label>
  )
})

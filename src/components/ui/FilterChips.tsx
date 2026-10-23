import { cn } from '../../lib/cn'

// A row of pill buttons for picking one filter value (e.g. a status).
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
            value === o.value
              ? 'border-accent-600 bg-accent-50 text-accent-700'
              : 'border-border text-text-muted hover:bg-surface-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

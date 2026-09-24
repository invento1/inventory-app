import { useId } from 'react'
import { cn } from '../../lib/cn'

// Decorative tinted wave tucked into a card's bottom-right corner (the
// dashboard stat tiles). Draws in currentColor, so the caller sets the hue with
// a text colour class, e.g. "text-success-600"; the gradient keeps it a faint
// pastel wash. The parent must be `relative overflow-hidden`, and content that
// should sit above it `relative`.
export function CornerWave({ className }: { className?: string }) {
  const gradientId = useId()
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 90"
      preserveAspectRatio="none"
      className={cn('pointer-events-none absolute bottom-0 right-0 h-14 w-28', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="15%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <path d="M160 8 C 118 14, 104 58, 58 70 C 34 76, 14 84, 0 90 L160 90 Z" fill={`url(#${gradientId})`} />
      <path
        d="M160 38 C 128 44, 112 70, 76 82 C 62 86, 50 89, 40 90 L160 90 Z"
        fill={`url(#${gradientId})`}
        opacity="0.8"
      />
    </svg>
  )
}

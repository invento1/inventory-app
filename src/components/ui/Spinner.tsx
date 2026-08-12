import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-accent-600', className)} size={20} />
}

export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

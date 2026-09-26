import { useRef, type ChangeEvent } from 'react'
import { Check, Moon, Printer, Sun, type LucideIcon } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { LiquidFill } from '../../components/ui/LiquidFill'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useUserPreference } from '../../lib/userPreferences'
import { applyTheme, THEME_PREFERENCE_KEY, useTheme, type Theme } from '../../lib/theme'

interface ThemeOption {
  value: Theme
  name: string
  icon: LucideIcon
  description: string
}

const OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    name: 'Light',
    icon: Sun,
    description: 'Clean slate and indigo on bright white. The classic HashirHub look.',
  },
  {
    value: 'dark',
    name: 'Dark',
    icon: Moon,
    description:
      'Midnight Harbour: deep navy panels, glowing indigo and a sea that shines at night. Easier on the eyes in low light.',
  },
]

// Settings -> Appearance. Personal: every member can open it, and the choice
// is saved to their own account (user_preferences), so it follows them to
// other devices. Each option shows a live miniature of the app rendered in
// that theme (the .theme-light / .theme-dark scopes in index.css).
export function AppearancePage() {
  const theme = useTheme()
  const preference = useUserPreference<Theme>(THEME_PREFERENCE_KEY)
  const toast = useToast()

  // Where the pointer went down, so the reveal grows from the click. Keyboard
  // selection (arrow keys) has no pointer: the reveal grows from the card.
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null)

  function choose(value: Theme, e: ChangeEvent<HTMLInputElement>) {
    if (value === theme) return
    const recent = pointer.current && Date.now() - pointer.current.at < 1000 ? pointer.current : null
    const rect = (e.currentTarget.closest('label') ?? e.currentTarget).getBoundingClientRect()
    applyTheme(value, recent ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    pointer.current = null
    preference.save(value).catch(() => toast.error('Couldn’t save your choice to your account. It’s kept on this device.'))
  }

  return (
    <div>
      <PageHeader
        title="Appearance"
        subtitle="How HashirHub looks for you. Saved to your account, so it follows you to every device."
      />

      <Card>
        <CardBody className="flex flex-col gap-5">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {OPTIONS.map((option) => {
              const selected = theme === option.value
              return (
                <label
                  key={option.value}
                  onPointerDown={(e) => (pointer.current = { x: e.clientX, y: e.clientY, at: Date.now() })}
                  className={cn(
                    'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border transition-all duration-200',
                    'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-600',
                    selected
                      ? 'border-accent-600 shadow-card-hover ring-1 ring-accent-600'
                      : 'border-border hover:border-border-strong hover:shadow-card-hover',
                  )}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={selected}
                    onChange={(e) => choose(option.value, e)}
                    className="sr-only"
                  />
                  <ThemePreview theme={option.value} />
                  <div className="flex items-start gap-3 border-t border-border bg-surface px-4 py-3.5">
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                        selected ? 'bg-accent-50 text-accent-700' : 'bg-surface-muted text-text-muted',
                      )}
                    >
                      <option.icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-text">{option.name}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{option.description}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        selected ? 'border-accent-600 bg-accent-600 text-surface' : 'border-border-strong',
                      )}
                    >
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                  </div>
                </label>
              )
            })}
          </div>

          <p className="flex items-center gap-2 text-xs text-text-muted">
            <Printer size={14} className="shrink-0 text-text-subtle" />
            Printed invoices, receipts and reports always come out in the light theme, on white paper.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

// A miniature of the app (sidebar, header, stat tiles, a table and a button)
// drawn with the real tokens inside a theme scope, so it's an honest preview.
function ThemePreview({ theme }: { theme: Theme }) {
  const tiles = [
    { label: 'Sales today', value: '16', tone: 'text-success-600', chip: 'bg-success-50' },
    { label: 'Revenue', value: 'Rs20.5k', tone: 'text-accent-700', chip: 'bg-accent-50' },
    { label: 'Low stock', value: '4', tone: 'text-warning-600', chip: 'bg-warning-50' },
  ]
  const rows = [
    { name: 'INV-000012', badge: 'Unpaid', tone: 'bg-warning-50 text-warning-600' },
    { name: 'INV-000011', badge: 'Paid', tone: 'bg-success-50 text-success-600' },
    { name: 'INV-000010', badge: 'Overdue', tone: 'bg-danger-50 text-danger-600' },
  ]

  return (
    <div
      aria-hidden="true"
      className={cn(
        theme === 'dark' ? 'theme-dark' : 'theme-light',
        'app-canvas relative flex h-52 select-none bg-canvas text-text sm:h-56',
      )}
    >
      {/* Sidebar */}
      <div className="flex w-[22%] flex-col gap-1.5 border-r border-border bg-surface/60 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded bg-primary" />
          <span className="h-1.5 w-10 rounded-full bg-text/70" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              'relative flex items-center gap-1.5 rounded-md px-1.5 py-1',
              i === 1 && 'bg-accent-50 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-accent-600',
            )}
          >
            <span className={cn('h-2 w-2 rounded-sm', i === 1 ? 'bg-accent-600' : 'bg-text-subtle/60')} />
            <span className={cn('h-1 rounded-full', i === 1 ? 'w-9 bg-accent-700' : 'w-7 bg-text-subtle/50')} />
          </div>
        ))}
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-7 items-center justify-between gap-2 border-b border-border bg-surface px-2.5">
          <span className="h-3.5 w-24 rounded-md border border-border-strong bg-field" />
          <span className="h-1.5 w-8 rounded-full bg-text-subtle/60" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-2.5">
          <div className="flex items-center justify-between">
            <span className="h-2 w-16 rounded-full bg-text/80" />
            <span className="rounded-md bg-primary px-2 py-0.5 text-[8px] font-medium text-white shadow-button">New sale</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {tiles.map((t) => (
              <div
                key={t.label}
                className="relative overflow-hidden rounded-md border border-border bg-surface p-1.5 shadow-card"
              >
                <LiquidFill className={t.tone} />
                <div className="relative z-10 flex flex-col items-center gap-0.5">
                  <span className={cn('h-3 w-3 rounded', t.chip)} />
                  <span className="text-[7px] leading-none text-text-muted">{t.label}</span>
                  <span className="text-[10px] font-semibold leading-tight text-text">{t.value}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-hidden rounded-md border border-border bg-surface shadow-card">
            <div className="flex h-3.5 items-center bg-surface-muted/80 px-2">
              <span className="h-1 w-8 rounded-full bg-text-muted/60" />
            </div>
            {rows.map((r) => (
              <div key={r.name} className="flex items-center justify-between border-t border-divider px-2 py-[3px]">
                <span className="text-[7px] font-medium text-text">{r.name}</span>
                <span className={cn('rounded-full px-1.5 text-[6.5px] font-medium leading-[11px]', r.tone)}>{r.badge}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

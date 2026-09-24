import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

// Reports work in local calendar dates ('YYYY-MM-DD'), never toISOString(),
// which would shift the day for anyone east or west of UTC around midnight.
export function ymd(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function parseYmd(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const date = value.length === 10 ? parseYmd(value) : new Date(value)
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// "All dates" still needs concrete bounds for the RPCs.
const ALL_START = '2000-01-01'

export const RANGE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'this-month-to-date', label: 'This month-to-date' },
  { value: 'this-quarter', label: 'This quarter' },
  { value: 'this-year', label: 'This year' },
  { value: 'this-year-to-date', label: 'This year-to-date' },
  { value: 'last-week', label: 'Last week' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-quarter', label: 'Last quarter' },
  { value: 'last-year', label: 'Last year' },
  { value: 'custom', label: 'Custom' },
] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]['value']

export const AS_OF_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'end-of-last-month', label: 'End of last month' },
  { value: 'end-of-last-quarter', label: 'End of last quarter' },
  { value: 'end-of-last-year', label: 'End of last year' },
  { value: 'custom', label: 'Custom' },
] as const

export type AsOfPreset = (typeof AS_OF_PRESETS)[number]['value']

function addDays(d: Date, days: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
}

// Weeks start on Monday, matching Postgres date_trunc('week') used by the dashboard.
function startOfWeek(d: Date) {
  return addDays(d, -((d.getDay() + 6) % 7))
}

function startOfQuarter(d: Date) {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
}

export function rangeForPreset(preset: RangePreset, now = new Date()): { start: string; end: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (preset) {
    case 'all':
      return { start: ALL_START, end: ymd(today) }
    case 'today':
      return { start: ymd(today), end: ymd(today) }
    case 'this-week': {
      const start = startOfWeek(today)
      return { start: ymd(start), end: ymd(addDays(start, 6)) }
    }
    case 'this-month':
      return { start: ymd(new Date(y, m, 1)), end: ymd(new Date(y, m + 1, 0)) }
    case 'this-quarter': {
      const start = startOfQuarter(today)
      return { start: ymd(start), end: ymd(new Date(start.getFullYear(), start.getMonth() + 3, 0)) }
    }
    case 'this-year':
      return { start: ymd(new Date(y, 0, 1)), end: ymd(new Date(y, 11, 31)) }
    case 'this-year-to-date':
      return { start: ymd(new Date(y, 0, 1)), end: ymd(today) }
    case 'last-week': {
      const start = addDays(startOfWeek(today), -7)
      return { start: ymd(start), end: ymd(addDays(start, 6)) }
    }
    case 'last-month':
      return { start: ymd(new Date(y, m - 1, 1)), end: ymd(new Date(y, m, 0)) }
    case 'last-quarter': {
      const thisQuarter = startOfQuarter(today)
      const start = new Date(thisQuarter.getFullYear(), thisQuarter.getMonth() - 3, 1)
      return { start: ymd(start), end: ymd(addDays(thisQuarter, -1)) }
    }
    case 'last-year':
      return { start: ymd(new Date(y - 1, 0, 1)), end: ymd(new Date(y - 1, 11, 31)) }
    case 'this-month-to-date':
    case 'custom':
    default:
      return { start: ymd(new Date(y, m, 1)), end: ymd(today) }
  }
}

export function asOfForPreset(preset: AsOfPreset, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (preset) {
    case 'end-of-last-month':
      return ymd(new Date(today.getFullYear(), today.getMonth(), 0))
    case 'end-of-last-quarter':
      return ymd(addDays(startOfQuarter(today), -1))
    case 'end-of-last-year':
      return ymd(new Date(today.getFullYear() - 1, 11, 31))
    default:
      return ymd(today)
  }
}

export interface DateRangeState {
  preset: RangePreset
  start: string
  end: string
  valid: boolean
  label: string
  setPreset: (preset: RangePreset) => void
  setStart: (value: string) => void
  setEnd: (value: string) => void
}

// Initial dates can come from ?from=&to= so a drill-down link (e.g. Balance
// Sheet -> Account Statement) opens on the matching period.
export function useDateRange(initial: RangePreset = 'this-month-to-date'): DateRangeState {
  const [params] = useSearchParams()
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const hasParams = !!(fromParam || toParam)

  const [preset, setPresetState] = useState<RangePreset>(hasParams ? 'custom' : initial)
  const [range, setRange] = useState(() =>
    hasParams ? { start: fromParam ?? ALL_START, end: toParam ?? ymd(new Date()) } : rangeForPreset(initial),
  )

  const valid = !!range.start && !!range.end && range.start <= range.end
  const label =
    preset === 'all' ? 'All dates' : `${formatDate(range.start)} – ${formatDate(range.end)}`

  return {
    preset,
    start: range.start,
    end: range.end,
    valid,
    label,
    setPreset: (p) => {
      setPresetState(p)
      if (p !== 'custom') setRange(rangeForPreset(p))
    },
    setStart: (value) => {
      setPresetState('custom')
      setRange((r) => ({ ...r, start: value }))
    },
    setEnd: (value) => {
      setPresetState('custom')
      setRange((r) => ({ ...r, end: value }))
    },
  }
}

export interface AsOfState {
  preset: AsOfPreset
  asOf: string
  valid: boolean
  label: string
  setPreset: (preset: AsOfPreset) => void
  setAsOf: (value: string) => void
}

export function useAsOfDate(): AsOfState {
  const [params] = useSearchParams()
  const asOfParam = params.get('asOf')
  const [preset, setPresetState] = useState<AsOfPreset>(asOfParam ? 'custom' : 'today')
  const [asOf, setAsOfState] = useState(asOfParam ?? asOfForPreset('today'))

  return {
    preset,
    asOf,
    valid: !!asOf,
    label: `As of ${formatDate(asOf)}`,
    setPreset: (p) => {
      setPresetState(p)
      if (p !== 'custom') setAsOfState(asOfForPreset(p))
    },
    setAsOf: (value) => {
      setPresetState('custom')
      setAsOfState(value)
    },
  }
}

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { todayYmd } from './dates'

// Shared filters for the Invoices and Supplier Bills lists. They live in the
// URL (?status=overdue&party=...), so the dashboard tiles can link straight
// to a filtered view and Back returns to the same filters.

export type DocStatusFilter = 'all' | 'open' | 'overdue' | 'unpaid' | 'partially_paid' | 'paid' | 'void'

export const STATUS_FILTERS: { value: DocStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]

export type DocSort = 'newest' | 'oldest' | 'due' | 'balance'

export const SORT_OPTIONS: { value: DocSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'due', label: 'Due date (soonest)' },
  { value: 'balance', label: 'Balance (largest)' },
]

export interface DocumentListFilters {
  status: DocStatusFilter
  // Customer or supplier id ('' = everyone).
  party: string
  // Sales rep id, 'none' for no rep, '' = everyone (invoices only).
  rep: string
  from: string
  to: string
  q: string
  sort: DocSort
}

const DEFAULTS: DocumentListFilters = { status: 'all', party: '', rep: '', from: '', to: '', q: '', sort: 'newest' }

export function useDocumentListFilters() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo<DocumentListFilters>(() => {
    const status = params.get('status') as DocStatusFilter | null
    const sort = params.get('sort') as DocSort | null
    return {
      status: status && STATUS_FILTERS.some((s) => s.value === status) ? status : DEFAULTS.status,
      party: params.get('party') ?? '',
      rep: params.get('rep') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      q: params.get('q') ?? '',
      sort: sort && SORT_OPTIONS.some((s) => s.value === sort) ? sort : DEFAULTS.sort,
    }
  }, [params])

  const setFilter = useCallback(
    <K extends keyof DocumentListFilters>(key: K, value: DocumentListFilters[K]) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === DEFAULTS[key] || value === '') next.delete(key)
          else next.set(key, String(value))
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams])
  const isFiltered = (Object.keys(DEFAULTS) as (keyof DocumentListFilters)[]).some(
    (k) => k !== 'sort' && filters[k] !== DEFAULTS[k],
  )

  return { filters, setFilter, clear, isFiltered }
}

// Open = not paid and not void. Dates are compared as local YYYY-MM-DD
// strings, so "today" is the user's calendar day, not UTC's.
export function isOverdue(doc: { status: string; due_date: string }) {
  return (doc.status === 'unpaid' || doc.status === 'partially_paid') && doc.due_date < todayYmd()
}

export function daysOverdue(dueDate: string) {
  const [y, m, d] = dueDate.split('-').map(Number)
  const [ty, tm, td] = todayYmd().split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000)
}

// For ilike: match the typed text literally.
export function likePattern(text: string) {
  return `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

// What's still owed: total less payments and (invoices) credits applied.
export function openBalance(row: { total: number; amount_paid: number; amount_credited?: number }) {
  return row.total - row.amount_paid - (row.amount_credited ?? 0)
}

export function sortDocuments<T extends { created_at: string; due_date: string; total: number; amount_paid: number; amount_credited?: number }>(
  rows: T[],
  sort: DocSort,
): T[] {
  const copy = [...rows]
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => a.created_at.localeCompare(b.created_at))
    case 'due':
      return copy.sort((a, b) => a.due_date.localeCompare(b.due_date))
    case 'balance':
      return copy.sort((a, b) => openBalance(b) - openBalance(a))
    default:
      return copy.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
}

// How many rows a filtered list loads; past this the page asks for a
// narrower filter rather than silently dropping older documents.
export const DOCUMENT_LIST_LIMIT = 500

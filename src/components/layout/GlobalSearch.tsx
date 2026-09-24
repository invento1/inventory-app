import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/currency'
import { cn } from '../../lib/cn'
import { fieldBase } from '../ui/fieldStyles'

// Header search, modelled on the original HashirHub top-bar search: type 2+
// characters, results drop down after a short pause (type · number / name ·
// date / amount), click one to open it. Backed by the global_search RPC
// (documents by number / party name, plus customers, suppliers, items).
// Keyboard: Ctrl/Cmd+K or "/" focuses it, arrows move, Enter opens, Esc
// closes. Below sm it collapses to an icon that opens a full-width bar.

type Kind =
  | 'invoice'
  | 'sales_receipt'
  | 'supplier_bill'
  | 'purchase_order'
  | 'quotation'
  | 'credit_memo'
  | 'expense'
  | 'refund'
  | 'customer'
  | 'supplier'
  | 'item'

interface SearchRow {
  kind: string
  id: string
  title: string
  subtitle: string | null
  txn_date: string | null
  amount: number | null
}

const KINDS: Record<Kind, { label: string; href: (r: SearchRow) => string }> = {
  invoice: { label: 'Invoice', href: (r) => `/invoices/${r.id}` },
  sales_receipt: { label: 'Receipt', href: (r) => `/sales/${r.id}` },
  supplier_bill: { label: 'Bill', href: (r) => `/supplier-bills/${r.id}` },
  purchase_order: { label: 'Purchase order', href: (r) => `/purchase-orders/${r.id}` },
  quotation: { label: 'Quotation', href: (r) => `/quotations/${r.id}` },
  credit_memo: { label: 'Credit memo', href: (r) => `/credit-memos/${r.id}` },
  expense: { label: 'Expense', href: () => '/expenses' },
  refund: { label: 'Refund', href: () => '/refunds' },
  customer: { label: 'Customer', href: (r) => `/reports/customer-statement?customer=${r.id}` },
  supplier: { label: 'Supplier', href: (r) => `/reports/supplier-statement?supplier=${r.id}` },
  item: {
    label: 'Item',
    href: (r) => `/items/search?q=${encodeURIComponent(r.subtitle ?? r.title)}&item=${r.id}`,
  },
}

const MIN_CHARS = 2
const DEBOUNCE_MS = 250

function shortDate(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function GlobalSearch() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)

  const query = text.trim()
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const enabled = debounced.length >= MIN_CHARS
  const { data, isFetching, error } = useQuery({
    queryKey: ['global_search', orgId, debounced],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('global_search', { p_org_id: orgId, p_query: debounced })
      if (error) throw error
      return (data ?? []) as SearchRow[]
    },
  })
  const rows = (enabled && debounced === query ? data : undefined) ?? []
  const searching = query.length >= MIN_CHARS && (debounced !== query || isFetching)

  useEffect(() => setActive(0), [debounced])

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Ctrl/Cmd+K anywhere, or "/" when not already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        setMobileOpen(true)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function close() {
    setOpen(false)
    setMobileOpen(false)
    inputRef.current?.blur()
  }

  function go(row: SearchRow) {
    const kind = KINDS[row.kind as Kind]
    if (!kind) return
    setText('')
    setDebounced('')
    close()
    navigate(kind.href(row))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (text) setText('')
      else close()
    } else if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % rows.length)
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault()
      setActive((i) => (i - 1 + rows.length) % rows.length)
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault()
      go(rows[active])
    }
  }

  const showPanel = open && query.length >= MIN_CHARS

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMobileOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        aria-label="Search"
        className="rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-muted hover:text-text sm:hidden"
      >
        <Search size={20} />
      </button>

      <div
        ref={wrapperRef}
        className={cn(
          mobileOpen
            ? 'fixed inset-x-0 top-0 z-50 flex h-16 items-center gap-2 border-b border-border bg-surface px-3 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-0'
            : 'hidden sm:block',
          'w-full sm:relative sm:max-w-[520px]',
        )}
      >
        <div className="relative w-full">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
          />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={showPanel && rows[active] ? `${listboxId}-${active}` : undefined}
            aria-label="Search invoices, bills, receipts, customers, and items"
            autoComplete="off"
            placeholder="Find invoices, bills, receipts, customers, items…"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(fieldBase, 'h-9 w-full pl-9 pr-3 sm:pr-14 [&::-webkit-search-cancel-button]:hidden')}
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-text-subtle sm:block">
            Ctrl K
          </kbd>

          {showPanel && (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-card-hover motion-safe:animate-fade-in">
              {error ? (
                <p className="px-3.5 py-3 text-sm text-danger-600">
                  {error instanceof Error ? error.message : 'Search failed.'}
                </p>
              ) : searching && rows.length === 0 ? (
                <p className="px-3.5 py-3 text-sm text-text-muted">Searching…</p>
              ) : rows.length === 0 ? (
                <p className="px-3.5 py-3 text-sm text-text-muted">No matches for “{query}”</p>
              ) : (
                <ul id={listboxId} role="listbox" className="divide-y divide-divider">
                  {rows.map((row, i) => {
                    const kind = KINDS[row.kind as Kind]
                    const meta = [
                      row.txn_date ? shortDate(row.txn_date) : null,
                      row.amount != null && row.kind !== 'customer' && row.kind !== 'supplier'
                        ? formatMoney(row.amount, currencySymbol)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <li
                        key={`${row.kind}-${row.id}`}
                        id={`${listboxId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go(row)}
                        className={cn(
                          'grid cursor-pointer grid-cols-[92px_1fr] items-center gap-x-2.5 gap-y-0.5 px-3.5 py-2.5 sm:grid-cols-[110px_1fr_auto]',
                          i === active ? 'bg-accent-50' : 'hover:bg-surface-muted',
                        )}
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                          {kind?.label ?? row.kind}
                        </span>
                        <span className="min-w-0 truncate text-sm text-text">
                          <strong className="font-semibold">{row.title}</strong>
                          {row.subtitle && <span className="text-text-muted"> · {row.subtitle}</span>}
                        </span>
                        {meta && (
                          <span className="col-start-2 whitespace-nowrap text-xs text-text-muted sm:col-start-auto">
                            {meta}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        {mobileOpen && (
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="shrink-0 rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-muted hover:text-text sm:hidden"
          >
            <X size={20} />
          </button>
        )}
      </div>
    </>
  )
}

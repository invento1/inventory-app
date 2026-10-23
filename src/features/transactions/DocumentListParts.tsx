import { Search, X } from 'lucide-react'
import { Card, CardBody } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Autocomplete } from '../../components/ui/Autocomplete'
import { FilterChips } from '../../components/ui/FilterChips'
import { Button } from '../../components/ui/Button'
import { fieldBase } from '../../components/ui/fieldStyles'
import { formatMoney } from '../../lib/currency'
import {
  SORT_OPTIONS,
  STATUS_FILTERS,
  type DocSort,
  type DocStatusFilter,
  type DocumentListFilters,
} from '../../lib/documentListFilters'

// Filter bar and totals strip shared by the Invoices and Supplier Bills lists.

interface Party {
  id: string
  name: string
}

const partyKey = (p: Party) => p.id
const partyLabel = (p: Party) => p.name

export function DocumentFilterBar({
  filters,
  setFilter,
  clear,
  isFiltered,
  numberLabel,
  partyLabel: partyFieldLabel,
  parties,
  reps,
}: {
  filters: DocumentListFilters
  setFilter: <K extends keyof DocumentListFilters>(key: K, value: DocumentListFilters[K]) => void
  clear: () => void
  isFiltered: boolean
  numberLabel: string
  partyLabel: string
  parties: Party[]
  // Invoices only: the sales rep filter.
  reps?: { id: string; name: string }[]
}) {
  return (
    <Card className="mb-4">
      <CardBody className="flex flex-col gap-4">
        {/* Two per row on phones (dates, rep, sort side by side) so the list
            isn't pushed off the first screen. */}
        <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${reps ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
          <label className="col-span-2 flex flex-col gap-1.5 text-sm lg:col-span-1">
            <span className="font-medium text-text">Search</span>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input
                type="search"
                value={filters.q}
                onChange={(e) => setFilter('q', e.target.value)}
                placeholder={numberLabel}
                className={`h-10 w-full pl-9 pr-3 ${fieldBase}`}
              />
            </div>
          </label>
          <div className="col-span-2 lg:col-span-1">
            <Autocomplete
              label={partyFieldLabel}
              items={parties}
              getKey={partyKey}
              getLabel={partyLabel}
              getSearchText={partyLabel}
              value={filters.party}
              onChange={(id) => setFilter('party', id)}
              placeholder={`All ${partyFieldLabel.toLowerCase()}s`}
              emptyText="No matches"
            />
          </div>
          {reps && (
            <Select label="Sales rep" value={filters.rep} onChange={(e) => setFilter('rep', e.target.value)}>
              <option value="">All reps</option>
              <option value="none">No rep</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
          <div className={reps ? 'lg:order-last' : 'col-span-2 lg:order-last lg:col-span-1'}>
            <Select label="Sort" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value as DocSort)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <Input label="Issued from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          <Input label="Issued to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips<DocStatusFilter>
            label="Status"
            options={STATUS_FILTERS}
            value={filters.status}
            onChange={(v) => setFilter('status', v)}
          />
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X size={14} />
              Clear filters
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

// "12 invoices · Total Rs… · Outstanding Rs… · 3 overdue (Rs…)" for what's shown.
export function DocumentTotals({
  rows,
  noun,
  symbol,
  isOverdue,
  truncated,
  limit,
}: {
  rows: { status: string; due_date: string; total: number; amount_paid: number }[]
  noun: string
  symbol: string
  isOverdue: (row: { status: string; due_date: string }) => boolean
  truncated: boolean
  limit: number
}) {
  const live = rows.filter((r) => r.status !== 'void')
  const total = live.reduce((s, r) => s + r.total, 0)
  const outstanding = live.reduce((s, r) => s + (r.total - r.amount_paid), 0)
  const overdue = live.filter(isOverdue)
  const overdueAmount = overdue.reduce((s, r) => s + (r.total - r.amount_paid), 0)

  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 px-1 text-sm">
      <span className="text-text-muted">
        <span className="font-semibold text-text">{rows.length}</span> {noun}
        {rows.length === 1 ? '' : 's'}
      </span>
      <span className="text-text-muted">
        Total <span className="font-semibold tabular-nums text-text">{formatMoney(total, symbol)}</span>
      </span>
      <span className="text-text-muted">
        Outstanding <span className="font-semibold tabular-nums text-text">{formatMoney(outstanding, symbol)}</span>
      </span>
      {overdue.length > 0 && (
        <span className="text-danger-600">
          <span className="font-semibold">{overdue.length}</span> overdue ·{' '}
          <span className="font-semibold tabular-nums">{formatMoney(overdueAmount, symbol)}</span>
        </span>
      )}
      {truncated && (
        <span className="text-warning-600">Showing the latest {limit}; narrow the filters to see older ones.</span>
      )}
    </div>
  )
}

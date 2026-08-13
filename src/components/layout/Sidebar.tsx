import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  Briefcase,
  Settings,
  Landmark,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/cn'

type NavLeaf = { type: 'leaf'; to: string; label: string }
type NavChild = NavLeaf | { type: 'group'; key: string; label: string; children: NavLeaf[] }

type NavEntry =
  | { type: 'leaf'; to: string; label: string; icon: LucideIcon; end?: boolean }
  | { type: 'group'; key: string; label: string; icon: LucideIcon; children: NavChild[] }

const navEntries: NavEntry[] = [
  { type: 'leaf', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  {
    type: 'group',
    key: 'items',
    label: 'Items',
    icon: Package,
    children: [
      { type: 'leaf', to: '/items/list', label: 'Item List' },
      { type: 'leaf', to: '/items/new', label: 'New Item' },
      { type: 'leaf', to: '/items/search', label: 'Search Item' },
      { type: 'leaf', to: '/items/price-manager', label: 'Price Manager' },
    ],
  },
  {
    type: 'group',
    key: 'business-hub',
    label: 'Business Hub',
    icon: Briefcase,
    children: [
      { type: 'leaf', to: '/stock', label: 'Stock' },
      { type: 'leaf', to: '/suppliers', label: 'Suppliers' },
      { type: 'leaf', to: '/purchase-orders', label: 'Purchase Orders' },
      { type: 'leaf', to: '/customers', label: 'Customers' },
      { type: 'leaf', to: '/sales', label: 'Sales Receipt' },
      { type: 'leaf', to: '/invoices', label: 'Invoices' },
      { type: 'leaf', to: '/supplier-bills', label: 'Supplier Bills' },
      { type: 'leaf', to: '/transactions', label: 'All Transactions' },
      { type: 'leaf', to: '/inventory-transfers', label: 'Inventory Transfer' },
      { type: 'leaf', to: '/inventory-adjustments', label: 'Inventory Adjustment' },
      { type: 'leaf', to: '/expenses', label: 'Expenses' },
      { type: 'leaf', to: '/quotations', label: 'Quotations' },
      { type: 'leaf', to: '/credit-memos', label: 'Credit Memos' },
      { type: 'leaf', to: '/refunds', label: 'Refunds' },
    ],
  },
  {
    type: 'group',
    key: 'account',
    label: 'Account',
    icon: Landmark,
    children: [
      { type: 'leaf', to: '/account/capital-matrix', label: 'Capital Matrix' },
      { type: 'leaf', to: '/account/fiscal-daybook', label: 'Fiscal Daybook' },
      {
        type: 'group',
        key: 'customer-payment',
        label: 'Customer Payment',
        children: [
          { type: 'leaf', to: '/account/receive-payment', label: 'Receive Payment' },
          { type: 'leaf', to: '/account/view-payments', label: 'View Payments' },
          { type: 'leaf', to: '/account/record-deposit', label: 'Record Deposit' },
          { type: 'leaf', to: '/account/view-deposits', label: 'View Deposits' },
        ],
      },
      {
        type: 'group',
        key: 'supplier-payment',
        label: 'Supplier Payment',
        children: [
          { type: 'leaf', to: '/account/pay-bills', label: 'Pay Bills' },
          { type: 'leaf', to: '/account/view-paid-bills', label: 'View Paid Bills' },
        ],
      },
      { type: 'leaf', to: '/account/banking', label: 'Banking' },
    ],
  },
  {
    type: 'group',
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    children: [
      { type: 'leaf', to: '/settings/company-info', label: 'Company Info' },
      { type: 'leaf', to: '/settings/stores', label: 'Stores' },
      { type: 'leaf', to: '/settings/warehouses', label: 'Warehouses' },
      { type: 'leaf', to: '/settings/price-lists', label: 'Price Lists' },
      { type: 'leaf', to: '/settings/categories', label: 'Categories' },
      { type: 'leaf', to: '/settings/brands', label: 'Brands' },
      { type: 'leaf', to: '/settings/units', label: 'Units' },
      { type: 'leaf', to: '/settings/areas', label: 'Regions & Areas' },
      { type: 'leaf', to: '/settings/reset-data', label: 'Reset Data' },
    ],
  },
]

function childMatches(child: NavChild, pathname: string): boolean {
  return child.type === 'leaf'
    ? pathname.startsWith(child.to)
    : child.children.some((leaf) => pathname.startsWith(leaf.to))
}

function findActiveSubGroupKey(children: NavChild[], pathname: string): string | undefined {
  return children.find(
    (c): c is Extract<NavChild, { type: 'group' }> =>
      c.type === 'group' && c.children.some((leaf) => pathname.startsWith(leaf.to)),
  )?.key
}

export function Sidebar() {
  const location = useLocation()

  const activeGroup = navEntries.find(
    (entry): entry is Extract<NavEntry, { type: 'group' }> =>
      entry.type === 'group' && entry.children.some((c) => childMatches(c, location.pathname)),
  )
  const activeSubGroupKey = activeGroup ? findActiveSubGroupKey(activeGroup.children, location.pathname) : undefined

  const [openGroup, setOpenGroup] = useState<string | undefined>(activeGroup?.key)
  const [openSubGroup, setOpenSubGroup] = useState<string | undefined>(activeSubGroupKey)

  function toggleGroup(key: string) {
    setOpenGroup((current) => (current === key ? undefined : key))
  }

  function toggleSubGroup(key: string) {
    setOpenSubGroup((current) => (current === key ? undefined : key))
  }

  const leafClass = (isActive: boolean) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-accent-50 text-accent-700' : 'text-text-muted hover:bg-surface-muted hover:text-text',
    )

  const childLeafClass = (isActive: boolean) =>
    cn(
      'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
      isActive ? 'bg-accent-50 text-accent-700' : 'text-text-muted hover:bg-surface-muted hover:text-text',
    )

  return (
    <aside className="flex h-svh w-60 shrink-0 flex-col border-r border-border bg-white">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-sm font-bold text-white">
          I
        </div>
        <span className="text-sm font-semibold text-text">Inventory</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {navEntries.map((entry) => {
          if (entry.type === 'leaf') {
            return (
              <NavLink key={entry.to} to={entry.to} end={entry.end} className={({ isActive }) => leafClass(isActive)}>
                <entry.icon size={18} />
                {entry.label}
              </NavLink>
            )
          }

          const isOpen = openGroup === entry.key
          const isGroupActive = entry.children.some((c) => childMatches(c, location.pathname))

          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isGroupActive
                    ? 'bg-accent-50 text-accent-700'
                    : 'text-text-muted hover:bg-surface-muted hover:text-text',
                )}
              >
                <entry.icon size={18} />
                <span className="flex-1 text-left">{entry.label}</span>
                <ChevronDown size={16} className={cn('transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="mt-1 flex flex-col gap-0.5 border-l border-border pl-4">
                  {entry.children.map((child) => {
                    if (child.type === 'leaf') {
                      return (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          className={({ isActive }) => childLeafClass(isActive)}
                        >
                          {child.label}
                        </NavLink>
                      )
                    }

                    const isSubOpen = openSubGroup === child.key
                    const isSubActive = child.children.some((leaf) => location.pathname.startsWith(leaf.to))

                    return (
                      <div key={child.key}>
                        <button
                          type="button"
                          onClick={() => toggleSubGroup(child.key)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                            isSubActive
                              ? 'bg-accent-50 text-accent-700'
                              : 'text-text-muted hover:bg-surface-muted hover:text-text',
                          )}
                        >
                          <span className="flex-1 text-left">{child.label}</span>
                          <ChevronDown
                            size={14}
                            className={cn('transition-transform', isSubOpen && 'rotate-180')}
                          />
                        </button>
                        {isSubOpen && (
                          <div className="mt-0.5 flex flex-col gap-0.5 border-l border-border pl-4">
                            {child.children.map((leaf) => (
                              <NavLink
                                key={leaf.to}
                                to={leaf.to}
                                className={({ isActive }) => childLeafClass(isActive)}
                              >
                                {leaf.label}
                              </NavLink>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  Briefcase,
  Settings,
  Landmark,
  BarChart3,
  ChevronDown,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { REPORT_CATEGORIES } from '../../features/reports/catalog'

type NavLeaf = { type: 'leaf'; to: string; label: string; end?: boolean }
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
      { type: 'leaf', to: '/transactions', label: 'All Transactions' },
      { type: 'leaf', to: '/purchase-orders', label: 'Purchase Orders' },
      { type: 'leaf', to: '/supplier-bills', label: 'Supplier Bills' },
      { type: 'leaf', to: '/expenses', label: 'Expenses' },
      { type: 'leaf', to: '/suppliers', label: 'Suppliers' },
      { type: 'leaf', to: '/customers', label: 'Customers' },
      { type: 'leaf', to: '/stock', label: 'Stock' },
      { type: 'leaf', to: '/sales', label: 'Sales Receipt' },
      { type: 'leaf', to: '/invoices', label: 'Invoices' },
      { type: 'leaf', to: '/inventory-transfers', label: 'Inventory Transfer' },
      { type: 'leaf', to: '/inventory-adjustments', label: 'Inventory Adjustment' },
      { type: 'leaf', to: '/quotations', label: 'Quotations' },
      {
        type: 'group',
        key: 'credit-memos-refunds',
        label: 'Credit Memos & Refunds',
        children: [
          { type: 'leaf', to: '/credit-memos', label: 'Credit Memos' },
          { type: 'leaf', to: '/refunds', label: 'Refunds' },
        ],
      },
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
  // Built from the reports catalog so the directory page and the nav can't drift.
  {
    type: 'group',
    key: 'reports',
    label: 'Reports',
    icon: BarChart3,
    children: [
      { type: 'leaf', to: '/reports', label: 'All Reports', end: true },
      ...REPORT_CATEGORIES.map(
        (category): NavChild => ({
          type: 'group',
          key: `reports-${category.key}`,
          label: category.title,
          children: category.reports
            .filter((r) => r.status === 'ready')
            .map((r): NavLeaf => ({ type: 'leaf', to: r.path, label: r.title })),
        }),
      ).filter((group) => group.type === 'group' && group.children.length > 0),
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

function leafMatches(leaf: NavLeaf, pathname: string): boolean {
  return leaf.end ? pathname === leaf.to : pathname.startsWith(leaf.to)
}

function childMatches(child: NavChild, pathname: string): boolean {
  return child.type === 'leaf'
    ? leafMatches(child, pathname)
    : child.children.some((leaf) => pathname.startsWith(leaf.to))
}

function findActiveSubGroupKey(children: NavChild[], pathname: string): string | undefined {
  return children.find(
    (c): c is Extract<NavChild, { type: 'group' }> =>
      c.type === 'group' && c.children.some((leaf) => pathname.startsWith(leaf.to)),
  )?.key
}

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
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

  // Selected top-level item (or a collapsed group containing the current
  // page): indigo tint plus a small indicator pill on its left edge.
  const selectedPill =
    'bg-accent-50 text-accent-700 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent-600'
  const idle = 'text-text-muted hover:bg-surface-muted hover:text-text'

  const leafClass = (isActive: boolean) =>
    cn(
      'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
      isActive ? selectedPill : idle,
    )

  // Group header: when expanded, the selected child carries the highlight, so
  // the header just darkens; when collapsed, it takes the highlight itself.
  const groupClass = (isActive: boolean, isOpen: boolean, size: 'top' | 'sub') =>
    cn(
      'group relative flex w-full items-center rounded-lg text-sm font-medium transition-colors duration-150',
      size === 'top' ? 'gap-3 px-3 py-2' : 'gap-2 px-3 py-1.5',
      isActive ? (isOpen ? 'text-text hover:bg-surface-muted' : selectedPill) : idle,
    )

  const iconClass = (isActive: boolean) =>
    cn('shrink-0 transition-colors', isActive ? 'text-accent-600' : 'text-text-subtle group-hover:text-text-muted')

  // Nested leaf: indigo tint plus an accent bar drawn over the tree's guide
  // line (the parent list is border-l + pl-4, hence -left-[17px]).
  const childLeafClass = (isActive: boolean) =>
    cn(
      'relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
      isActive
        ? 'bg-accent-50 text-accent-700 before:absolute before:-left-[17px] before:inset-y-1.5 before:w-0.5 before:rounded-full before:bg-accent-600'
        : idle,
    )

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-svh w-64 shrink-0 flex-col border-r border-border bg-surface transition-transform duration-200 lg:static lg:w-60 lg:translate-x-0 print:hidden',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <Link
          to="/"
          onClick={onClose}
          className="flex flex-1 items-center gap-2 rounded-lg transition-colors hover:bg-surface-muted"
        >
          <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-sm font-semibold tracking-tight text-text">HashirHub</span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-muted hover:text-text lg:hidden"
        >
          <X size={18} />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {navEntries.map((entry) => {
          if (entry.type === 'leaf') {
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.end}
                onClick={onClose}
                className={({ isActive }) => leafClass(isActive)}
              >
                {({ isActive }) => (
                  <>
                    <entry.icon size={18} className={iconClass(isActive)} />
                    {entry.label}
                  </>
                )}
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
                className={groupClass(isGroupActive, isOpen, 'top')}
              >
                <entry.icon size={18} className={iconClass(isGroupActive)} />
                <span className="flex-1 text-left">{entry.label}</span>
                <ChevronDown
                  size={16}
                  className={cn('text-text-subtle transition-transform duration-200', isOpen && 'rotate-180')}
                />
              </button>
              {isOpen && (
                <div className="mt-1 flex flex-col gap-0.5 border-l border-border pl-4">
                  {entry.children.map((child) => {
                    if (child.type === 'leaf') {
                      return (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end={child.end}
                          onClick={onClose}
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
                          className={groupClass(isSubActive, isSubOpen, 'sub')}
                        >
                          <span className="flex-1 text-left">{child.label}</span>
                          <ChevronDown
                            size={14}
                            className={cn('text-text-subtle transition-transform duration-200', isSubOpen && 'rotate-180')}
                          />
                        </button>
                        {isSubOpen && (
                          <div className="mt-0.5 flex flex-col gap-0.5 border-l border-border pl-4">
                            {child.children.map((leaf) => (
                              <NavLink
                                key={leaf.to}
                                to={leaf.to}
                                onClick={onClose}
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

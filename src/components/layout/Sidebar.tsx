import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  Boxes,
  Truck,
  ClipboardList,
  Users,
  ShoppingCart,
  FileText,
  Settings,
  Landmark,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/cn'

type NavEntry =
  | { type: 'leaf'; to: string; label: string; icon: LucideIcon; end?: boolean }
  | { type: 'group'; key: string; label: string; icon: LucideIcon; children: { to: string; label: string }[] }

const navEntries: NavEntry[] = [
  { type: 'leaf', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  {
    type: 'group',
    key: 'items',
    label: 'Items',
    icon: Package,
    children: [
      { to: '/items/list', label: 'Item List' },
      { to: '/items/new', label: 'New Item' },
      { to: '/items/search', label: 'Search Item' },
      { to: '/items/price-manager', label: 'Price Manager' },
    ],
  },
  { type: 'leaf', to: '/stock', label: 'Stock', icon: Boxes },
  { type: 'leaf', to: '/suppliers', label: 'Suppliers', icon: Truck },
  { type: 'leaf', to: '/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
  { type: 'leaf', to: '/customers', label: 'Customers', icon: Users },
  { type: 'leaf', to: '/sales', label: 'Sales', icon: ShoppingCart },
  { type: 'leaf', to: '/invoices', label: 'Invoices', icon: FileText },
  {
    type: 'group',
    key: 'account',
    label: 'Account',
    icon: Landmark,
    children: [
      { to: '/account/capital-matrix', label: 'Capital Matrix' },
      { to: '/account/fiscal-daybook', label: 'Fiscal Daybook' },
    ],
  },
  {
    type: 'group',
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    children: [
      { to: '/settings/company-info', label: 'Company Info' },
      { to: '/settings/stores', label: 'Stores' },
      { to: '/settings/warehouses', label: 'Warehouses' },
      { to: '/settings/price-lists', label: 'Price Lists' },
      { to: '/settings/categories', label: 'Categories' },
      { to: '/settings/brands', label: 'Brands' },
      { to: '/settings/units', label: 'Units' },
      { to: '/settings/areas', label: 'Regions & Areas' },
    ],
  },
]

export function Sidebar() {
  const location = useLocation()

  const activeGroupKey = navEntries.find(
    (entry): entry is Extract<NavEntry, { type: 'group' }> =>
      entry.type === 'group' && entry.children.some((c) => location.pathname.startsWith(c.to)),
  )?.key

  const [openGroup, setOpenGroup] = useState<string | undefined>(activeGroupKey)

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
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent-50 text-accent-700'
                      : 'text-text-muted hover:bg-surface-muted hover:text-text',
                  )
                }
              >
                <entry.icon size={18} />
                {entry.label}
              </NavLink>
            )
          }

          const isOpen = openGroup === entry.key
          const isGroupActive = entry.children.some((c) => location.pathname.startsWith(c.to))

          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => setOpenGroup((current) => (current === entry.key ? undefined : entry.key))}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isGroupActive
                    ? 'bg-accent-50 text-accent-700'
                    : 'text-text-muted hover:bg-surface-muted hover:text-text',
                )}
              >
                <entry.icon size={18} />
                <span className="flex-1 text-left">{entry.label}</span>
                <ChevronDown
                  size={16}
                  className={cn('transition-transform', isOpen && 'rotate-180')}
                />
              </button>
              {isOpen && (
                <div className="mt-1 flex flex-col gap-0.5 border-l border-border pl-4">
                  {entry.children.map((child) => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      className={({ isActive }) =>
                        cn(
                          'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-accent-50 text-accent-700'
                            : 'text-text-muted hover:bg-surface-muted hover:text-text',
                        )
                      }
                    >
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

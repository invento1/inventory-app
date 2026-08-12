import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/cn'

const tabs = [
  { to: '/items/list', label: 'Item List' },
  { to: '/items/new', label: 'New Item' },
  { to: '/items/search', label: 'Search Item' },
  { to: '/items/price-manager', label: 'Price Manager' },
]

export function ItemsLayout() {
  return (
    <div>
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-accent-600 text-accent-700'
                  : 'border-transparent text-text-muted hover:text-text',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}

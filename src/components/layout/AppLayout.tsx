import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { LogOut, Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { useAuth } from '../../auth/AuthProvider'
import { useOrg } from '../../auth/OrgProvider'
import { supabase } from '../../lib/supabaseClient'

export function AppLayout() {
  const { user } = useAuth()
  const { orgName } = useOrg()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-svh bg-surface-muted print:block print:h-auto print:bg-surface">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-primary/40 backdrop-blur-sm motion-safe:animate-fade-in lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <header className="flex h-16 shrink-0 print:hidden items-center justify-between gap-2 border-b border-border bg-surface px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="-ml-1 rounded-md p-1.5 text-text-muted hover:bg-surface-muted hover:text-text lg:hidden"
            >
              <Menu size={20} />
            </button>
            <p className="truncate text-sm font-semibold text-text">{orgName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <span className="hidden text-sm text-text-muted sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-muted hover:text-text"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

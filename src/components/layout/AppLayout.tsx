import { Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { useAuth } from '../../auth/AuthProvider'
import { useOrg } from '../../auth/OrgProvider'
import { supabase } from '../../lib/supabaseClient'

export function AppLayout() {
  const { user } = useAuth()
  const { orgName } = useOrg()

  return (
    <div className="flex h-svh bg-surface-muted">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-white px-6">
          <div>
            <p className="text-sm font-semibold text-text">{orgName}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-text-muted">{user?.email}</span>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-muted hover:text-text"
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

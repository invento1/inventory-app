import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthProvider'
import { PageSpinner } from '../components/ui/Spinner'
import type { Can, Permission } from './permissions'

interface OrgMembership {
  orgId: string
  orgName: string
  role: string
  status: string
  currencySymbol: string
  currencyCode: string
}

interface OrgContextValue {
  orgId: string
  orgName: string
  role: string
  isOwner: boolean
  currencySymbol: string
  currencyCode: string
  memberships: OrgMembership[]
  permissions: ReadonlySet<Permission>
  // Mirrors has_permission() in the database: the UI hides what the
  // database would refuse anyway.
  can: Can
}

const OrgContext = createContext<OrgContextValue | null>(null)

function LockedOut({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-svh items-center justify-center bg-surface-muted px-4">
      <div className="max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <h1 className="text-base font-semibold text-text">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">{message}</p>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="mt-4 text-sm font-medium text-accent-600 hover:text-accent-700"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['org_members', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_members')
        .select('org_id, role, status, orgs(id, name, currency_symbol, currency_code)')
        .eq('user_id', user!.id)
      if (error) throw error
      return (data ?? []).map((row) => ({
        orgId: row.org_id,
        // A deactivated member can see their own row but not the org's.
        orgName: row.orgs?.name ?? '',
        role: row.role,
        status: row.status,
        currencySymbol: row.orgs?.currency_symbol ?? '',
        currencyCode: row.orgs?.currency_code ?? '',
      })) satisfies OrgMembership[]
    },
    enabled: !!user,
  })

  const memberships = useMemo(() => (data ?? []).filter((m) => m.status === 'active' && m.orgName), [data])
  // Phase 1 is single-org-per-user: auto-select the first active membership.
  // The `memberships` list is kept on the context so a future org-switcher
  // UI doesn't require restructuring this provider.
  const current = memberships[0]

  const { data: permissionList, isLoading: loadingPermissions } = useQuery({
    queryKey: ['my_permissions', current?.orgId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_permissions', { p_org_id: current!.orgId })
      if (error) throw error
      return (data ?? []) as Permission[]
    },
    enabled: !!current,
  })

  const permissions = useMemo(() => new Set(permissionList ?? []), [permissionList])
  const can = useCallback<Can>((permission) => permissions.has(permission), [permissions])

  if (isLoading || (current && loadingPermissions)) return <PageSpinner />

  if (!current) {
    return (data ?? []).length > 0 ? (
      <LockedOut
        title="Your access is turned off"
        message="An owner or admin has deactivated your account for this business. Contact them if you think this is a mistake."
      />
    ) : (
      <LockedOut
        title="No organization access"
        message="Your account isn't linked to a business yet. Contact the app owner to get set up."
      />
    )
  }

  return (
    <OrgContext.Provider
      value={{
        orgId: current.orgId,
        orgName: current.orgName,
        role: current.role,
        isOwner: current.role === 'owner',
        currencySymbol: current.currencySymbol,
        currencyCode: current.currencyCode,
        memberships,
        permissions,
        can,
      }}
    >
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used within an OrgProvider')
  return ctx
}

// Shorthand for components that only need permission checks.
export function useCan() {
  const { can, isOwner } = useOrg()
  return { can, isOwner }
}

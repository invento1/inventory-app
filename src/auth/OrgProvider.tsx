import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthProvider'
import { PageSpinner } from '../components/ui/Spinner'

interface OrgMembership {
  orgId: string
  orgName: string
  role: string
  currencySymbol: string
  currencyCode: string
}

interface OrgContextValue {
  orgId: string
  orgName: string
  role: string
  currencySymbol: string
  currencyCode: string
  memberships: OrgMembership[]
}

const OrgContext = createContext<OrgContextValue | null>(null)

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['org_members', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_members')
        .select('org_id, role, orgs(id, name, currency_symbol, currency_code)')
        .eq('user_id', user!.id)
      if (error) throw error
      return (data ?? [])
        .filter((row) => row.orgs)
        .map((row) => ({
          orgId: row.org_id,
          orgName: row.orgs!.name,
          role: row.role,
          currencySymbol: row.orgs!.currency_symbol,
          currencyCode: row.orgs!.currency_code,
        })) satisfies OrgMembership[]
    },
    enabled: !!user,
  })

  if (isLoading) return <PageSpinner />

  const memberships = data ?? []

  if (memberships.length === 0) {
    return (
      <div className="flex h-svh items-center justify-center bg-surface-muted px-4">
        <div className="max-w-sm rounded-xl border border-border bg-white p-6 text-center shadow-sm">
          <h1 className="text-base font-semibold text-text">No organization access</h1>
          <p className="mt-2 text-sm text-text-muted">
            Your account isn't linked to a business yet. Contact the app owner to get set up.
          </p>
        </div>
      </div>
    )
  }

  // Phase 1 is single-org-per-user: auto-select the first membership.
  // The `memberships` list is kept on the context so a future org-switcher
  // UI doesn't require restructuring this provider.
  const current = memberships[0]

  return (
    <OrgContext.Provider
      value={{
        orgId: current.orgId,
        orgName: current.orgName,
        role: current.role,
        currencySymbol: current.currencySymbol,
        currencyCode: current.currencyCode,
        memberships,
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

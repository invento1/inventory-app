import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type OrgMember = Database['public']['Functions']['list_org_members']['Returns'][number]
export type OrgRole = Database['public']['Tables']['org_roles']['Row']
export type AppPermission = Database['public']['Tables']['app_permissions']['Row']

// Where invite and password-reset links send people back to. It has to be
// on Supabase's Auth redirect allow list, or Supabase falls back to the Site URL.
export function authRedirectUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

// ---- Users ----------------------------------------------------------------

export function useOrgMembers(orgId: string) {
  return useQuery({
    queryKey: ['org_member_list', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_org_members', { p_org_id: orgId })
      if (error) throw error
      return data ?? []
    },
  })
}

// Calls the manage-users Edge Function (the only place that can create
// logins or send invites). Its errors come back as { error } JSON bodies.
async function manageUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error ?? 'Something went wrong')
    }
    throw error
  }
  return data as T
}

export interface AddUserInput {
  email: string
  full_name: string
  role: string
  method: 'invite' | 'password'
  password?: string
}

export type AddUserOutcome = 'invited' | 'created' | 'existing'

export function useAddUser(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddUserInput) =>
      manageUsers<{ outcome: AddUserOutcome }>({
        action: 'add',
        org_id: orgId,
        redirect_to: authRedirectUrl(),
        ...input,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org_member_list', orgId] }),
  })
}

export function useResendInvite(orgId: string) {
  return useMutation({
    mutationFn: (userId: string) =>
      manageUsers<{ outcome: 'invited' | 'reset_sent' }>({
        action: 'resend_invite',
        org_id: orgId,
        user_id: userId,
        redirect_to: authRedirectUrl(),
      }),
  })
}

export function useSetUserPassword(orgId: string) {
  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      manageUsers({ action: 'set_password', org_id: orgId, user_id: userId, password }),
  })
}

export function useSendPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() })
      if (error) throw error
    },
  })
}

export interface UpdateMemberInput {
  userId: string
  fullName: string
  role: string
  status: 'active' | 'inactive'
}

export function useUpdateMember(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, fullName, role, status }: UpdateMemberInput) => {
      const { error } = await supabase.rpc('update_org_member', {
        p_org_id: orgId,
        p_user_id: userId,
        p_full_name: fullName,
        p_role: role,
        p_status: status,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org_member_list', orgId] }),
  })
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('remove_org_member', { p_org_id: orgId, p_user_id: userId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org_member_list', orgId] }),
  })
}

// ---- Security Groups ------------------------------------------------------

export function useOrgRoles(orgId: string) {
  return useQuery({
    queryKey: ['org_roles', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_roles')
        .select('*')
        .eq('org_id', orgId)
        .order('sort_order')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

export function useAppPermissions() {
  return useQuery({
    queryKey: ['app_permissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_permissions')
        .select('*')
        .order('module_order')
        .order('sort_order')
      if (error) throw error
      return data
    },
    staleTime: Infinity,
  })
}

// role key -> set of permission keys
export function useRolePermissions(orgId: string) {
  return useQuery({
    queryKey: ['role_permissions', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('role_key, permission_key')
        .eq('org_id', orgId)
      if (error) throw error
      const map = new Map<string, Set<string>>()
      for (const row of data) {
        if (!map.has(row.role_key)) map.set(row.role_key, new Set())
        map.get(row.role_key)!.add(row.permission_key)
      }
      return map
    },
  })
}

function invalidateSecurity(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  queryClient.invalidateQueries({ queryKey: ['org_roles', orgId] })
  queryClient.invalidateQueries({ queryKey: ['role_permissions', orgId] })
  queryClient.invalidateQueries({ queryKey: ['my_permissions'] })
}

// Saves each changed role's full permission set.
export function useSaveRolePermissions(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (changes: { roleKey: string; permissions: string[] }[]) => {
      for (const { roleKey, permissions } of changes) {
        const { error } = await supabase.rpc('save_role_permissions', {
          p_org_id: orgId,
          p_role_key: roleKey,
          p_permissions: permissions,
        })
        if (error) throw error
      }
    },
    onSettled: () => invalidateSecurity(queryClient, orgId),
  })
}

export function useCreateRole(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; description: string; copyFrom: string | null }) => {
      const { data, error } = await supabase.rpc('create_org_role', {
        p_org_id: orgId,
        p_name: input.name,
        p_description: input.description,
        p_copy_from: input.copyFrom ?? undefined,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateSecurity(queryClient, orgId),
  })
}

export function useUpdateRole(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { key: string; name: string; description: string }) => {
      const { error } = await supabase.rpc('update_org_role', {
        p_org_id: orgId,
        p_role_key: input.key,
        p_name: input.name,
        p_description: input.description,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateSecurity(queryClient, orgId),
  })
}

export function useDeleteRole(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (key: string) => {
      const { error } = await supabase.rpc('delete_org_role', { p_org_id: orgId, p_role_key: key })
      if (error) throw error
    },
    onSuccess: () => invalidateSecurity(queryClient, orgId),
  })
}

// Adding a permission also adds what it depends on; removing one also
// removes whatever depends on it. Keeps every saved set valid for
// save_role_permissions' dependency check.
export function togglePermission(
  current: ReadonlySet<string>,
  key: string,
  on: boolean,
  catalog: AppPermission[],
): Set<string> {
  const next = new Set(current)
  const byKey = new Map(catalog.map((p) => [p.key, p]))
  if (on) {
    const stack = [key]
    while (stack.length) {
      const k = stack.pop()!
      if (next.has(k)) continue
      next.add(k)
      stack.push(...(byKey.get(k)?.requires ?? []))
    }
  } else {
    const stack = [key]
    while (stack.length) {
      const k = stack.pop()!
      if (!next.delete(k)) continue
      for (const p of catalog) if (p.requires.includes(k)) stack.push(p.key)
    }
  }
  return next
}

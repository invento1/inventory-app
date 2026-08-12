import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type Customer = Database['public']['Tables']['customers']['Row']
export type CustomerInput = Pick<
  Database['public']['Tables']['customers']['Insert'],
  'name' | 'phone' | 'email' | 'address' | 'area_id'
>

export interface CustomerListRow extends Customer {
  area_name: string | null
}

export function useCustomers(orgId: string) {
  return useQuery({
    queryKey: ['customers', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*, areas(name)')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        area_name: row.areas?.name ?? null,
      })) satisfies CustomerListRow[]
    },
  })
}

export function useCreateCustomer(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CustomerInput) => {
      const { data, error } = await supabase
        .from('customers')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as Customer
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers', orgId] }),
  })
}

export function useUpdateCustomer(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<CustomerInput> }) => {
      const { data, error } = await supabase
        .from('customers')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as Customer
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers', orgId] }),
  })
}

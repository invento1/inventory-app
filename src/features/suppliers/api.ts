import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type Supplier = Database['public']['Tables']['suppliers']['Row']
export type SupplierInput = Pick<
  Database['public']['Tables']['suppliers']['Insert'],
  'name' | 'contact_name' | 'contact_email' | 'contact_phone'
>

export function useSuppliers(orgId: string) {
  return useQuery({
    queryKey: ['suppliers', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return data as Supplier[]
    },
  })
}

export function useCreateSupplier(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SupplierInput) => {
      const { data, error } = await supabase
        .from('suppliers')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as Supplier
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers', orgId] }),
  })
}

export function useUpdateSupplier(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<SupplierInput> }) => {
      const { data, error } = await supabase
        .from('suppliers')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as Supplier
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers', orgId] }),
  })
}

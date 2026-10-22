import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type SalesRep = Database['public']['Tables']['sales_reps']['Row']
export type SalesRepInput = Pick<Database['public']['Tables']['sales_reps']['Insert'], 'name' | 'phone' | 'email' | 'is_active'>

// Every rep, active or not: documents keep pointing at a rep after they're
// deactivated, so lookups by id need the inactive ones too.
export function useSalesReps(orgId: string) {
  return useQuery({
    queryKey: ['sales_reps', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_reps').select('*').eq('org_id', orgId).order('name')
      if (error) throw error
      return data as SalesRep[]
    },
  })
}

export function useCreateSalesRep(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SalesRepInput) => {
      const { data, error } = await supabase
        .from('sales_reps')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as SalesRep
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sales_reps', orgId] }),
  })
}

export function useUpdateSalesRep(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<SalesRepInput> }) => {
      const { data, error } = await supabase
        .from('sales_reps')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as SalesRep
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sales_reps', orgId] }),
  })
}

export function salesRepName(reps: SalesRep[] | undefined, id: string | null | undefined) {
  if (!id) return null
  return reps?.find((r) => r.id === id)?.name ?? null
}

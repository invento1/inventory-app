import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type Item = Database['public']['Tables']['items']['Row']
export type ItemInput = Pick<
  Database['public']['Tables']['items']['Insert'],
  'sku' | 'barcode' | 'name' | 'description' | 'unit' | 'unit_price' | 'reorder_threshold'
>

export function useItems(orgId: string) {
  return useQuery({
    queryKey: ['items', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return data as Item[]
    },
  })
}

export function useCreateItem(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ItemInput) => {
      const { data, error } = await supabase
        .from('items')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as Item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] })
    },
  })
}

export function useUpdateItem(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<ItemInput> & { is_active?: boolean } }) => {
      const { data, error } = await supabase
        .from('items')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as Item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] })
    },
  })
}

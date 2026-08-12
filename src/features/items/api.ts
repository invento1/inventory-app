import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type Item = Database['public']['Tables']['items']['Row']
export type ItemInput = Pick<
  Database['public']['Tables']['items']['Insert'],
  | 'sku'
  | 'barcode'
  | 'name'
  | 'description'
  | 'unit'
  | 'unit_price'
  | 'reorder_threshold'
  | 'category_id'
  | 'brand_id'
>

export interface ItemListRow extends Item {
  category_name: string | null
  brand_name: string | null
  on_hand: number
}

export function useItems(orgId: string) {
  return useQuery({
    queryKey: ['items', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, categories(name), brands(name), stock_levels(quantity)')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        category_name: row.categories?.name ?? null,
        brand_name: row.brands?.name ?? null,
        on_hand: (row.stock_levels ?? []).reduce((sum, s) => sum + s.quantity, 0),
      })) satisfies ItemListRow[]
    },
  })
}

export function useCreateItem(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Omit<ItemInput, 'sku'>) => {
      // SKUs are always system-assigned (100001, 100002, ...) -- never
      // typed by hand, so create never takes one from the caller.
      const { data: sku, error: skuError } = await supabase.rpc('next_item_sku', {
        p_org_id: orgId,
      })
      if (skuError) throw skuError

      const { data, error } = await supabase
        .from('items')
        .insert({ ...input, sku, org_id: orgId })
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

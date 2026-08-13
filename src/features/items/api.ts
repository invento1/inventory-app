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
  | 'supplier_id'
>

export interface ItemListRow extends Item {
  category_name: string | null
  brand_name: string | null
  supplier_name: string | null
  on_hand: number
}

export function useItems(orgId: string) {
  return useQuery({
    queryKey: ['items', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, categories(name), brands(name), suppliers(name), stock_levels(quantity)')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        category_name: row.categories?.name ?? null,
        brand_name: row.brands?.name ?? null,
        supplier_name: row.suppliers?.name ?? null,
        on_hand: (row.stock_levels ?? []).reduce((sum, s) => sum + s.quantity, 0),
      })) satisfies ItemListRow[]
    },
  })
}

export interface ItemLastPurchasePrice {
  unit_cost: number
  purchased_at: string
}

// Last price paid per item, sourced from whichever is more recent between
// purchase_order_lines and supplier_bill_items (see item_last_purchase_price
// view) -- items have no stored cost_price, so this is the closest thing to
// one. Surfaced as a hover tooltip on the unit price field when creating a
// sales receipt or invoice, to gauge available discount room.
export function useItemLastPurchasePrices(orgId: string) {
  return useQuery({
    queryKey: ['item_last_purchase_price', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_last_purchase_price')
        .select('item_id, unit_cost, purchased_at')
        .eq('org_id', orgId)
      if (error) throw error
      const map = new Map<string, ItemLastPurchasePrice>()
      for (const row of data ?? []) {
        if (row.item_id && row.unit_cost != null && row.purchased_at) {
          map.set(row.item_id, { unit_cost: row.unit_cost, purchased_at: row.purchased_at })
        }
      }
      return map
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

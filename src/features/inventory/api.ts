import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

export interface StockTransferRow {
  reference_id: string
  transfer_date: string
  item_name: string
  item_sku: string
  from_location_name: string
  to_location_name: string
  quantity: number
  notes: string | null
}

export function useStockTransfers(orgId: string) {
  return useQuery({
    queryKey: ['stock_movements', orgId, 'transfers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('reference_id, created_at, quantity_delta, notes, items(name, sku), locations(name)')
        .eq('org_id', orgId)
        .eq('reason', 'transfer')
        .order('created_at', { ascending: false })
      if (error) throw error

      const byRef = new Map<string, StockTransferRow>()
      for (const row of data ?? []) {
        const ref = row.reference_id
        if (!ref) continue
        const existing = byRef.get(ref)
        const locationName = row.locations?.name ?? ''
        if (!existing) {
          byRef.set(ref, {
            reference_id: ref,
            transfer_date: row.created_at,
            item_name: row.items?.name ?? '',
            item_sku: row.items?.sku ?? '',
            from_location_name: row.quantity_delta < 0 ? locationName : '',
            to_location_name: row.quantity_delta > 0 ? locationName : '',
            quantity: Math.abs(row.quantity_delta),
            notes: row.notes,
          })
        } else {
          if (row.quantity_delta < 0) existing.from_location_name = locationName
          else existing.to_location_name = locationName
        }
      }
      return Array.from(byRef.values())
    },
  })
}

export function useCreateStockTransfer(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      itemId: string
      fromLocationId: string
      toLocationId: string
      quantity: number
      transferDate: string
      notes: string | null
    }) => {
      const { error } = await supabase.rpc('create_stock_transfer', {
        p_org_id: orgId,
        p_item_id: input.itemId,
        p_from_location_id: input.fromLocationId,
        p_to_location_id: input.toLocationId,
        p_quantity: input.quantity,
        p_transfer_date: input.transferDate,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
    },
  })
}

export interface StockAdjustmentRow {
  id: string
  created_at: string
  quantity_delta: number
  notes: string | null
  item_name: string
  item_sku: string
  location_name: string
}

export function useStockAdjustments(orgId: string) {
  return useQuery({
    queryKey: ['stock_movements', orgId, 'adjustments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id, created_at, quantity_delta, notes, items(name, sku), locations(name)')
        .eq('org_id', orgId)
        .eq('reason', 'adjustment')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        quantity_delta: row.quantity_delta,
        notes: row.notes,
        item_name: row.items?.name ?? '',
        item_sku: row.items?.sku ?? '',
        location_name: row.locations?.name ?? '',
      })) satisfies StockAdjustmentRow[]
    },
  })
}

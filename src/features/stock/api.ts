import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

export interface StockLevelRow {
  item_id: string
  location_id: string
  quantity: number
  updated_at: string
  item_name: string
  item_sku: string
  location_name: string
}

export function useStockLevels(orgId: string) {
  return useQuery({
    queryKey: ['stock_levels', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_levels')
        .select('item_id, location_id, quantity, updated_at, items(name, sku), locations(name)')
        .eq('org_id', orgId)
      if (error) throw error
      return (data ?? []).map((row) => ({
        item_id: row.item_id,
        location_id: row.location_id,
        quantity: row.quantity,
        updated_at: row.updated_at,
        item_name: row.items?.name ?? '',
        item_sku: row.items?.sku ?? '',
        location_name: row.locations?.name ?? '',
      })) satisfies StockLevelRow[]
    },
  })
}

export interface StockMovementRow {
  id: string
  created_at: string
  quantity_delta: number
  reason: string
  item_name: string
  location_name: string
}

export function useStockMovements(orgId: string) {
  return useQuery({
    queryKey: ['stock_movements', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id, created_at, quantity_delta, reason, items(name), locations(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        quantity_delta: row.quantity_delta,
        reason: row.reason,
        item_name: row.items?.name ?? '',
        location_name: row.locations?.name ?? '',
      })) satisfies StockMovementRow[]
    },
  })
}

export function useItemStockMovements(orgId: string, itemId: string) {
  return useQuery({
    queryKey: ['stock_movements', orgId, 'item', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id, created_at, quantity_delta, reason, items(name), locations(name)')
        .eq('org_id', orgId)
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        quantity_delta: row.quantity_delta,
        reason: row.reason,
        item_name: row.items?.name ?? '',
        location_name: row.locations?.name ?? '',
      })) satisfies StockMovementRow[]
    },
    enabled: !!itemId,
  })
}

export function useAdjustStock(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { itemId: string; locationId: string; quantityDelta: number }) => {
      const { error } = await supabase.from('stock_movements').insert({
        org_id: orgId,
        item_id: input.itemId,
        location_id: input.locationId,
        quantity_delta: input.quantityDelta,
        reason: 'adjustment',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

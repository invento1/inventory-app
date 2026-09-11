import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

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

export type InventoryAdjustment = Database['public']['Tables']['inventory_adjustments']['Row']
export type InventoryAdjustmentItem = Database['public']['Tables']['inventory_adjustment_items']['Row']
export type AdjustmentType = 'quantity' | 'value' | 'quantity_and_value'

export interface InventoryAdjustmentListRow extends InventoryAdjustment {
  location_name: string
  adjustment_account_name: string
}

export function useInventoryAdjustments(orgId: string) {
  return useQuery({
    queryKey: ['inventory_adjustments', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_adjustments')
        .select('*, locations(name), ledger_accounts(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        location_name: row.locations?.name ?? '',
        adjustment_account_name: row.ledger_accounts?.name ?? '',
      })) satisfies InventoryAdjustmentListRow[]
    },
  })
}

export interface InventoryAdjustmentItemRow extends InventoryAdjustmentItem {
  item_name: string
  item_sku: string
}

export function useInventoryAdjustment(orgId: string, id: string) {
  return useQuery({
    queryKey: ['inventory_adjustment', id],
    queryFn: async () => {
      const { data: adjustment, error: adjustmentError } = await supabase
        .from('inventory_adjustments')
        .select('*, locations(name), ledger_accounts(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (adjustmentError) throw adjustmentError

      const { data: lines, error: linesError } = await supabase
        .from('inventory_adjustment_items')
        .select('*, items(name, sku)')
        .eq('adjustment_id', id)
      if (linesError) throw linesError

      return {
        adjustment: {
          ...adjustment,
          location_name: adjustment.locations?.name ?? '',
          adjustment_account_name: adjustment.ledger_accounts?.name ?? '',
        } satisfies InventoryAdjustmentListRow,
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
        })) satisfies InventoryAdjustmentItemRow[],
      }
    },
    enabled: !!id,
  })
}

export interface NewInventoryAdjustmentLine {
  item_id: string
  new_qty: number | null
  new_value: number | null
}

export function useCreateInventoryAdjustment(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      locationId: string
      adjustmentType: AdjustmentType
      adjustmentAccountId: string
      adjustmentDate: string
      referenceNumber: string | null
      description: string | null
      lines: NewInventoryAdjustmentLine[]
    }) => {
      const { data, error } = await supabase.rpc('create_inventory_adjustment', {
        p_org_id: orgId,
        p_location_id: input.locationId,
        p_adjustment_type: input.adjustmentType,
        p_adjustment_account_id: input.adjustmentAccountId,
        p_adjustment_date: input.adjustmentDate,
        p_reference_number: input.referenceNumber as unknown as string,
        p_description: input.description as unknown as string,
        p_lines: input.lines as unknown as Json,
      })
      if (error) throw error
      return data as InventoryAdjustment
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory_adjustments', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['items', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

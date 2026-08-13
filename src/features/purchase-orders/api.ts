import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type PurchaseOrder = Database['public']['Tables']['purchase_orders']['Row']
export type PurchaseOrderLine = Database['public']['Tables']['purchase_order_lines']['Row']

export interface PurchaseOrderListRow extends PurchaseOrder {
  supplier_name: string
}

export function usePurchaseOrders(orgId: string) {
  return useQuery({
    queryKey: ['purchase_orders', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, suppliers(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        supplier_name: row.suppliers?.name ?? '',
      })) satisfies PurchaseOrderListRow[]
    },
  })
}

export interface PurchaseOrderLineRow extends PurchaseOrderLine {
  item_name: string
  item_sku: string
}

export function usePurchaseOrder(orgId: string, id: string) {
  return useQuery({
    queryKey: ['purchase_order', id],
    queryFn: async () => {
      const { data: po, error: poError } = await supabase
        .from('purchase_orders')
        .select('*, suppliers(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (poError) throw poError

      const { data: lines, error: linesError } = await supabase
        .from('purchase_order_lines')
        .select('*, items(name, sku)')
        .eq('po_id', id)
      if (linesError) throw linesError

      return {
        po: po as PurchaseOrder & { suppliers: { name: string } | null },
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
        })) satisfies PurchaseOrderLineRow[],
      }
    },
  })
}

export interface NewPurchaseOrderLine {
  item_id: string
  quantity_ordered: number
  unit_cost: number | null
}

export function useCreatePurchaseOrder(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      supplierId: string
      expectedDate: string | null
      lines: NewPurchaseOrderLine[]
    }) => {
      const { data: po, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
          org_id: orgId,
          supplier_id: input.supplierId,
          expected_date: input.expectedDate,
          status: 'submitted',
        })
        .select()
        .single()
      if (poError) throw poError

      const { error: linesError } = await supabase.from('purchase_order_lines').insert(
        input.lines.map((line) => ({
          po_id: po.id,
          item_id: line.item_id,
          quantity_ordered: line.quantity_ordered,
          unit_cost: line.unit_cost,
        })),
      )
      if (linesError) throw linesError

      return po as PurchaseOrder
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase_orders', orgId] }),
  })
}

export function useConvertPurchaseOrderToBill(orgId: string, poId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { locationId: string; dueDate: string; notes: string | null }) => {
      const { data, error } = await supabase.rpc('convert_purchase_order_to_bill', {
        p_po_id: poId,
        p_location_id: input.locationId,
        p_due_date: input.dueDate,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_order', poId] })
      queryClient.invalidateQueries({ queryKey: ['purchase_orders', orgId] })
      queryClient.invalidateQueries({ queryKey: ['supplier_bills', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

export function useReceivePurchaseOrderLine(orgId: string, poId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { poLineId: string; locationId: string; quantity: number }) => {
      const { error } = await supabase.rpc('receive_purchase_order_line', {
        p_po_line_id: input.poLineId,
        p_location_id: input.locationId,
        p_quantity: input.quantity,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_order', poId] })
      queryClient.invalidateQueries({ queryKey: ['purchase_orders', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

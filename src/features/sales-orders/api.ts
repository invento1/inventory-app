import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type SalesOrder = Database['public']['Tables']['sales_orders']['Row']
export type SalesOrderStatus = 'open' | 'invoiced' | 'cancelled'

export interface SalesOrderListRow extends SalesOrder {
  customer_name: string
  rep_name: string | null
  invoice_number: string | null
}

export function useSalesOrders(orgId: string) {
  return useQuery({
    queryKey: ['sales_orders', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select('*, customers(name), sales_reps(name), invoices(invoice_number)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        customer_name: row.customers?.name ?? '',
        rep_name: row.sales_reps?.name ?? null,
        invoice_number: row.invoices?.invoice_number ?? null,
      })) satisfies SalesOrderListRow[]
    },
  })
}

export interface SalesOrderLineRow {
  id: string
  item_id: string
  quantity: number
  unit_price: number
  discount: number
  line_total: number
  item_name: string
  item_sku: string
}

export function useSalesOrder(orgId: string, id: string | null | undefined) {
  return useQuery({
    queryKey: ['sales_order', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: order, error: orderError } = await supabase
        .from('sales_orders')
        .select('*, customers(name), sales_reps(name), invoices(invoice_number)')
        .eq('id', id!)
        .eq('org_id', orgId)
        .single()
      if (orderError) throw orderError

      const { data: lines, error: linesError } = await supabase
        .from('sales_order_items')
        .select('*, items(name, sku)')
        .eq('sales_order_id', id!)
        .order('line_order')
      if (linesError) throw linesError

      return {
        order: order as SalesOrder & {
          customers: { name: string } | null
          sales_reps: { name: string } | null
          invoices: { invoice_number: string } | null
        },
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
        })) satisfies SalesOrderLineRow[],
      }
    },
  })
}

export interface SalesOrderLinePayload {
  item_id: string
  quantity: number
  unit_price: number
  discount: number
}

export interface SalesOrderInput {
  customerId: string
  salesRepId: string | null
  deliveryDate: string | null
  lines: SalesOrderLinePayload[]
  discount: number
  notes: string | null
}

export function useCreateSalesOrder(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SalesOrderInput) => {
      const { data, error } = await supabase.rpc('create_sales_order', {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_delivery_date: input.deliveryDate as unknown as string,
        p_lines: input.lines as unknown as Json,
        p_notes: input.notes as unknown as string,
        p_sales_rep_id: input.salesRepId as unknown as string,
        p_discount: input.discount,
      })
      if (error) throw error
      return data as SalesOrder
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sales_orders', orgId] }),
  })
}

export function useUpdateSalesOrder(orgId: string, orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SalesOrderInput) => {
      const { data, error } = await supabase.rpc('update_sales_order', {
        p_order_id: orderId,
        p_customer_id: input.customerId,
        p_delivery_date: input.deliveryDate as unknown as string,
        p_lines: input.lines as unknown as Json,
        p_notes: input.notes as unknown as string,
        p_sales_rep_id: input.salesRepId as unknown as string,
        p_discount: input.discount,
      })
      if (error) throw error
      return data as SalesOrder
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales_order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['sales_orders', orgId] })
    },
  })
}

export function useCancelSalesOrder(orgId: string, orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cancel_sales_order', { p_order_id: orderId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales_order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['sales_orders', orgId] })
    },
  })
}

export const SALES_ORDER_STATUS: Record<SalesOrderStatus, { label: string; tone: 'accent' | 'success' | 'neutral' }> = {
  open: { label: 'Open', tone: 'accent' },
  invoiced: { label: 'Invoiced', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

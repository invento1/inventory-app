import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type SalesReceipt = Database['public']['Tables']['sales_receipts']['Row']

export interface SalesReceiptListRow extends SalesReceipt {
  customer_name: string | null
}

export function useSalesReceipts(orgId: string) {
  return useQuery({
    queryKey: ['sales_receipts', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_receipts')
        .select('*, customers(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        customer_name: row.customers?.name ?? null,
      })) satisfies SalesReceiptListRow[]
    },
  })
}

export function useSalesReceipt(orgId: string, id: string) {
  return useQuery({
    queryKey: ['sales_receipt', id],
    queryFn: async () => {
      const { data: receipt, error: receiptError } = await supabase
        .from('sales_receipts')
        .select('*, customers(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (receiptError) throw receiptError

      const { data: lines, error: linesError } = await supabase
        .from('sales_receipt_items')
        .select('*, items(name, sku), locations(name)')
        .eq('sales_receipt_id', id)
      if (linesError) throw linesError

      return {
        receipt: receipt as SalesReceipt & { customers: { name: string } | null },
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
          location_name: l.locations?.name ?? '',
        })),
      }
    },
  })
}

export interface CartLinePayload {
  item_id: string
  location_id: string
  quantity: number
  unit_price: number
}

export function useCreateSalesReceipt(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      customerId: string | null
      paymentMethod: string
      lines: CartLinePayload[]
    }) => {
      // The generated RPC arg types don't reflect that p_customer_id/p_lines
      // accept null/plain-object-array at the SQL level (uuid with no
      // default, and jsonb respectively) -- cast explicitly rather than
      // widen the whole client's generated types.
      const { data, error } = await supabase.rpc('create_sales_receipt', {
        p_org_id: orgId,
        p_customer_id: input.customerId as unknown as string,
        p_payment_method: input.paymentMethod,
        p_lines: input.lines as unknown as Json,
      })
      if (error) throw error
      return data as SalesReceipt
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales_receipts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

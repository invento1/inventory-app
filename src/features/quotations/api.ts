import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type Quotation = Database['public']['Tables']['quotations']['Row']

export interface QuotationListRow extends Quotation {
  customer_name: string
}

export function useQuotations(orgId: string) {
  return useQuery({
    queryKey: ['quotations', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotations')
        .select('*, customers(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        customer_name: row.customers?.name ?? 'Walk-in',
      })) satisfies QuotationListRow[]
    },
  })
}

export interface QuotationLineRow {
  id: string
  item_id: string
  quantity: number
  unit_price: number
  line_total: number
  item_name: string
  item_sku: string
}

export function useQuotation(orgId: string, id: string) {
  return useQuery({
    queryKey: ['quotation', id],
    queryFn: async () => {
      const { data: quotation, error: quotationError } = await supabase
        .from('quotations')
        .select('*, customers(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (quotationError) throw quotationError

      const { data: lines, error: linesError } = await supabase
        .from('quotation_items')
        .select('*, items(name, sku)')
        .eq('quotation_id', id)
      if (linesError) throw linesError

      return {
        quotation: quotation as Quotation & { customers: { name: string } | null },
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
        })) satisfies QuotationLineRow[],
      }
    },
  })
}

export interface QuotationLinePayload {
  item_id: string
  quantity: number
  unit_price: number
}

export function useCreateQuotation(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      customerId: string | null
      expiryDate: string | null
      lines: QuotationLinePayload[]
      notes: string | null
    }) => {
      const { data, error } = await supabase.rpc('create_quotation', {
        p_org_id: orgId,
        p_customer_id: input.customerId as unknown as string,
        p_expiry_date: input.expiryDate as unknown as string,
        p_lines: input.lines as unknown as Json,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as Quotation
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quotations', orgId] }),
  })
}

export function useVoidQuotation(orgId: string, quotationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('void_quotation', { p_quotation_id: quotationId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotation', quotationId] })
      queryClient.invalidateQueries({ queryKey: ['quotations', orgId] })
    },
  })
}

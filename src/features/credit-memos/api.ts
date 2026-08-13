import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type CreditMemo = Database['public']['Tables']['credit_memos']['Row']

export interface CreditMemoListRow extends CreditMemo {
  customer_name: string
}

export function useCreditMemos(orgId: string) {
  return useQuery({
    queryKey: ['credit_memos', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_memos')
        .select('*, customers(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        customer_name: row.customers?.name ?? '',
      })) satisfies CreditMemoListRow[]
    },
  })
}

export interface CreditMemoLineRow {
  id: string
  item_id: string
  location_id: string
  quantity: number
  unit_price: number
  line_total: number
  item_name: string
  item_sku: string
  location_name: string
}

export function useCreditMemo(orgId: string, id: string) {
  return useQuery({
    queryKey: ['credit_memo', id],
    queryFn: async () => {
      const { data: creditMemo, error: creditMemoError } = await supabase
        .from('credit_memos')
        .select('*, customers(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (creditMemoError) throw creditMemoError

      const { data: lines, error: linesError } = await supabase
        .from('credit_memo_items')
        .select('*, items(name, sku), locations(name)')
        .eq('credit_memo_id', id)
      if (linesError) throw linesError

      return {
        creditMemo: creditMemo as CreditMemo & { customers: { name: string } | null },
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
          location_name: l.locations?.name ?? '',
        })) satisfies CreditMemoLineRow[],
      }
    },
  })
}

export interface CreditMemoLinePayload {
  item_id: string
  location_id: string
  quantity: number
  unit_price: number
}

export function useCreateCreditMemo(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      customerId: string
      lines: CreditMemoLinePayload[]
      notes: string | null
    }) => {
      const { data, error } = await supabase.rpc('create_credit_memo', {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_lines: input.lines as unknown as Json,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as CreditMemo
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credit_memos', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

export function useVoidCreditMemo(orgId: string, creditMemoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('void_credit_memo', { p_credit_memo_id: creditMemoId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credit_memo', creditMemoId] })
      queryClient.invalidateQueries({ queryKey: ['credit_memos', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

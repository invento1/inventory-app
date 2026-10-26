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
        .select('*, customers(name), sales_reps(name), invoices!credit_memos_invoice_id_fkey(invoice_number)')
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
        creditMemo: creditMemo as CreditMemo & {
          customers: { name: string } | null
          sales_reps: { name: string } | null
          invoices: { invoice_number: string } | null
        },
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
      salesRepId: string | null
      invoiceId?: string | null
    }) => {
      const { data, error } = await supabase.rpc('create_credit_memo', {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_lines: input.lines as unknown as Json,
        p_notes: input.notes as unknown as string,
        p_sales_rep_id: input.salesRepId as unknown as string,
        p_invoice_id: (input.invoiceId ?? null) as unknown as string,
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
      invalidateInvoiceBalances(queryClient, orgId)
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
      invalidateInvoiceBalances(queryClient, orgId)
    },
  })
}

// A credit memo can change invoice balances (credit applied, or taken off on void).
function invalidateInvoiceBalances(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  for (const key of [
    ['invoice'],
    ['invoices', orgId],
    ['outstanding_invoices', orgId],
    ['credit_applications', orgId],
    ['open_credits', orgId],
    ['dashboard', orgId],
  ]) {
    queryClient.invalidateQueries({ queryKey: key })
  }
}

// Open credit memos split by how much of their credit has been applied.
export function creditMemoStatus(memo: { status: string; total: number; amount_applied: number }) {
  if (memo.status === 'void') return { tone: 'neutral' as const, label: 'Void' }
  if (memo.amount_applied <= 0) return { tone: 'warning' as const, label: 'Unapplied' }
  if (memo.amount_applied < memo.total) return { tone: 'accent' as const, label: 'Partly applied' }
  return { tone: 'success' as const, label: 'Applied' }
}

export interface ReturnableInvoice {
  id: string
  invoice_number: string
  issue_date: string
  customer_id: string
}

// The customer's invoices a return can be raised against (any not void).
export function useReturnableInvoices(orgId: string, customerId: string) {
  return useQuery({
    queryKey: ['returnable_invoices', orgId, customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, issue_date, customer_id')
        .eq('org_id', orgId)
        .eq('customer_id', customerId)
        .neq('status', 'void')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as ReturnableInvoice[]
    },
  })
}

export interface ReturnableLine {
  item_id: string
  location_id: string
  sold: number
  returned: number
  // What the customer actually paid per unit: line and invoice discounts spread in.
  net_price: number
}

// An invoice's lines with how many are still returnable, one row per item
// (the first line's location; the price averaged over its lines).
export function useInvoiceReturnables(orgId: string, invoiceId: string) {
  return useQuery({
    queryKey: ['invoice_returnables', orgId, invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const [{ data: invoice, error: invoiceError }, { data: lines, error: linesError }, { data: returns, error: returnsError }] =
        await Promise.all([
          supabase.from('invoices').select('id, customer_id, subtotal, total').eq('id', invoiceId).eq('org_id', orgId).single(),
          supabase.from('invoice_items').select('item_id, location_id, quantity, line_total').eq('invoice_id', invoiceId),
          supabase
            .from('credit_memo_items')
            .select('item_id, quantity, credit_memos!inner(invoice_id, status)')
            .eq('credit_memos.invoice_id', invoiceId)
            .neq('credit_memos.status', 'void'),
        ])
      if (invoiceError) throw invoiceError
      if (linesError) throw linesError
      if (returnsError) throw returnsError

      const share = invoice.subtotal > 0 ? invoice.total / invoice.subtotal : 1
      const byItem = new Map<string, ReturnableLine & { amount: number }>()
      for (const l of lines ?? []) {
        const row = byItem.get(l.item_id) ?? { item_id: l.item_id, location_id: l.location_id, sold: 0, returned: 0, net_price: 0, amount: 0 }
        row.sold += l.quantity
        row.amount += l.line_total * share
        byItem.set(l.item_id, row)
      }
      for (const r of returns ?? []) {
        const row = byItem.get(r.item_id)
        if (row) row.returned += r.quantity
      }
      return {
        customerId: invoice.customer_id,
        lines: [...byItem.values()].map(({ amount, ...row }) => ({
          ...row,
          net_price: row.sold > 0 ? Math.round((amount / row.sold) * 100) / 100 : 0,
        })) satisfies ReturnableLine[],
      }
    },
  })
}

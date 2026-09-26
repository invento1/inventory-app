import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type Invoice = Database['public']['Tables']['invoices']['Row']
export type InvoicePayment = Database['public']['Tables']['invoice_payments']['Row']

export interface InvoiceListRow extends Invoice {
  customer_name: string
}

export function useInvoices(orgId: string) {
  return useQuery({
    queryKey: ['invoices', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, customers(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        customer_name: row.customers?.name ?? '',
      })) satisfies InvoiceListRow[]
    },
  })
}

export interface InvoiceLineRow {
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

export function useInvoice(orgId: string, id: string) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('*, customers(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (invoiceError) throw invoiceError

      const { data: lines, error: linesError } = await supabase
        .from('invoice_items')
        .select('*, items(name, sku), locations(name)')
        .eq('invoice_id', id)
      if (linesError) throw linesError

      const { data: payments, error: paymentsError } = await supabase
        .from('invoice_payments')
        .select('*')
        .eq('invoice_id', id)
        .order('paid_at', { ascending: false })
      if (paymentsError) throw paymentsError

      return {
        invoice: invoice as Invoice & { customers: { name: string } | null },
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
          location_name: l.locations?.name ?? '',
        })) satisfies InvoiceLineRow[],
        payments: (payments ?? []) as InvoicePayment[],
      }
    },
  })
}

export interface InvoiceLinePayload {
  item_id: string
  location_id: string
  quantity: number
  unit_price: number
}

export function useCreateInvoice(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      customerId: string
      dueDate: string
      lines: InvoiceLinePayload[]
      notes: string | null
    }) => {
      // The generated RPC arg types don't reflect that p_lines/p_notes
      // accept a plain object array / null at the SQL level (jsonb and
      // nullable text respectively) -- cast explicitly rather than widen
      // the whole client's generated types, same as create_sales_receipt.
      const { data, error } = await supabase.rpc('create_invoice', {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_due_date: input.dueDate,
        p_lines: input.lines as unknown as Json,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as Invoice
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

export function useRecordInvoicePayment(orgId: string, invoiceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      amount: number
      paymentMethod: string
      paidAt: string
      notes: string | null
    }) => {
      const { data, error } = await supabase.rpc('record_invoice_payment', {
        p_invoice_id: invoiceId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_paid_at: input.paidAt,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as Invoice
    },
    // Payments never touch stock, so unlike create/void there's no
    // stock_levels/stock_movements invalidation here.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      queryClient.invalidateQueries({ queryKey: ['invoices', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

export function useVoidInvoice(orgId: string, invoiceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('void_invoice', { p_invoice_id: invoiceId })
      if (error) throw error
      return data as Invoice
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      queryClient.invalidateQueries({ queryKey: ['invoices', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}

export type InvoiceBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

export function invoiceStatusTone(invoice: {
  status: string
  due_date: string
  amount_paid: number
  total: number
}): { tone: InvoiceBadgeTone; label: string } {
  if (invoice.status === 'void') return { tone: 'neutral', label: 'Void' }
  if (invoice.status === 'paid') return { tone: 'success', label: 'Paid' }

  const isOverdue = new Date(invoice.due_date) < new Date(new Date().toDateString())
  if (isOverdue) return { tone: 'danger', label: 'Overdue' }

  if (invoice.status === 'partially_paid') return { tone: 'warning', label: 'Partially paid' }
  return { tone: 'accent', label: 'Unpaid' }
}

// ---- Customer history on invoices (previous balance, recent invoices and
// payments). Computed server-side "as at" a moment: now, for a new invoice;
// the invoice's creation time, for an existing one (so reprints match).

export interface CustomerHistory {
  as_of: string
  previous_balance: number
  open_invoice_count: number
  credit_total: number
  invoices: { invoice_number: string; issue_date: string; created_at: string; total: number; paid: number; balance: number }[]
  payments: {
    paid_at: string
    created_at: string
    amount: number
    payment_method: string
    reference_number: string | null
    invoice_number: string
  }[]
}

export interface HistoryOptions {
  previousBalance: boolean
  recentInvoices: boolean
  recentPayments: boolean
}

export const NO_HISTORY: HistoryOptions = { previousBalance: false, recentInvoices: false, recentPayments: false }

export const hasHistory = (o: HistoryOptions) => o.previousBalance || o.recentInvoices || o.recentPayments

export function historyOptionsOf(invoice: {
  show_previous_balance: boolean
  show_recent_invoices: boolean
  show_recent_payments: boolean
}): HistoryOptions {
  return {
    previousBalance: invoice.show_previous_balance,
    recentInvoices: invoice.show_recent_invoices,
    recentPayments: invoice.show_recent_payments,
  }
}

// For the New Invoice form: the customer's history right now.
export function useCustomerHistory(orgId: string, customerId: string) {
  return useQuery({
    queryKey: ['customer_history', orgId, customerId],
    enabled: !!customerId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('customer_history', { p_org_id: orgId, p_customer_id: customerId })
      if (error) throw error
      return data as unknown as CustomerHistory
    },
  })
}

// For an existing invoice: the history as it stood when it was created.
export function useInvoiceHistory(orgId: string, invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: ['invoice_customer_history', orgId, invoiceId],
    enabled: enabled && !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('invoice_customer_history', {
        p_org_id: orgId,
        p_invoice_id: invoiceId,
      })
      if (error) throw error
      return data as unknown as CustomerHistory
    },
  })
}

export function useSetInvoiceHistoryOptions(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ invoiceId, options }: { invoiceId: string; options: HistoryOptions }) => {
      const { error } = await supabase.rpc('set_invoice_history_options', {
        p_invoice_id: invoiceId,
        p_previous_balance: options.previousBalance,
        p_recent_invoices: options.recentInvoices,
        p_recent_payments: options.recentPayments,
      })
      if (error) throw error
    },
    onSuccess: (_d, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      queryClient.invalidateQueries({ queryKey: ['printable_invoices', orgId] })
    },
  })
}

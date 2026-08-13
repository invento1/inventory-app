import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type SupplierBill = Database['public']['Tables']['supplier_bills']['Row']
export type SupplierBillPayment = Database['public']['Tables']['supplier_bill_payments']['Row']

export interface SupplierBillListRow extends SupplierBill {
  supplier_name: string
}

export function useSupplierBills(orgId: string) {
  return useQuery({
    queryKey: ['supplier_bills', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_bills')
        .select('*, suppliers(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        supplier_name: row.suppliers?.name ?? '',
      })) satisfies SupplierBillListRow[]
    },
  })
}

export interface SupplierBillLineRow {
  id: string
  item_id: string
  location_id: string
  quantity: number
  unit_cost: number
  line_total: number
  item_name: string
  item_sku: string
  location_name: string
}

export function useSupplierBill(orgId: string, id: string) {
  return useQuery({
    queryKey: ['supplier_bill', id],
    queryFn: async () => {
      const { data: bill, error: billError } = await supabase
        .from('supplier_bills')
        .select('*, suppliers(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (billError) throw billError

      const { data: lines, error: linesError } = await supabase
        .from('supplier_bill_items')
        .select('*, items(name, sku), locations(name)')
        .eq('bill_id', id)
      if (linesError) throw linesError

      const { data: payments, error: paymentsError } = await supabase
        .from('supplier_bill_payments')
        .select('*')
        .eq('bill_id', id)
        .order('paid_at', { ascending: false })
      if (paymentsError) throw paymentsError

      return {
        bill: bill as SupplierBill & { suppliers: { name: string } | null },
        lines: (lines ?? []).map((l) => ({
          ...l,
          item_name: l.items?.name ?? '',
          item_sku: l.items?.sku ?? '',
          location_name: l.locations?.name ?? '',
        })) satisfies SupplierBillLineRow[],
        payments: (payments ?? []) as SupplierBillPayment[],
      }
    },
  })
}

export interface SupplierBillLinePayload {
  item_id: string
  location_id: string
  quantity: number
  unit_cost: number
}

export function useCreateSupplierBill(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      supplierId: string
      dueDate: string
      lines: SupplierBillLinePayload[]
      notes: string | null
    }) => {
      const { data, error } = await supabase.rpc('create_supplier_bill', {
        p_org_id: orgId,
        p_supplier_id: input.supplierId,
        p_due_date: input.dueDate,
        p_lines: input.lines as unknown as Json,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as SupplierBill
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier_bills', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
    },
  })
}

export function useRecordSupplierBillPayment(orgId: string, billId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      amount: number
      paymentMethod: string
      paidAt: string
      notes: string | null
    }) => {
      const { data, error } = await supabase.rpc('record_supplier_bill_payment', {
        p_bill_id: billId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_paid_at: input.paidAt,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as SupplierBill
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier_bill', billId] })
      queryClient.invalidateQueries({ queryKey: ['supplier_bills', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
    },
  })
}

export function useVoidSupplierBill(orgId: string, billId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('void_supplier_bill', { p_bill_id: billId })
      if (error) throw error
      return data as SupplierBill
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier_bill', billId] })
      queryClient.invalidateQueries({ queryKey: ['supplier_bills', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_levels', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
    },
  })
}

export type BillBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

export function billStatusTone(bill: {
  status: string
  due_date: string
  amount_paid: number
  total: number
}): { tone: BillBadgeTone; label: string } {
  if (bill.status === 'void') return { tone: 'neutral', label: 'Void' }
  if (bill.status === 'paid') return { tone: 'success', label: 'Paid' }

  const isOverdue = new Date(bill.due_date) < new Date(new Date().toDateString())
  if (isOverdue) return { tone: 'danger', label: 'Overdue' }

  if (bill.status === 'partially_paid') return { tone: 'warning', label: 'Partially paid' }
  return { tone: 'accent', label: 'Unpaid' }
}

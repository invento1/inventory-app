import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type Expense = Database['public']['Tables']['expenses']['Row']

export interface ExpenseListRow extends Expense {
  payee_supplier_name: string | null
  category_name: string
  account_name: string
}

export function useExpenses(orgId: string) {
  return useQuery({
    queryKey: ['expenses', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, suppliers(name), category:ledger_accounts!expenses_category_account_id_fkey(name), account:ledger_accounts!expenses_account_id_fkey(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        payee_supplier_name: row.suppliers?.name ?? null,
        category_name: row.category?.name ?? '',
        account_name: row.account?.name ?? '',
      })) satisfies ExpenseListRow[]
    },
  })
}

export function useCreateExpense(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      expenseDate: string
      payeeSupplierId: string | null
      payeeName: string | null
      categoryAccountId: string
      amount: number
      paymentMethod: string
      accountId: string | null
      referenceNumber: string | null
      notes: string | null
    }) => {
      const { data, error } = await supabase.rpc('create_expense', {
        p_org_id: orgId,
        p_expense_date: input.expenseDate,
        p_payee_supplier_id: input.payeeSupplierId as unknown as string,
        p_payee_name: input.payeeName as unknown as string,
        p_category_account_id: input.categoryAccountId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_account_id: input.accountId as unknown as string,
        p_reference_number: input.referenceNumber as unknown as string,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as Expense
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

export function useVoidExpense(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (expenseId: string) => {
      const { error } = await supabase.rpc('void_expense', { p_expense_id: expenseId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

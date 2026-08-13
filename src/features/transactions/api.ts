import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type AllTransactionRow = Database['public']['Views']['all_transactions']['Row']

export function useAllTransactions(orgId: string) {
  return useQuery({
    queryKey: ['all_transactions', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('all_transactions')
        .select('*')
        .eq('org_id', orgId)
        .order('txn_date', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as AllTransactionRow[]
    },
  })
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  sales_receipt: 'Sales Receipt',
  invoice: 'Invoice',
  supplier_bill: 'Supplier Bill',
  purchase_order: 'Purchase Order',
  expense: 'Expense',
  quotation: 'Quotation',
  credit_memo: 'Credit Memo',
  refund: 'Refund',
}

export const DOC_TYPE_ROUTES: Record<string, (id: string) => string> = {
  sales_receipt: (id) => `/sales/${id}`,
  invoice: (id) => `/invoices/${id}`,
  supplier_bill: (id) => `/supplier-bills/${id}`,
  purchase_order: (id) => `/purchase-orders/${id}`,
  quotation: (id) => `/quotations/${id}`,
  credit_memo: (id) => `/credit-memos/${id}`,
}

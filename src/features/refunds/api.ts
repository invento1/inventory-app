import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

export type Refund = Database['public']['Tables']['refunds']['Row']

export interface RefundListRow extends Refund {
  customer_name: string
  account_name: string
}

export function useRefunds(orgId: string) {
  return useQuery({
    queryKey: ['refunds', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refunds')
        .select('*, customers(name), ledger_accounts(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        customer_name: row.customers?.name ?? '',
        account_name: row.ledger_accounts?.name ?? '',
      })) satisfies RefundListRow[]
    },
  })
}

export function useCreateRefund(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      customerId: string
      amount: number
      paymentMethod: string
      accountId: string | null
      refundDate: string
      referenceNumber: string | null
      notes: string | null
    }) => {
      const { data, error } = await supabase.rpc('create_refund', {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_account_id: input.accountId as unknown as string,
        p_refund_date: input.refundDate,
        p_reference_number: input.referenceNumber as unknown as string,
        p_notes: input.notes as unknown as string,
      })
      if (error) throw error
      return data as Refund
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refunds', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

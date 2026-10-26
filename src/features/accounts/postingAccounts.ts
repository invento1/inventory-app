import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { LedgerAccountRow } from './api'

// Posting Settings: which ledger account each automatic posting uses. The
// database falls back to the account with the default name when a role isn't
// mapped (see the posting_accounts migration).

export type PostingKey =
  | 'cash'
  | 'bank'
  | 'undeposited_funds'
  | 'accounts_receivable'
  | 'inventory'
  | 'accounts_payable'
  | 'sales_income'
  | 'cost_of_goods_sold'
  | 'purchases'

export interface PostingRole {
  key: PostingKey
  label: string
  defaultName: string
  types: string[]
  // Backed by a sub-ledger: changing it moves the balance across.
  controlled: boolean
  usedFor: string
}

export const POSTING_ROLES: PostingRole[] = [
  { key: 'cash', label: 'Cash', defaultName: 'Cash', types: ['bank'], controlled: false,
    usedFor: 'Cash sales receipts, and cash refunds, expenses and bill payments' },
  { key: 'bank', label: 'Bank', defaultName: 'Bank', types: ['bank'], controlled: false,
    usedFor: 'Card, bank transfer and other non-cash sales, refunds, expenses and bill payments' },
  { key: 'undeposited_funds', label: 'Undeposited Funds', defaultName: 'Undeposited Funds', types: ['other_current_asset'], controlled: true,
    usedFor: 'Customer payments waiting to be deposited (Receive Payment, then Record Deposit)' },
  { key: 'accounts_receivable', label: 'Accounts Receivable', defaultName: 'Accounts Receivable', types: ['accounts_receivable'], controlled: true,
    usedFor: 'What customers owe on invoices' },
  { key: 'inventory', label: 'Inventory', defaultName: 'Inventory', types: ['other_current_asset'], controlled: true,
    usedFor: 'Value of stock on hand (items without their own inventory account)' },
  { key: 'accounts_payable', label: 'Accounts Payable', defaultName: 'Accounts Payable', types: ['accounts_payable'], controlled: true,
    usedFor: 'What you owe suppliers on bills' },
  { key: 'sales_income', label: 'Sales Income', defaultName: 'Sales Income', types: ['income', 'other_income'], controlled: false,
    usedFor: 'Revenue from invoices and sales receipts (items without their own income account), and its reversal on credit memos and refunds' },
  { key: 'cost_of_goods_sold', label: 'Cost of Goods Sold', defaultName: 'Cost of Goods Sold', types: ['cost_of_goods_sold'], controlled: false,
    usedFor: 'Cost of the stock you sell (items without their own cost account)' },
  { key: 'purchases', label: 'Purchases', defaultName: 'Purchases', types: ['expense', 'cost_of_goods_sold', 'other_expense'], controlled: false,
    usedFor: 'Not posted to automatically any more; kept for manual entries' },
]

export function usePostingAccounts(orgId: string) {
  return useQuery({
    queryKey: ['posting_accounts', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('posting_accounts').select('account_key, account_id').eq('org_id', orgId)
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.account_key as PostingKey, r.account_id]))
    },
  })
}

// The account a role resolves to today: its mapping, else the default name.
export function currentPostingAccount(
  role: PostingRole,
  mapped: Map<PostingKey, string> | undefined,
  accounts: LedgerAccountRow[] | undefined,
) {
  const id = mapped?.get(role.key)
  if (id) return { account: accounts?.find((a) => a.id === id), isDefault: false }
  return { account: accounts?.find((a) => a.name === role.defaultName), isDefault: true }
}

export function useSetPostingAccount(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, accountId }: { key: PostingKey; accountId: string }) => {
      const { error } = await supabase.rpc('set_posting_account', { p_org_id: orgId, p_key: key, p_account_id: accountId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posting_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
    },
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type LedgerAccount = Database['public']['Tables']['ledger_accounts']['Row']
export type LedgerAccountInput = Pick<
  Database['public']['Tables']['ledger_accounts']['Insert'],
  'name' | 'account_type' | 'parent_account_id' | 'description' | 'is_active'
>

export const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'bank', label: 'Bank' },
  { value: 'equity', label: 'Equity' },
  { value: 'accounts_receivable', label: 'Accounts Receivable' },
  { value: 'accounts_payable', label: 'Accounts Payable' },
  { value: 'other_current_asset', label: 'Other Current Asset' },
  { value: 'other_asset', label: 'Other Asset' },
  { value: 'fixed_asset', label: 'Fixed Asset' },
  { value: 'other_current_liability', label: 'Other Current Liability' },
  { value: 'long_term_liability', label: 'Long Term Liability' },
  { value: 'cost_of_goods_sold', label: 'Cost of Goods Sold' },
  { value: 'other_income', label: 'Other Income' },
  { value: 'other_expense', label: 'Other Expense' },
]

export const accountTypeLabel = (value: string) =>
  ACCOUNT_TYPES.find((t) => t.value === value)?.label ?? value

export interface LedgerAccountRow extends LedgerAccount {
  balance: number
}

export function useLedgerAccounts(orgId: string) {
  return useQuery({
    queryKey: ['ledger_accounts', orgId],
    queryFn: async () => {
      const [{ data: accounts, error: accountsError }, { data: balances, error: balancesError }] =
        await Promise.all([
          supabase.from('ledger_accounts').select('*').eq('org_id', orgId).order('name'),
          supabase.from('ledger_account_balances').select('account_id, balance').eq('org_id', orgId),
        ])
      if (accountsError) throw accountsError
      if (balancesError) throw balancesError
      const balanceByAccount = new Map((balances ?? []).map((b) => [b.account_id, b.balance ?? 0]))
      return (accounts ?? []).map((a) => ({
        ...a,
        balance: balanceByAccount.get(a.id) ?? 0,
      })) satisfies LedgerAccountRow[]
    },
  })
}

export function useCreateLedgerAccount(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LedgerAccountInput) => {
      const { data, error } = await supabase
        .from('ledger_accounts')
        .insert({ ...input, org_id: orgId })
        .select()
        .single()
      if (error) throw error
      return data as LedgerAccount
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] }),
  })
}

export function useUpdateLedgerAccount(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<LedgerAccountInput> }) => {
      const { data, error } = await supabase
        .from('ledger_accounts')
        .update(input)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()
      if (error) throw error
      return data as LedgerAccount
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] }),
  })
}

export interface JournalLineRow {
  id: string
  entry_date: string
  entry_number: string
  entry_memo: string | null
  account_name: string
  name: string | null
  memo: string | null
  debit: number
  credit: number
}

export function useJournalEntries(orgId: string) {
  return useQuery({
    queryKey: ['journal_entries', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journal_entries')
        .select('id, entry_date, entry_number, memo, journal_lines(id, name, memo, debit, credit, ledger_accounts(name))')
        .eq('org_id', orgId)
        .order('entry_date', { ascending: false })
      if (error) throw error
      const rows: JournalLineRow[] = []
      for (const entry of data ?? []) {
        for (const line of entry.journal_lines ?? []) {
          rows.push({
            id: line.id,
            entry_date: entry.entry_date,
            entry_number: entry.entry_number,
            entry_memo: entry.memo,
            account_name: line.ledger_accounts?.name ?? '',
            name: line.name,
            memo: line.memo,
            debit: line.debit,
            credit: line.credit,
          })
        }
      }
      return rows
    },
  })
}

export interface JournalEntryLinePayload {
  account_id: string
  debit: number
  credit: number
  name: string | null
  memo: string | null
}

export function useCreateJournalEntry(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      entryDate: string
      memo: string | null
      lines: JournalEntryLinePayload[]
    }) => {
      // Same cast pattern as create_sales_receipt/create_invoice: generated
      // RPC arg types don't reflect that p_lines accepts a plain object
      // array (jsonb) at the SQL level.
      const { data, error } = await supabase.rpc('create_journal_entry', {
        p_org_id: orgId,
        p_entry_date: input.entryDate,
        p_memo: input.memo as unknown as string,
        p_lines: input.lines as unknown as Json,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['account_ledger', orgId] })
    },
  })
}

export interface AccountLedgerLine {
  id: string
  entry_date: string
  entry_number: string
  name: string | null
  memo: string | null
  debit: number
  credit: number
  running_balance: number
}

export function useAccountLedger(orgId: string, accountId: string) {
  return useQuery({
    queryKey: ['account_ledger', orgId, accountId],
    queryFn: async () => {
      const { data: account, error: accountError } = await supabase
        .from('ledger_accounts')
        .select('*')
        .eq('id', accountId)
        .eq('org_id', orgId)
        .single()
      if (accountError) throw accountError

      const { data: lines, error: linesError } = await supabase
        .from('journal_lines')
        .select('id, name, memo, debit, credit, journal_entries!inner(entry_date, entry_number, org_id)')
        .eq('account_id', accountId)
        .eq('journal_entries.org_id', orgId)
        .order('entry_date', { referencedTable: 'journal_entries', ascending: true })
      if (linesError) throw linesError

      // Assets/Expenses (debit-normal) increase with a debit; Liabilities/
      // Equity/Income (credit-normal) increase with a credit -- same sign
      // convention as the ledger_account_balances view.
      const creditNormal = [
        'income',
        'equity',
        'accounts_payable',
        'other_current_liability',
        'long_term_liability',
        'other_income',
      ].includes(account.account_type)

      let running = 0
      const ledgerLines: AccountLedgerLine[] = (lines ?? []).map((l) => {
        running += creditNormal ? l.credit - l.debit : l.debit - l.credit
        return {
          id: l.id,
          entry_date: l.journal_entries!.entry_date,
          entry_number: l.journal_entries!.entry_number,
          name: l.name,
          memo: l.memo,
          debit: l.debit,
          credit: l.credit,
          running_balance: running,
        }
      })

      return { account: account as LedgerAccount, lines: ledgerLines }
    },
  })
}

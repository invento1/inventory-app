import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database, Json } from '../../types/supabase'

export type LedgerAccount = Database['public']['Tables']['ledger_accounts']['Row']

export interface ProfitAndLossRow {
  account_id: string
  account_name: string
  account_type: string
  amount: number
}

export function useProfitAndLoss(orgId: string, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['profit_and_loss', orgId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('profit_and_loss', {
        p_org_id: orgId,
        p_start_date: startDate,
        p_end_date: endDate,
      })
      if (error) throw error
      return (data ?? []) as ProfitAndLossRow[]
    },
  })
}
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

export interface OutstandingInvoiceRow {
  id: string
  invoice_number: string
  due_date: string
  balance: number
  is_overdue: boolean
}

export function useOutstandingInvoicesForCustomer(orgId: string, customerId: string) {
  return useQuery({
    queryKey: ['outstanding_invoices', orgId, customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outstanding_invoices')
        .select('id, invoice_number, due_date, balance, is_overdue')
        .eq('org_id', orgId)
        .eq('customer_id', customerId)
        .order('due_date')
      if (error) throw error
      return (data ?? []) as OutstandingInvoiceRow[]
    },
  })
}

export interface OutstandingBillRow {
  id: string
  bill_number: string
  due_date: string
  balance: number
  is_overdue: boolean
}

export function useOutstandingBillsForSupplier(orgId: string, supplierId: string) {
  return useQuery({
    queryKey: ['outstanding_supplier_bills', orgId, supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outstanding_supplier_bills')
        .select('id, bill_number, due_date, balance, is_overdue')
        .eq('org_id', orgId)
        .eq('supplier_id', supplierId)
        .order('due_date')
      if (error) throw error
      return (data ?? []) as OutstandingBillRow[]
    },
  })
}

export interface OutstandingBillWithSupplierRow extends OutstandingBillRow {
  supplier_id: string
  supplier_name: string
}

// All open bills org-wide, for Pay Bills' "General (all suppliers)" mode --
// filtered client-side to one supplier when one is selected.
export function useAllOutstandingBills(orgId: string) {
  return useQuery({
    queryKey: ['outstanding_supplier_bills', orgId, 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outstanding_supplier_bills')
        .select('id, bill_number, supplier_id, supplier_name, due_date, balance, is_overdue')
        .eq('org_id', orgId)
        .order('due_date')
      if (error) throw error
      return (data ?? []) as OutstandingBillWithSupplierRow[]
    },
  })
}

export interface PaymentAllocation {
  amount: number
}

export function useApplyCustomerPayment(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      customerId: string
      amount: number
      paymentMethod: string
      paidAt: string
      notes: string | null
      referenceNumber: string | null
      allocations: { invoice_id: string; amount: number }[]
    }) => {
      const { error } = await supabase.rpc('apply_customer_payment', {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_paid_at: input.paidAt,
        p_notes: input.notes as unknown as string,
        p_allocations: input.allocations as unknown as Json,
        p_reference_number: input.referenceNumber as unknown as string,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outstanding_invoices', orgId] })
      queryClient.invalidateQueries({ queryKey: ['invoices', orgId] })
      queryClient.invalidateQueries({ queryKey: ['invoice_payments', orgId] })
      queryClient.invalidateQueries({ queryKey: ['undeposited_payments', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

export function useApplySupplierPayment(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      supplierId: string
      amount: number
      paymentMethod: string
      paidAt: string
      notes: string | null
      referenceNumber: string | null
      accountId: string | null
      allocations: { bill_id: string; amount: number }[]
    }) => {
      const { error } = await supabase.rpc('apply_supplier_payment', {
        p_org_id: orgId,
        p_supplier_id: input.supplierId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_paid_at: input.paidAt,
        p_notes: input.notes as unknown as string,
        p_allocations: input.allocations as unknown as Json,
        p_account_id: input.accountId as unknown as string,
        p_reference_number: input.referenceNumber as unknown as string,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outstanding_supplier_bills', orgId] })
      queryClient.invalidateQueries({ queryKey: ['supplier_bills', orgId] })
      queryClient.invalidateQueries({ queryKey: ['supplier_bill_payments', orgId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

export function useCreateFundTransfer(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      fromAccountId: string
      toAccountId: string
      amount: number
      transferDate: string
      memo: string | null
    }) => {
      const { data, error } = await supabase.rpc('create_fund_transfer', {
        p_org_id: orgId,
        p_from_account_id: input.fromAccountId,
        p_to_account_id: input.toAccountId,
        p_amount: input.amount,
        p_transfer_date: input.transferDate,
        p_memo: input.memo as unknown as string,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
      queryClient.invalidateQueries({ queryKey: ['fund_transfers', orgId] })
    },
  })
}

export interface FundTransferRow {
  id: string
  entry_date: string
  entry_number: string
  memo: string | null
  lines: { account_name: string; debit: number; credit: number }[]
}

export function useFundTransfers(orgId: string) {
  return useQuery({
    queryKey: ['fund_transfers', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journal_entries')
        .select('id, entry_date, entry_number, memo, journal_lines(debit, credit, ledger_accounts(name))')
        .eq('org_id', orgId)
        .eq('reference_type', 'fund_transfer')
        .order('entry_date', { ascending: false })
      if (error) throw error
      return (data ?? []).map((entry) => ({
        id: entry.id,
        entry_date: entry.entry_date,
        entry_number: entry.entry_number,
        memo: entry.memo,
        lines: (entry.journal_lines ?? []).map((l) => ({
          account_name: l.ledger_accounts?.name ?? '',
          debit: l.debit,
          credit: l.credit,
        })),
      })) satisfies FundTransferRow[]
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

export interface InvoicePaymentRow {
  id: string
  paid_at: string
  amount: number
  payment_method: string
  reference_number: string | null
  deposit_id: string | null
  invoice_id: string
  invoice_number: string
  customer_name: string
}

export function useInvoicePayments(orgId: string) {
  return useQuery({
    queryKey: ['invoice_payments', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_payments')
        .select(
          'id, paid_at, amount, payment_method, reference_number, deposit_id, invoice_id, invoices(invoice_number, customers(name))',
        )
        .eq('org_id', orgId)
        .order('paid_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((p) => ({
        id: p.id,
        paid_at: p.paid_at,
        amount: p.amount,
        payment_method: p.payment_method,
        reference_number: p.reference_number,
        deposit_id: p.deposit_id,
        invoice_id: p.invoice_id,
        invoice_number: p.invoices?.invoice_number ?? '',
        customer_name: p.invoices?.customers?.name ?? '',
      })) satisfies InvoicePaymentRow[]
    },
  })
}

export function useUndepositedPayments(orgId: string) {
  return useQuery({
    queryKey: ['undeposited_payments', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_payments')
        .select('id, paid_at, amount, reference_number, invoices(invoice_number, customers(name))')
        .eq('org_id', orgId)
        .is('deposit_id', null)
        .order('paid_at')
      if (error) throw error
      return (data ?? []).map((p) => ({
        id: p.id,
        paid_at: p.paid_at,
        amount: p.amount,
        reference_number: p.reference_number,
        invoice_number: p.invoices?.invoice_number ?? '',
        customer_name: p.invoices?.customers?.name ?? '',
      }))
    },
  })
}

export type Deposit = Database['public']['Tables']['deposits']['Row']

export interface DepositRow extends Deposit {
  account_name: string
}

export function useDeposits(orgId: string) {
  return useQuery({
    queryKey: ['deposits', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposits')
        .select('*, ledger_accounts(name)')
        .eq('org_id', orgId)
        .order('deposit_date', { ascending: false })
      if (error) throw error
      return (data ?? []).map((d) => ({
        ...d,
        account_name: d.ledger_accounts?.name ?? '',
      })) satisfies DepositRow[]
    },
  })
}

export function useDeposit(orgId: string, id: string) {
  return useQuery({
    queryKey: ['deposit', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: deposit, error: depositError } = await supabase
        .from('deposits')
        .select('*, ledger_accounts(name)')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()
      if (depositError) throw depositError

      const { data: payments, error: paymentsError } = await supabase
        .from('invoice_payments')
        .select('id, amount, reference_number, invoices(invoice_number, customers(name))')
        .eq('deposit_id', id)
      if (paymentsError) throw paymentsError

      return {
        deposit: deposit as Deposit & { ledger_accounts: { name: string } | null },
        payments: (payments ?? []).map((p) => ({
          id: p.id,
          amount: p.amount,
          reference_number: p.reference_number,
          invoice_number: p.invoices?.invoice_number ?? '',
          customer_name: p.invoices?.customers?.name ?? '',
        })),
      }
    },
  })
}

export function useRecordDeposit(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      accountId: string
      depositDate: string
      memo: string | null
      paymentIds: string[]
    }) => {
      const { data, error } = await supabase.rpc('record_deposit', {
        p_org_id: orgId,
        p_account_id: input.accountId,
        p_deposit_date: input.depositDate,
        p_memo: input.memo as unknown as string,
        p_payment_ids: input.paymentIds,
      })
      if (error) throw error
      return data as Deposit
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['undeposited_payments', orgId] })
      queryClient.invalidateQueries({ queryKey: ['invoice_payments', orgId] })
      queryClient.invalidateQueries({ queryKey: ['deposits', orgId] })
      queryClient.invalidateQueries({ queryKey: ['ledger_accounts', orgId] })
      queryClient.invalidateQueries({ queryKey: ['journal_entries', orgId] })
    },
  })
}

export interface SupplierBillPaymentRow {
  id: string
  paid_at: string
  amount: number
  payment_method: string
  reference_number: string | null
  bill_id: string
  bill_number: string
  supplier_name: string
  account_name: string
}

export function useSupplierBillPayments(orgId: string) {
  return useQuery({
    queryKey: ['supplier_bill_payments', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_bill_payments')
        .select(
          'id, paid_at, amount, payment_method, reference_number, bill_id, supplier_bills(bill_number, suppliers(name)), ledger_accounts(name)',
        )
        .eq('org_id', orgId)
        .order('paid_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((p) => ({
        id: p.id,
        paid_at: p.paid_at,
        amount: p.amount,
        payment_method: p.payment_method,
        reference_number: p.reference_number,
        bill_id: p.bill_id,
        bill_number: p.supplier_bills?.bill_number ?? '',
        supplier_name: p.supplier_bills?.suppliers?.name ?? '',
        account_name: p.ledger_accounts?.name ?? '',
      })) satisfies SupplierBillPaymentRow[]
    },
  })
}

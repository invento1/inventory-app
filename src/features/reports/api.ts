import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { Database } from '../../types/supabase'

type Fns = Database['public']['Functions']
export type BalanceSheetRow = Fns['balance_sheet']['Returns'][number]
export type TrialBalanceRow = Fns['trial_balance']['Returns'][number]
export type GeneralLedgerRow = Fns['general_ledger']['Returns'][number]
export type JournalReportRow = Fns['journal_report']['Returns'][number]
export type ProfitAndLossRow = Fns['profit_and_loss']['Returns'][number]

// Report RPCs are plain read-only SQL functions; every hook below is a thin
// useQuery wrapper keyed on its arguments, disabled until the arguments are
// valid (e.g. a date range whose From is after its To).

export function useProfitAndLossReport(orgId: string, start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ['report', 'profit_and_loss', orgId, start, end],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('profit_and_loss', {
        p_org_id: orgId,
        p_start_date: start,
        p_end_date: end,
      })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useBalanceSheet(orgId: string, asOf: string, enabled = true) {
  return useQuery({
    queryKey: ['report', 'balance_sheet', orgId, asOf],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('balance_sheet', { p_org_id: orgId, p_as_of: asOf })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useTrialBalance(orgId: string, asOf: string, enabled = true) {
  return useQuery({
    queryKey: ['report', 'trial_balance', orgId, asOf],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('trial_balance', { p_org_id: orgId, p_as_of: asOf })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useGeneralLedger(
  orgId: string,
  start: string,
  end: string,
  accountId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['report', 'general_ledger', orgId, start, end, accountId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('general_ledger', {
        p_org_id: orgId,
        p_start_date: start,
        p_end_date: end,
        ...(accountId ? { p_account_id: accountId } : {}),
      })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useJournalReport(orgId: string, start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ['report', 'journal_report', orgId, start, end],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('journal_report', {
        p_org_id: orgId,
        p_start_date: start,
        p_end_date: end,
      })
      if (error) throw error
      return data ?? []
    },
  })
}

// Groups general_ledger rows (one per journal line, each repeating its
// account's columns) into one block per account.
export interface LedgerAccountBlock {
  accountId: string
  accountName: string
  accountType: string
  opening: number
  closing: number
  totalDebit: number
  totalCredit: number
  lines: GeneralLedgerRow[]
}

export function groupLedger(rows: GeneralLedgerRow[]): LedgerAccountBlock[] {
  const blocks: LedgerAccountBlock[] = []
  let current: LedgerAccountBlock | undefined
  for (const row of rows) {
    if (!current || current.accountId !== row.account_id) {
      current = {
        accountId: row.account_id,
        accountName: row.account_name,
        accountType: row.account_type,
        opening: row.opening_balance,
        closing: row.opening_balance,
        totalDebit: 0,
        totalCredit: 0,
        lines: [],
      }
      blocks.push(current)
    }
    if (row.line_id) {
      current.lines.push(row)
      current.closing = row.running_balance
      current.totalDebit += row.debit
      current.totalCredit += row.credit
    }
  }
  return blocks
}

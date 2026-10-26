import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/currency'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

// Credit memos applied to invoices. Applying moves no money and posts nothing:
// it records which invoice a credit settles, so that invoice's balance drops.

export interface CreditApplicationRow {
  id: string
  amount: number
  applied_date: string | null
  credit_memo_id: string
  credit_memo_number: string
  invoice_id: string
  invoice_number: string
}

function mapApplication(row: {
  id: string
  amount: number
  applied_date: string | null
  credit_memo_id: string
  invoice_id: string
  credit_memos: { credit_memo_number: string } | null
  invoices: { invoice_number: string } | null
}): CreditApplicationRow {
  return {
    id: row.id,
    amount: row.amount,
    applied_date: row.applied_date,
    credit_memo_id: row.credit_memo_id,
    credit_memo_number: row.credit_memos?.credit_memo_number ?? '',
    invoice_id: row.invoice_id,
    invoice_number: row.invoices?.invoice_number ?? '',
  }
}

const APPLICATION_SELECT =
  'id, amount, applied_date, credit_memo_id, invoice_id, credit_memos(credit_memo_number), invoices(invoice_number)'

export function useCreditApplications(orgId: string, by: { invoiceId?: string; creditMemoId?: string }) {
  return useQuery({
    queryKey: ['credit_applications', orgId, by],
    queryFn: async () => {
      let query = supabase.from('credit_memo_applications').select(APPLICATION_SELECT).eq('org_id', orgId)
      if (by.invoiceId) query = query.eq('invoice_id', by.invoiceId)
      if (by.creditMemoId) query = query.eq('credit_memo_id', by.creditMemoId)
      const { data, error } = await query.order('created_at')
      if (error) throw error
      return (data ?? []).map(mapApplication)
    },
  })
}

export interface OpenCreditRow {
  id: string
  credit_memo_number: string
  issue_date: string
  remaining: number
}

// The customer's credit memos with credit still to apply.
export function useOpenCredits(orgId: string, customerId: string | null | undefined) {
  return useQuery({
    queryKey: ['open_credits', orgId, customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_memos')
        .select('id, credit_memo_number, issue_date, total, amount_applied')
        .eq('org_id', orgId)
        .eq('customer_id', customerId!)
        .eq('status', 'open')
        .order('issue_date')
      if (error) throw error
      return (data ?? [])
        .map((c) => ({ id: c.id, credit_memo_number: c.credit_memo_number, issue_date: c.issue_date, remaining: c.total - c.amount_applied }))
        .filter((c) => c.remaining > 0) satisfies OpenCreditRow[]
    },
  })
}

function invalidateCredits(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  for (const key of [
    ['credit_applications', orgId],
    ['open_credits', orgId],
    ['invoice'],
    ['invoices', orgId],
    ['credit_memo'],
    ['credit_memos', orgId],
    ['outstanding_invoices', orgId],
    ['dashboard', orgId],
    ['printable_invoices', orgId],
  ]) {
    queryClient.invalidateQueries({ queryKey: key })
  }
}

export function useApplyCredit(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { creditMemoId: string; invoiceId: string; amount: number }) => {
      const { error } = await supabase.rpc('apply_credit_memo', {
        p_org_id: orgId,
        p_credit_memo_id: input.creditMemoId,
        p_invoice_id: input.invoiceId,
        p_amount: input.amount,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateCredits(queryClient, orgId),
  })
}

export function useRemoveCreditApplication(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase.rpc('remove_credit_application', { p_application_id: applicationId })
      if (error) throw error
    },
    onSuccess: () => invalidateCredits(queryClient, orgId),
  })
}

export interface CreditChoice {
  id: string
  label: string
  available: number
}

// Pick the other side (a credit memo, or an invoice) and an amount. The
// amount starts at the most that fits: the smaller of what's available on
// both sides.
export function ApplyCreditModal({
  orgId,
  title,
  fixedSide,
  fixedAvailable,
  choiceLabel,
  choices,
  currencySymbol,
  onClose,
}: {
  orgId: string
  title: string
  fixedSide: { creditMemoId: string } | { invoiceId: string }
  fixedAvailable: number
  choiceLabel: string
  choices: CreditChoice[]
  currencySymbol: string
  onClose: () => void
}) {
  const toast = useToast()
  const apply = useApplyCredit(orgId)
  const room = (choice: CreditChoice | undefined) => Math.min(fixedAvailable, choice?.available ?? 0)
  const [choiceId, setChoiceId] = useState(choices[0]?.id ?? '')
  const [amount, setAmount] = useState(String(room(choices[0])))
  const [error, setError] = useState<string | null>(null)
  const chosen = choices.find((c) => c.id === choiceId)

  function choose(id: string) {
    setChoiceId(id)
    setAmount(String(room(choices.find((c) => c.id === id))))
  }

  async function save() {
    setError(null)
    const value = Number(amount)
    if (!chosen || !(value > 0)) {
      setError('Enter an amount above zero')
      return
    }
    if (value > room(chosen) + 0.000001) {
      setError(`At most ${formatMoney(room(chosen), currencySymbol)} can be applied here`)
      return
    }
    try {
      await apply.mutateAsync(
        'creditMemoId' in fixedSide
          ? { creditMemoId: fixedSide.creditMemoId, invoiceId: chosen.id, amount: value }
          : { creditMemoId: chosen.id, invoiceId: fixedSide.invoiceId, amount: value },
      )
      toast.success('Credit applied')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Select label={choiceLabel} value={choiceId} onChange={(e) => choose(e.target.value)}>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({formatMoney(c.available, currencySymbol)})
            </option>
          ))}
        </Select>
        <Input
          label="Amount to apply"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className="text-xs text-text-muted">
          Applying a credit doesn't move any money. It marks part of the invoice as settled by the credit memo, so the
          invoice's balance goes down.
        </p>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={apply.isPending}>
            {apply.isPending ? 'Applying…' : 'Apply credit'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

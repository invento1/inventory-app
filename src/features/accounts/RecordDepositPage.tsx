import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useUndepositedPayments, useRecordDeposit, useLedgerAccounts } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function RecordDepositPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: undeposited, isLoading } = useUndepositedPayments(orgId)
  const { data: accounts } = useLedgerAccounts(orgId)
  const recordDeposit = useRecordDeposit(orgId)

  const bankAccounts = useMemo(() => (accounts ?? []).filter((a) => a.account_type === 'bank'), [accounts])

  const [accountId, setAccountId] = useState('')
  const [depositDate, setDepositDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  function toggleAll(value: boolean) {
    const next: Record<string, boolean> = {}
    undeposited?.forEach((p) => (next[p.id] = value))
    setChecked(next)
  }

  const selectedIds = Object.entries(checked)
    .filter(([, v]) => v)
    .map(([id]) => id)
  const total = (undeposited ?? [])
    .filter((p) => checked[p.id])
    .reduce((sum, p) => sum + p.amount, 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!accountId) {
      setError('Select the bank account to deposit into.')
      return
    }
    if (selectedIds.length === 0) {
      setError('Select at least one payment to deposit.')
      return
    }

    try {
      await recordDeposit.mutateAsync({
        accountId,
        depositDate,
        memo: memo || null,
        paymentIds: selectedIds,
      })
      toast.success('Deposit recorded')
      navigate('/account/view-deposits')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (isLoading) return <PageSpinner />

  return (
    <div>
      <PageHeader title="Record deposit" subtitle="Batch undeposited payments into a real bank account" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-3 gap-4">
              <Select label="Deposit to" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select an account…</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Date"
                type="date"
                required
                value={depositDate}
                onChange={(e) => setDepositDate(e.target.value)}
              />
              <Input label="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-0">
            {!undeposited || undeposited.length === 0 ? (
              <EmptyState message="No payments to deposit. Recorded customer payments awaiting deposit appear here." />
            ) : (
              <Table>
                <THead>
                  <Th>
                    <input
                      type="checkbox"
                      checked={selectedIds.length === undeposited.length}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </Th>
                  <Th>Date</Th>
                  <Th>Customer</Th>
                  <Th>Invoice #</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Amount</Th>
                </THead>
                <tbody>
                  {undeposited.map((p) => (
                    <Tr key={p.id}>
                      <Td>
                        <input
                          type="checkbox"
                          checked={!!checked[p.id]}
                          onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))}
                        />
                      </Td>
                      <Td>{new Date(p.paid_at).toLocaleDateString()}</Td>
                      <Td>{p.customer_name}</Td>
                      <Td className="font-medium">{p.invoice_number}</Td>
                      <Td>{p.reference_number ?? '—'}</Td>
                      <Td className="text-right">{formatMoney(p.amount, currencySymbol)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="flex items-center justify-end gap-4 border-t border-border p-4 text-sm">
              <span className="font-semibold text-text">Total to deposit: {formatMoney(total, currencySymbol)}</span>
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={recordDeposit.isPending || !undeposited?.length}>
            {recordDeposit.isPending ? 'Depositing…' : 'Deposit'}
          </Button>
        </div>
      </form>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useLedgerAccounts, useCreateFundTransfer, useFundTransfers } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function BankingPage() {
  const { orgId, currencySymbol } = useOrg()
  const toast = useToast()
  const { data: accounts } = useLedgerAccounts(orgId)
  const { data: transfers, isLoading } = useFundTransfers(orgId)
  const createTransfer = useCreateFundTransfer(orgId)

  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [transferDate, setTransferDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fromAccountId || !toAccountId) {
      setError('Choose both a from and to account.')
      return
    }
    if (fromAccountId === toAccountId) {
      setError('From and to accounts must be different.')
      return
    }
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    try {
      await createTransfer.mutateAsync({
        fromAccountId,
        toAccountId,
        amount: amountNum,
        transferDate,
        memo: memo || null,
      })
      toast.success('Transfer posted')
      setAmount('')
      setMemo('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader title="Banking" subtitle="Move funds between ledger accounts" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-5 gap-4">
              <Select
                label="From account"
                required
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
              >
                <option value="">Select an account…</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Select
                label="To account"
                required
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
              >
                <option value="">Select an account…</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Amount"
                type="number"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Input
                label="Date"
                type="date"
                required
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
              />
              <Input label="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
            {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}
            <div className="mt-4 flex justify-end">
              <Button type="submit" disabled={createTransfer.isPending}>
                {createTransfer.isPending ? 'Transferring…' : 'Transfer funds'}
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>

      <Card>
        <CardHeader title="Transfer history" />
        <CardBody className="p-0">
          {isLoading ? (
            <PageSpinner />
          ) : (
            <Table>
              <THead>
                <Th>Date</Th>
                <Th>Entry #</Th>
                <Th>Memo</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th className="text-right">Amount</Th>
              </THead>
              <tbody>
                {(!transfers || transfers.length === 0) && (
                  <EmptyState message="No fund transfers yet." />
                )}
                {transfers?.map((t) => {
                  const to = t.lines.find((l) => l.debit > 0)
                  const from = t.lines.find((l) => l.credit > 0)
                  return (
                    <Tr key={t.id}>
                      <Td>{t.entry_date}</Td>
                      <Td>{t.entry_number}</Td>
                      <Td>{t.memo ?? '—'}</Td>
                      <Td>{from?.account_name ?? '—'}</Td>
                      <Td>{to?.account_name ?? '—'}</Td>
                      <Td className="text-right">{formatMoney(to?.debit ?? 0, currencySymbol)}</Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

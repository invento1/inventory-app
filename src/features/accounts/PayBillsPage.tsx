import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useSuppliers } from '../suppliers/api'
import { useAllOutstandingBills, useApplySupplierPayment, useLedgerAccounts } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Same waterfall split as Receive Payment -- ported from the reference
// app's "Lump sum -> Split" handler.
function splitEqually(lump: number, balances: number[]): number[] {
  const alloc = balances.map(() => 0)
  let remaining = lump
  let active = balances.map((_, i) => i)
  while (remaining > 0.005 && active.length > 0) {
    const share = remaining / active.length
    let progressed = false
    const next: number[] = []
    for (const i of active) {
      const room = balances[i] - alloc[i]
      const give = Math.min(share, room)
      alloc[i] += give
      remaining -= give
      if (balances[i] - alloc[i] > 0.005) next.push(i)
      if (give > 0.0001) progressed = true
    }
    active = next
    if (!progressed) break
  }
  return alloc
}

export function PayBillsPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: suppliers } = useSuppliers(orgId)
  const { data: allBills, isLoading } = useAllOutstandingBills(orgId)
  const { data: accounts } = useLedgerAccounts(orgId)
  const applyPayment = useApplySupplierPayment(orgId)

  const bankAccounts = useMemo(() => (accounts ?? []).filter((a) => a.account_type === 'bank'), [accounts])

  const [supplierId, setSupplierId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paidAt, setPaidAt] = useState(today())
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [lumpSum, setLumpSum] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const bills = useMemo(
    () => (allBills ?? []).filter((b) => !supplierId || b.supplier_id === supplierId),
    [allBills, supplierId],
  )

  const selectedAccount = accounts?.find((a) => a.id === accountId)
  const allocatedTotal = Object.values(allocations).reduce((sum, v) => sum + (Number(v) || 0), 0)
  const endingBalance = selectedAccount ? selectedAccount.balance - allocatedTotal : null

  function toggleBill(billId: string, balance: number, checked: boolean) {
    setAllocations((current) => {
      const next = { ...current }
      if (checked) {
        next[billId] = balance.toFixed(2)
      } else {
        delete next[billId]
      }
      return next
    })
  }

  function setAllocationAmount(billId: string, value: string) {
    setAllocations((current) => ({ ...current, [billId]: value }))
  }

  function handleSplit() {
    const lump = Number(lumpSum) || 0
    if (lump <= 0) {
      toast.error('Enter a lump sum amount first.')
      return
    }
    if (bills.length === 0) {
      toast.error('No open bills to split across.')
      return
    }
    const shares = splitEqually(
      lump,
      bills.map((b) => b.balance),
    )
    const next: Record<string, string> = {}
    bills.forEach((b, i) => {
      if (shares[i] > 0) next[b.id] = shares[i].toFixed(2)
    })
    setAllocations(next)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!supplierId) {
      setError('Choose which supplier you’re paying.')
      return
    }
    if (!accountId) {
      setError('Select the account to pay from.')
      return
    }
    const allocationEntries = Object.entries(allocations)
      .map(([bill_id, v]) => ({ bill_id, amount: Number(v) || 0 }))
      .filter((a) => a.amount > 0)
    if (allocationEntries.length === 0) {
      setError('Tick at least one bill, or enter a lump sum and click Split.')
      return
    }

    try {
      await applyPayment.mutateAsync({
        supplierId,
        amount: allocatedTotal,
        paymentMethod,
        paidAt,
        notes: notes || null,
        referenceNumber: referenceNumber || null,
        accountId,
        allocations: allocationEntries,
      })
      toast.success('Payment recorded')
      navigate('/account/view-paid-bills')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader title="Pay bills" subtitle="Pay a supplier's open bills from a chosen account" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Pay to"
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value)
                  setAllocations({})
                }}
              >
                <option value="">General (all suppliers)</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Date"
                type="date"
                required
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
              <div className="flex flex-col gap-1">
                <Select
                  label="Account"
                  required
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Select an account…</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                {selectedAccount && endingBalance !== null && (
                  <span className="text-xs text-text-muted">
                    Balance {formatMoney(selectedAccount.balance, currencySymbol)} → ending{' '}
                    {formatMoney(endingBalance, currencySymbol)}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <Select
                label="Payment method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </Select>
              <Input
                label="Reference no."
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
              <Input label="Memo" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-0">
            {isLoading ? (
              <div className="p-6 text-sm text-text-muted">Loading…</div>
            ) : (
              <Table>
                <THead>
                  <Th></Th>
                  <Th>Bill #</Th>
                  <Th>Supplier</Th>
                  <Th>Due date</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="text-right">Amount to pay</Th>
                </THead>
                <tbody>
                  {bills.length === 0 && <EmptyState message="No open bills." />}
                  {bills.map((bill) => {
                    const checked = bill.id in allocations
                    return (
                      <Tr key={bill.id}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleBill(bill.id, bill.balance, e.target.checked)}
                          />
                        </Td>
                        <Td className="font-medium">{bill.bill_number}</Td>
                        <Td>{bill.supplier_name}</Td>
                        <Td>
                          {bill.due_date} {bill.is_overdue && <Badge tone="danger">Overdue</Badge>}
                        </Td>
                        <Td className="text-right">{formatMoney(bill.balance, currencySymbol)}</Td>
                        <Td className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="text-right"
                            disabled={!checked}
                            value={allocations[bill.id] ?? ''}
                            onChange={(e) => setAllocationAmount(bill.id, e.target.value)}
                          />
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
            <div className="flex items-center justify-end gap-3 border-t border-border p-4 text-sm">
              <span className="text-text-muted">Lump sum (split equally)</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="w-32"
                value={lumpSum}
                onChange={(e) => setLumpSum(e.target.value)}
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleSplit}>
                Split
              </Button>
              <span className="ml-4 font-semibold text-text">
                Total to pay: {formatMoney(allocatedTotal, currencySymbol)}
              </span>
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={applyPayment.isPending}>
            {applyPayment.isPending ? 'Paying…' : 'Pay bills'}
          </Button>
        </div>
      </form>
    </div>
  )
}

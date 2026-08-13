import { useState, type FormEvent } from 'react'
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
import { useCustomers } from '../customers/api'
import { useOutstandingInvoicesForCustomer, useApplyCustomerPayment } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Splits a lump sum equally across every open invoice, capped at each
// invoice's own balance, rolling any remainder forward to the invoices
// that still have room -- ported from the reference app's "Lump sum ->
// Split" waterfall algorithm.
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

export function ReceivePaymentPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: customers } = useCustomers(orgId)
  const applyPayment = useApplyCustomerPayment(orgId)

  const [customerId, setCustomerId] = useState('')
  const { data: outstanding, isLoading } = useOutstandingInvoicesForCustomer(orgId, customerId)

  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paidAt, setPaidAt] = useState(today())
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [lumpSum, setLumpSum] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  function toggleInvoice(invoiceId: string, balance: number, checked: boolean) {
    setAllocations((current) => {
      const next = { ...current }
      if (checked) {
        next[invoiceId] = balance.toFixed(2)
      } else {
        delete next[invoiceId]
      }
      return next
    })
  }

  function setAllocationAmount(invoiceId: string, value: string) {
    setAllocations((current) => ({ ...current, [invoiceId]: value }))
  }

  function handleSplit() {
    const lump = Number(lumpSum) || 0
    if (lump <= 0) {
      toast.error('Enter a lump sum amount first.')
      return
    }
    if (!outstanding || outstanding.length === 0) {
      toast.error('Select a customer with open invoices.')
      return
    }
    const shares = splitEqually(
      lump,
      outstanding.map((inv) => inv.balance),
    )
    const next: Record<string, string> = {}
    outstanding.forEach((inv, i) => {
      if (shares[i] > 0) next[inv.id] = shares[i].toFixed(2)
    })
    setAllocations(next)
  }

  const allocatedTotal = Object.values(allocations).reduce((sum, v) => sum + (Number(v) || 0), 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Choose a customer.')
      return
    }
    const allocationEntries = Object.entries(allocations)
      .map(([invoice_id, v]) => ({ invoice_id, amount: Number(v) || 0 }))
      .filter((a) => a.amount > 0)
    if (allocationEntries.length === 0) {
      setError('Tick at least one invoice, or enter a lump sum and click Split.')
      return
    }

    try {
      await applyPayment.mutateAsync({
        customerId,
        amount: allocatedTotal,
        paymentMethod,
        paidAt,
        notes: notes || null,
        referenceNumber: referenceNumber || null,
        allocations: allocationEntries,
      })
      toast.success('Payment recorded')
      navigate('/account/view-payments')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader title="Receive payment" subtitle="Record a customer payment against their open invoices" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-4 gap-4">
              <Select
                label="Received from"
                required
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value)
                  setAllocations({})
                }}
              >
                <option value="">Select a customer…</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
            </div>
            <div className="mt-4">
              <Input label="Memo" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-0">
            {!customerId ? (
              <div className="p-6 text-sm text-text-muted">Choose a customer to see their open invoices.</div>
            ) : isLoading ? (
              <div className="p-6 text-sm text-text-muted">Loading…</div>
            ) : (
              <Table>
                <THead>
                  <Th></Th>
                  <Th>Invoice #</Th>
                  <Th>Due date</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="text-right">Amount to pay</Th>
                </THead>
                <tbody>
                  {(!outstanding || outstanding.length === 0) && (
                    <EmptyState message="No open invoices for this customer." />
                  )}
                  {outstanding?.map((inv) => {
                    const checked = inv.id in allocations
                    return (
                      <Tr key={inv.id}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleInvoice(inv.id, inv.balance, e.target.checked)}
                          />
                        </Td>
                        <Td className="font-medium">{inv.invoice_number}</Td>
                        <Td>
                          {inv.due_date} {inv.is_overdue && <Badge tone="danger">Overdue</Badge>}
                        </Td>
                        <Td className="text-right">{formatMoney(inv.balance, currencySymbol)}</Td>
                        <Td className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="text-right"
                            disabled={!checked}
                            value={allocations[inv.id] ?? ''}
                            onChange={(e) => setAllocationAmount(inv.id, e.target.value)}
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
                Total received: {formatMoney(allocatedTotal, currencySymbol)}
              </span>
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={applyPayment.isPending}>
            {applyPayment.isPending ? 'Recording…' : 'Receive payment'}
          </Button>
        </div>
      </form>
    </div>
  )
}

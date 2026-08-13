import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
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

export function CustomerPaymentPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: customers } = useCustomers(orgId)
  const applyPayment = useApplyCustomerPayment(orgId)

  const [customerId, setCustomerId] = useState('')
  const { data: outstanding, isLoading } = useOutstandingInvoicesForCustomer(orgId, customerId)

  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paidAt, setPaidAt] = useState(today())
  const [notes, setNotes] = useState('')
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

  const allocatedTotal = Object.values(allocations).reduce((sum, v) => sum + (Number(v) || 0), 0)
  const amountNum = Number(amount) || 0
  const outBy = Math.round((amountNum - allocatedTotal) * 100) / 100
  const balanced = allocatedTotal > 0 && Math.abs(outBy) < 0.005

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Choose a customer.')
      return
    }
    if (!amountNum || amountNum <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    const allocationEntries = Object.entries(allocations)
      .map(([invoice_id, v]) => ({ invoice_id, amount: Number(v) || 0 }))
      .filter((a) => a.amount > 0)
    if (allocationEntries.length === 0) {
      setError('Check at least one invoice to apply this payment to.')
      return
    }
    if (!balanced) {
      setError(`Allocated amounts must add up to the payment amount (out by ${formatMoney(Math.abs(outBy), currencySymbol)}).`)
      return
    }

    try {
      await applyPayment.mutateAsync({
        customerId,
        amount: amountNum,
        paymentMethod,
        paidAt,
        notes: notes || null,
        allocations: allocationEntries,
      })
      toast.success('Payment applied')
      setAmount('')
      setAllocations({})
      navigate('/invoices')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="Customer payment"
        subtitle="Apply one payment across a customer's open invoices"
        action={
          <button
            type="button"
            onClick={() => navigate('/account/capital-matrix')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-4 gap-4">
              <Select
                label="Customer"
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
                label="Amount"
                type="number"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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
                label="Date"
                type="date"
                required
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
            <div className="mt-4">
              <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
                  <Th className="text-right">Apply</Th>
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
            <div className="flex items-center justify-end gap-4 border-t border-border p-4 text-sm">
              <span className="text-text-muted">
                Allocated {formatMoney(allocatedTotal, currencySymbol)} of {formatMoney(amountNum, currencySymbol)}
              </span>
              <Badge tone={balanced ? 'success' : 'danger'}>
                {balanced ? 'Balanced' : `Out by ${formatMoney(Math.abs(outBy), currencySymbol)}`}
              </Badge>
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={applyPayment.isPending}>
            {applyPayment.isPending ? 'Applying…' : 'Apply payment'}
          </Button>
        </div>
      </form>
    </div>
  )
}

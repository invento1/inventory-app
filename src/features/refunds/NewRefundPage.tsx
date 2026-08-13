import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCustomers } from '../customers/api'
import { useLedgerAccounts } from '../accounts/api'
import { useCreateRefund } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function NewRefundPage() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: customers } = useCustomers(orgId)
  const { data: accounts } = useLedgerAccounts(orgId)
  const createRefund = useCreateRefund(orgId)

  const payAccounts = useMemo(() => (accounts ?? []).filter((a) => a.account_type === 'bank'), [accounts])

  const [customerId, setCustomerId] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [refundDate, setRefundDate] = useState(today())
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Choose a customer.')
      return
    }
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    try {
      const refund = await createRefund.mutateAsync({
        customerId,
        amount: amountNum,
        paymentMethod,
        accountId: accountId || null,
        refundDate,
        referenceNumber: referenceNumber || null,
        notes: notes || null,
      })
      toast.success(`Refund recorded — ${refund.refund_number}`)
      navigate('/refunds')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New refund"
        action={
          <button
            type="button"
            onClick={() => navigate('/refunds')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Customer"
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
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
              <Input
                label="Date"
                type="date"
                required
                value={refundDate}
                onChange={(e) => setRefundDate(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
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
              <Select label="Paid from" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Default (by payment method)</option>
                {payAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Reference no."
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>
            <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/refunds')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createRefund.isPending}>
            {createRefund.isPending ? 'Recording…' : 'Record refund'}
          </Button>
        </div>
      </form>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useRecordInvoicePayment } from './api'

export function RecordPaymentModal({
  orgId,
  invoiceId,
  balance,
  onClose,
}: {
  orgId: string
  invoiceId: string
  balance: number
  onClose: () => void
}) {
  const toast = useToast()
  const recordPayment = useRecordInvoicePayment(orgId, invoiceId)

  const [amount, setAmount] = useState(balance.toFixed(2))
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    // Mirrors the server-side check in record_invoice_payment for
    // immediate feedback -- the server remains the source of truth.
    if (amountNum > balance) {
      setError(`Amount exceeds the remaining balance of $${balance.toFixed(2)}.`)
      return
    }

    try {
      await recordPayment.mutateAsync({
        amount: amountNum,
        paymentMethod,
        paidAt,
        notes: notes || null,
      })
      toast.success('Payment recorded')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title="Record payment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={recordPayment.isPending}>
            {recordPayment.isPending ? 'Recording…' : 'Record payment'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

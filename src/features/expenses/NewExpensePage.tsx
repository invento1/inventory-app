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
import { useSuppliers } from '../suppliers/api'
import { useLedgerAccounts } from '../accounts/api'
import { useCreateExpense } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function NewExpensePage() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: suppliers } = useSuppliers(orgId)
  const { data: accounts } = useLedgerAccounts(orgId)
  const createExpense = useCreateExpense(orgId)

  const categoryAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.account_type === 'expense'),
    [accounts],
  )
  const payAccounts = useMemo(() => (accounts ?? []).filter((a) => a.account_type === 'bank'), [accounts])

  const [expenseDate, setExpenseDate] = useState(today())
  const [payeeSupplierId, setPayeeSupplierId] = useState('')
  const [payeeName, setPayeeName] = useState('')
  const [categoryAccountId, setCategoryAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const amountNum = Number(amount)
    if (!categoryAccountId) {
      setError('Choose an expense category.')
      return
    }
    if (!amountNum || amountNum <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    try {
      const expense = await createExpense.mutateAsync({
        expenseDate,
        payeeSupplierId: payeeSupplierId || null,
        payeeName: payeeName || null,
        categoryAccountId,
        amount: amountNum,
        paymentMethod,
        accountId: accountId || null,
        referenceNumber: referenceNumber || null,
        notes: notes || null,
      })
      toast.success(`Expense recorded — ${expense.expense_number}`)
      navigate('/expenses')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New expense"
        subtitle="Paid in full immediately"
        action={
          <button
            type="button"
            onClick={() => navigate('/expenses')}
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
              <Input
                label="Date"
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
              <Select
                label="Payee (supplier)"
                value={payeeSupplierId}
                onChange={(e) => setPayeeSupplierId(e.target.value)}
              >
                <option value="">None</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Payee (name)"
                placeholder="e.g. Office Depot"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Category"
                required
                value={categoryAccountId}
                onChange={(e) => setCategoryAccountId(e.target.value)}
              >
                <option value="">Select an expense account…</option>
                {categoryAccounts.map((a) => (
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
            </div>
            <div className="grid grid-cols-3 gap-4">
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
              <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/expenses')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createExpense.isPending}>
            {createExpense.isPending ? 'Recording…' : 'Record expense'}
          </Button>
        </div>
      </form>
    </div>
  )
}

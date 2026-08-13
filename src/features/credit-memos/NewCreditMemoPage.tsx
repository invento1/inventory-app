import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useCustomers } from '../customers/api'
import { useItems } from '../items/api'
import { useLocations } from '../../lib/useLocations'
import { useCreateCreditMemo, type CreditMemoLinePayload } from './api'

interface DraftLine {
  key: number
  item_id: string
  location_id: string
  quantity: string
  unit_price: string
}

let nextKey = 1

export function NewCreditMemoPage() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: customers } = useCustomers(orgId)
  const { data: items } = useItems(orgId)
  const { data: locations } = useLocations(orgId)
  const createCreditMemo = useCreateCreditMemo(orgId)

  const [customerId, setCustomerId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([
    { key: nextKey++, item_id: '', location_id: '', quantity: '', unit_price: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { key: nextKey++, item_id: '', location_id: '', quantity: '', unit_price: '' },
    ])
  }

  function removeLine(key: number) {
    setLines((current) => current.filter((l) => l.key !== key))
  }

  function selectItem(key: number, itemId: string) {
    const item = items?.find((i) => i.id === itemId)
    updateLine(key, { item_id: itemId, unit_price: item ? String(item.unit_price) : '' })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Choose a customer.')
      return
    }

    const validLines: CreditMemoLinePayload[] = []
    for (const line of lines) {
      if (!line.item_id) continue
      if (!line.location_id) {
        setError('Every line needs a location — where the returned stock goes back to.')
        return
      }
      const qty = Number(line.quantity)
      if (!qty || qty <= 0) {
        setError('Every line needs a quantity greater than zero.')
        return
      }
      const unitPrice = Number(line.unit_price)
      if (line.unit_price === '' || unitPrice < 0) {
        setError('Every line needs a unit price.')
        return
      }
      validLines.push({
        item_id: line.item_id,
        location_id: line.location_id,
        quantity: qty,
        unit_price: unitPrice,
      })
    }
    if (validLines.length === 0) {
      setError('Add at least one item line.')
      return
    }

    try {
      const creditMemo = await createCreditMemo.mutateAsync({
        customerId,
        lines: validLines,
        notes: notes || null,
      })
      toast.success('Credit memo created')
      navigate(`/credit-memos/${creditMemo.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New credit memo"
        subtitle="Reduces the customer's AR balance and returns stock"
        action={
          <button
            type="button"
            onClick={() => navigate('/credit-memos')}
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
            <div className="grid grid-cols-2 gap-4">
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
              <Input label="Notes / reason" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex flex-col gap-3">
              {lines.map((line) => (
                <div key={line.key} className="grid grid-cols-12 items-end gap-3">
                  <div className="col-span-4">
                    <Select
                      label="Item"
                      value={line.item_id}
                      onChange={(e) => selectItem(line.key, e.target.value)}
                    >
                      <option value="">Select an item…</option>
                      {items?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.sku})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Select
                      label="Return to location"
                      value={line.location_id}
                      onChange={(e) => updateLine(line.key, { location_id: e.target.value })}
                    >
                      <option value="">Select a location…</option>
                      {locations?.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Input
                      label="Quantity"
                      type="number"
                      min="0"
                      step="1"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      label="Unit price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_price}
                      onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="secondary" className="self-start" onClick={addLine}>
                <Plus size={16} />
                Add line
              </Button>
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/credit-memos')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createCreditMemo.isPending}>
            {createCreditMemo.isPending ? 'Creating…' : 'Create credit memo'}
          </Button>
        </div>
      </form>
    </div>
  )
}

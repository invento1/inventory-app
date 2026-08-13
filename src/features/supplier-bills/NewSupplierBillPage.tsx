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
import { useSuppliers } from '../suppliers/api'
import { useItems } from '../items/api'
import { useLocations } from '../../lib/useLocations'
import { useCreateSupplierBill, type SupplierBillLinePayload } from './api'

interface DraftLine {
  key: number
  item_id: string
  location_id: string
  quantity: string
  unit_cost: string
}

let nextKey = 1

function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

export function NewSupplierBillPage() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: suppliers } = useSuppliers(orgId)
  const { data: items } = useItems(orgId)
  const { data: locations } = useLocations(orgId)
  const createBill = useCreateSupplierBill(orgId)

  const [supplierId, setSupplierId] = useState('')
  const [dueDate, setDueDate] = useState(defaultDueDate())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([
    { key: nextKey++, item_id: '', location_id: '', quantity: '', unit_cost: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { key: nextKey++, item_id: '', location_id: '', quantity: '', unit_cost: '' },
    ])
  }

  function removeLine(key: number) {
    setLines((current) => current.filter((l) => l.key !== key))
  }

  function selectItem(key: number, itemId: string) {
    updateLine(key, { item_id: itemId })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!supplierId) {
      setError('Choose a supplier.')
      return
    }
    if (!dueDate) {
      setError('Choose a due date.')
      return
    }

    const validLines: SupplierBillLinePayload[] = []
    for (const line of lines) {
      if (!line.item_id) continue
      if (!line.location_id) {
        setError('Every line needs a location.')
        return
      }
      const qty = Number(line.quantity)
      if (!qty || qty <= 0) {
        setError('Every line needs a quantity greater than zero.')
        return
      }
      const unitCost = Number(line.unit_cost)
      if (line.unit_cost === '' || unitCost < 0) {
        setError('Every line needs a unit cost.')
        return
      }
      validLines.push({
        item_id: line.item_id,
        location_id: line.location_id,
        quantity: qty,
        unit_cost: unitCost,
      })
    }
    if (validLines.length === 0) {
      setError('Add at least one item line.')
      return
    }

    try {
      const bill = await createBill.mutateAsync({
        supplierId,
        dueDate,
        lines: validLines,
        notes: notes || null,
      })
      toast.success('Supplier bill created')
      navigate(`/supplier-bills/${bill.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New supplier bill"
        action={
          <button
            type="button"
            onClick={() => navigate('/supplier-bills')}
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
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Supplier"
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Select a supplier…</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Due date"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
                      label="Location"
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
                      label="Unit cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_cost}
                      onChange={(e) => updateLine(line.key, { unit_cost: e.target.value })}
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
          <Button type="button" variant="secondary" onClick={() => navigate('/supplier-bills')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createBill.isPending}>
            {createBill.isPending ? 'Creating…' : 'Create bill'}
          </Button>
        </div>
      </form>
    </div>
  )
}

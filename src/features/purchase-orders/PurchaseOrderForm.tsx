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
import { useCreatePurchaseOrder, type NewPurchaseOrderLine } from './api'

interface DraftLine {
  key: number
  item_id: string
  quantity_ordered: string
  unit_cost: string
}

let nextKey = 1

export function PurchaseOrderForm() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: suppliers } = useSuppliers(orgId)
  const { data: items } = useItems(orgId)
  const createPO = useCreatePurchaseOrder(orgId)

  const [supplierId, setSupplierId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([
    { key: nextKey++, item_id: '', quantity_ordered: '', unit_cost: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey++, item_id: '', quantity_ordered: '', unit_cost: '' }])
  }

  function removeLine(key: number) {
    setLines((current) => current.filter((l) => l.key !== key))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!supplierId) {
      setError('Choose a supplier.')
      return
    }
    const validLines: NewPurchaseOrderLine[] = []
    for (const line of lines) {
      if (!line.item_id) continue
      const qty = Number(line.quantity_ordered)
      if (!qty || qty <= 0) {
        setError('Every line needs a quantity greater than zero.')
        return
      }
      validLines.push({
        item_id: line.item_id,
        quantity_ordered: qty,
        unit_cost: line.unit_cost === '' ? null : Number(line.unit_cost),
      })
    }
    if (validLines.length === 0) {
      setError('Add at least one item line.')
      return
    }

    try {
      const po = await createPO.mutateAsync({
        supplierId,
        expectedDate: expectedDate || null,
        lines: validLines,
      })
      toast.success('Purchase order created')
      navigate(`/purchase-orders/${po.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New purchase order"
        action={
          <button
            type="button"
            onClick={() => navigate('/purchase-orders')}
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
                label="Expected date"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex flex-col gap-3">
              {lines.map((line) => (
                <div key={line.key} className="grid grid-cols-12 items-end gap-3">
                  <div className="col-span-6">
                    <Select
                      label="Item"
                      value={line.item_id}
                      onChange={(e) => updateLine(line.key, { item_id: e.target.value })}
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
                    <Input
                      label="Quantity"
                      type="number"
                      min="0"
                      step="1"
                      value={line.quantity_ordered}
                      onChange={(e) => updateLine(line.key, { quantity_ordered: e.target.value })}
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
          <Button type="button" variant="secondary" onClick={() => navigate('/purchase-orders')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createPO.isPending}>
            {createPO.isPending ? 'Creating…' : 'Create purchase order'}
          </Button>
        </div>
      </form>
    </div>
  )
}

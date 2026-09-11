import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td } from '../../components/ui/Table'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useLocations } from '../../lib/useLocations'
import { useItems } from '../items/api'
import { useStockLevels } from '../stock/api'
import { useLedgerAccounts, isManuallyPostable } from '../accounts/api'
import { formatMoney } from '../../lib/currency'
import { useCreateInventoryAdjustment, type AdjustmentType, type NewInventoryAdjustmentLine } from './api'

interface DraftLine {
  key: number
  item_id: string
  new_qty: string
  new_value: string
}

let nextKey = 1

function blankLine(): DraftLine {
  return { key: nextKey++, item_id: '', new_qty: '', new_value: '' }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const TYPE_OPTIONS: { value: AdjustmentType; label: string }[] = [
  { value: 'quantity', label: 'Quantity' },
  { value: 'value', label: 'Value' },
  { value: 'quantity_and_value', label: 'Quantity and Value' },
]

export function NewInventoryAdjustmentPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: locations } = useLocations(orgId)
  const { data: items } = useItems(orgId)
  const { data: stockLevels } = useStockLevels(orgId)
  const { data: accounts } = useLedgerAccounts(orgId)
  const createAdjustment = useCreateInventoryAdjustment(orgId)

  const adjustmentAccounts = useMemo(() => (accounts ?? []).filter(isManuallyPostable), [accounts])
  const avgCostByItem = useMemo(() => new Map((items ?? []).map((i) => [i.id, i.avg_cost])), [items])

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('quantity')
  const [adjustmentDate, setAdjustmentDate] = useState(today())
  const [locationId, setLocationId] = useState('')
  const [adjustmentAccountId, setAdjustmentAccountId] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [error, setError] = useState<string | null>(null)

  const stockByItem = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stockLevels ?? []) {
      if (s.location_id === locationId) map.set(s.item_id, s.quantity)
    }
    return map
  }, [stockLevels, locationId])

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((current) => [...current, blankLine()])
  }

  function removeLine(key: number) {
    setLines((current) => (current.length <= 1 ? current : current.filter((l) => l.key !== key)))
  }

  function lineComputed(line: DraftLine) {
    const qtyOnHand = line.item_id ? (stockByItem.get(line.item_id) ?? 0) : 0
    const avgCost = line.item_id ? (avgCostByItem.get(line.item_id) ?? 0) : 0
    const currentValue = qtyOnHand * avgCost

    let newQty: number | null
    let newValue: number | null
    if (adjustmentType === 'quantity') {
      newQty = line.new_qty === '' ? null : Number(line.new_qty)
      newValue = newQty !== null ? newQty * avgCost : null
    } else if (adjustmentType === 'value') {
      newQty = qtyOnHand
      newValue = line.new_value === '' ? null : Number(line.new_value)
    } else {
      newQty = line.new_qty === '' ? null : Number(line.new_qty)
      newValue = line.new_value === '' ? null : Number(line.new_value)
    }
    const valueDiff = newValue !== null ? newValue - currentValue : null

    return { qtyOnHand, avgCost, currentValue, newQty, newValue, valueDiff }
  }

  const totalValueDiff = lines.reduce((sum, l) => {
    const { valueDiff } = lineComputed(l)
    return sum + (valueDiff ?? 0)
  }, 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!locationId) {
      setError('Choose a location.')
      return
    }
    if (!adjustmentAccountId) {
      setError('Choose an adjustment account.')
      return
    }

    const payloadLines: NewInventoryAdjustmentLine[] = []
    for (const line of lines) {
      if (!line.item_id) continue
      const { newQty, newValue } = lineComputed(line)
      if (adjustmentType !== 'value' && newQty === null) {
        setError('Every line needs a new quantity.')
        return
      }
      if (adjustmentType !== 'quantity' && newValue === null) {
        setError('Every line needs a new value.')
        return
      }
      payloadLines.push({
        item_id: line.item_id,
        new_qty: adjustmentType === 'value' ? null : newQty,
        new_value: adjustmentType === 'quantity' ? null : newValue,
      })
    }
    if (payloadLines.length === 0) {
      setError('Add at least one item line.')
      return
    }

    try {
      const adjustment = await createAdjustment.mutateAsync({
        locationId,
        adjustmentType,
        adjustmentAccountId,
        adjustmentDate,
        referenceNumber: referenceNumber || null,
        description: description || null,
        lines: payloadLines,
      })
      toast.success(`Adjustment ${adjustment.adjustment_number} recorded`)
      navigate(`/inventory-adjustments/${adjustment.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New inventory adjustment"
        action={
          <button
            type="button"
            onClick={() => navigate('/inventory-adjustments')}
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
                label="Adjustment type"
                value={adjustmentType}
                onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Input
                label="Date"
                type="date"
                required
                value={adjustmentDate}
                onChange={(e) => setAdjustmentDate(e.target.value)}
              />
              <Select label="Location" required value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Select a location…</option>
                {locations?.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Adjustment account"
                required
                value={adjustmentAccountId}
                onChange={(e) => setAdjustmentAccountId(e.target.value)}
              >
                <option value="">Select an account…</option>
                {adjustmentAccounts.map((a) => (
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
              <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <Th>Item</Th>
                <Th className="text-right">Qty on hand</Th>
                <Th className="text-right">Current value</Th>
                <Th className="text-right">New qty</Th>
                <Th className="text-right">New value</Th>
                <Th className="text-right">Value diff.</Th>
                <Th></Th>
              </THead>
              <tbody>
                {lines.map((line) => {
                  const { qtyOnHand, currentValue, newValue, valueDiff } = lineComputed(line)
                  return (
                    <tr key={line.key} className="border-b border-border last:border-0">
                      <Td>
                        <Select value={line.item_id} onChange={(e) => updateLine(line.key, { item_id: e.target.value })}>
                          <option value="">Select an item…</option>
                          {items?.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.sku})
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td className="text-right">{line.item_id ? qtyOnHand : '—'}</Td>
                      <Td className="text-right">{line.item_id ? formatMoney(currentValue, currencySymbol) : '—'}</Td>
                      <Td className="text-right">
                        {adjustmentType === 'value' ? (
                          <span className="text-text-muted">{line.item_id ? qtyOnHand : '—'}</span>
                        ) : (
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            className="text-right"
                            value={line.new_qty}
                            onChange={(e) => updateLine(line.key, { new_qty: e.target.value })}
                          />
                        )}
                      </Td>
                      <Td className="text-right">
                        {adjustmentType === 'quantity' ? (
                          <span className="text-text-muted">
                            {newValue !== null ? formatMoney(newValue, currencySymbol) : '—'}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="text-right"
                            value={line.new_value}
                            onChange={(e) => updateLine(line.key, { new_value: e.target.value })}
                          />
                        )}
                      </Td>
                      <Td
                        className={`text-right font-medium ${
                          valueDiff && valueDiff > 0
                            ? 'text-success-600'
                            : valueDiff && valueDiff < 0
                              ? 'text-danger-600'
                              : 'text-text-muted'
                        }`}
                      >
                        {valueDiff !== null
                          ? `${valueDiff > 0 ? '+' : ''}${formatMoney(valueDiff, currencySymbol)}`
                          : '—'}
                      </Td>
                      <Td>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLine(line.key)}
                          disabled={lines.length === 1}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-border p-4">
              <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                <Plus size={14} />
                Add line
              </Button>
              <div className="text-sm font-semibold">
                Total value of adjustment:{' '}
                <span
                  className={
                    totalValueDiff > 0 ? 'text-success-600' : totalValueDiff < 0 ? 'text-danger-600' : ''
                  }
                >
                  {totalValueDiff > 0 ? '+' : ''}
                  {formatMoney(totalValueDiff, currencySymbol)}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/inventory-adjustments')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createAdjustment.isPending}>
            {createAdjustment.isPending ? 'Creating…' : 'Create adjustment'}
          </Button>
        </div>
      </form>
    </div>
  )
}

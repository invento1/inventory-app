import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useLocations } from '../../lib/useLocations'
import { useItems } from '../items/api'
import { useAdjustStock } from './api'

export function AdjustStockModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { data: items } = useItems(orgId)
  const { data: locations } = useLocations(orgId)
  const adjustStock = useAdjustStock(orgId)
  const toast = useToast()

  const [itemId, setItemId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [quantity, setQuantity] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const qty = Number(quantity)
    if (!itemId || !locationId || !qty || qty <= 0) {
      setError('Choose an item, a location, and a quantity greater than zero.')
      return
    }
    try {
      await adjustStock.mutateAsync({
        itemId,
        locationId,
        quantityDelta: direction === 'add' ? qty : -qty,
      })
      toast.success('Stock adjusted')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Select label="Item" required value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select an item…</option>
          {items?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.sku})
            </option>
          ))}
        </Select>
        <Select
          label="Location"
          required
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">Select a location…</option>
          {locations?.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}
          >
            <option value="add">Add to stock</option>
            <option value="remove">Remove from stock</option>
          </Select>
          <Input
            label="Quantity"
            type="number"
            min="0"
            step="1"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={adjustStock.isPending}>
            {adjustStock.isPending ? 'Saving…' : 'Adjust stock'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

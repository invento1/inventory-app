import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useLocations } from '../../lib/useLocations'
import { useItems } from '../items/api'
import { useCreateStockTransfer } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function NewTransferModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { data: items } = useItems(orgId)
  const { data: locations } = useLocations(orgId)
  const createTransfer = useCreateStockTransfer(orgId)
  const toast = useToast()

  const [itemId, setItemId] = useState('')
  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [transferDate, setTransferDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const qty = Number(quantity)
    if (!itemId || !fromLocationId || !toLocationId || !qty || qty <= 0) {
      setError('Choose an item, both locations, and a quantity greater than zero.')
      return
    }
    if (fromLocationId === toLocationId) {
      setError('From and to locations must be different.')
      return
    }
    try {
      await createTransfer.mutateAsync({
        itemId,
        fromLocationId,
        toLocationId,
        quantity: qty,
        transferDate,
        notes: notes || null,
      })
      toast.success('Stock transferred')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title="New inventory transfer" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Select label="Item" required value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select an item…</option>
          {items?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.sku})
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="From location"
            required
            value={fromLocationId}
            onChange={(e) => setFromLocationId(e.target.value)}
          >
            <option value="">Select a location…</option>
            {locations?.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </Select>
          <Select
            label="To location"
            required
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
          >
            <option value="">Select a location…</option>
            {locations?.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Quantity"
            type="number"
            min="0"
            step="1"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Input
            label="Date"
            type="date"
            required
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
          />
        </div>
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createTransfer.isPending}>
            {createTransfer.isPending ? 'Transferring…' : 'Transfer stock'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

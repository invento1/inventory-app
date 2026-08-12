import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCreateItem, useUpdateItem, type Item, type ItemInput } from './api'

const emptyForm: ItemInput = {
  sku: '',
  barcode: '',
  name: '',
  description: '',
  unit: 'unit',
  unit_price: 0,
  reorder_threshold: null,
}

export function ItemForm({
  orgId,
  item,
  onClose,
}: {
  orgId: string
  item?: Item | null
  onClose: () => void
}) {
  const [form, setForm] = useState<ItemInput>(
    item
      ? {
          sku: item.sku,
          barcode: item.barcode,
          name: item.name,
          description: item.description,
          unit: item.unit,
          unit_price: item.unit_price,
          reorder_threshold: item.reorder_threshold,
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createItem = useCreateItem(orgId)
  const updateItem = useUpdateItem(orgId)
  const toast = useToast()
  const saving = createItem.isPending || updateItem.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (item) {
        await updateItem.mutateAsync({ id: item.id, input: form })
        toast.success('Item updated')
      } else {
        await createItem.mutateAsync(form)
        toast.success('Item created')
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={item ? 'Edit item' : 'New item'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="SKU"
            required
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
          />
          <Input
            label="Barcode"
            value={form.barcode ?? ''}
            onChange={(e) => setForm({ ...form, barcode: e.target.value || null })}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Unit"
            value={form.unit ?? 'unit'}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
          />
          <Input
            label="Price"
            type="number"
            step="0.01"
            min="0"
            required
            value={form.unit_price ?? 0}
            onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })}
          />
          <Input
            label="Reorder at"
            type="number"
            step="1"
            min="0"
            value={form.reorder_threshold ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                reorder_threshold: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </div>
        <Input
          label="Description"
          value={form.description ?? ''}
          onChange={(e) => setForm({ ...form, description: e.target.value || null })}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : item ? 'Save changes' : 'Create item'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

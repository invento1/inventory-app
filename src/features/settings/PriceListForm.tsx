import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCreatePriceList, useUpdatePriceList, type PriceList, type PriceListInput } from './api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm(): PriceListInput {
  return { list_date: today(), list_type: 'retail', image_url: '' }
}

export function PriceListForm({
  orgId,
  priceList,
  onClose,
}: {
  orgId: string
  priceList?: PriceList | null
  onClose: () => void
}) {
  const [form, setForm] = useState<PriceListInput>(
    priceList
      ? { list_date: priceList.list_date, list_type: priceList.list_type, image_url: priceList.image_url }
      : emptyForm(),
  )
  const [error, setError] = useState<string | null>(null)
  const createPriceList = useCreatePriceList(orgId)
  const updatePriceList = useUpdatePriceList(orgId)
  const toast = useToast()
  const saving = createPriceList.isPending || updatePriceList.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (priceList) {
        await updatePriceList.mutateAsync({ id: priceList.id, input: form })
        toast.success('Price list updated')
      } else {
        await createPriceList.mutateAsync(form)
        toast.success('Price list created')
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={priceList ? 'Edit price list' : 'New price list'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="List date"
            type="date"
            required
            value={form.list_date ?? today()}
            onChange={(e) => setForm({ ...form, list_date: e.target.value })}
          />
          <Select
            label="List type"
            value={form.list_type ?? 'retail'}
            onChange={(e) => setForm({ ...form, list_type: e.target.value })}
          >
            <option value="retail">Retail</option>
            <option value="wholesale">Wholesale</option>
            <option value="custom">Custom</option>
          </Select>
        </div>
        <Input
          label="Image URL (optional)"
          value={form.image_url ?? ''}
          onChange={(e) => setForm({ ...form, image_url: e.target.value || null })}
        />
        {form.image_url && (
          <img
            src={form.image_url}
            alt="Price list preview"
            className="max-h-40 rounded-lg border border-border object-contain"
          />
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : priceList ? 'Save changes' : 'Create price list'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

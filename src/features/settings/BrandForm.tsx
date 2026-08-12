import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCreateBrand, useUpdateBrand, type Brand, type BrandInput } from './api'

const emptyForm: BrandInput = { name: '' }

export function BrandForm({
  orgId,
  brand,
  onClose,
  onCreated,
}: {
  orgId: string
  brand?: Brand | null
  onClose: () => void
  onCreated?: (brand: Brand) => void
}) {
  const [form, setForm] = useState<BrandInput>(brand ? { name: brand.name } : emptyForm)
  const [error, setError] = useState<string | null>(null)
  const createBrand = useCreateBrand(orgId)
  const updateBrand = useUpdateBrand(orgId)
  const toast = useToast()
  const saving = createBrand.isPending || updateBrand.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (brand) {
        await updateBrand.mutateAsync({ id: brand.id, input: form })
        toast.success('Brand updated')
      } else {
        const created = await createBrand.mutateAsync(form)
        toast.success('Brand created')
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={brand ? 'Edit brand' : 'New brand'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : brand ? 'Save changes' : 'Create brand'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

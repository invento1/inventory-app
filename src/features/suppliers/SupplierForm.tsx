import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCreateSupplier, useUpdateSupplier, type Supplier, type SupplierInput } from './api'

const emptyForm: SupplierInput = {
  name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
}

export function SupplierForm({
  orgId,
  supplier,
  onClose,
}: {
  orgId: string
  supplier?: Supplier | null
  onClose: () => void
}) {
  const [form, setForm] = useState<SupplierInput>(
    supplier
      ? {
          name: supplier.name,
          contact_name: supplier.contact_name,
          contact_email: supplier.contact_email,
          contact_phone: supplier.contact_phone,
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createSupplier = useCreateSupplier(orgId)
  const updateSupplier = useUpdateSupplier(orgId)
  const toast = useToast()
  const saving = createSupplier.isPending || updateSupplier.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (supplier) {
        await updateSupplier.mutateAsync({ id: supplier.id, input: form })
        toast.success('Supplier updated')
      } else {
        await createSupplier.mutateAsync(form)
        toast.success('Supplier created')
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={supplier ? 'Edit supplier' : 'New supplier'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="Contact name"
          value={form.contact_name ?? ''}
          onChange={(e) => setForm({ ...form, contact_name: e.target.value || null })}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Email"
            type="email"
            value={form.contact_email ?? ''}
            onChange={(e) => setForm({ ...form, contact_email: e.target.value || null })}
          />
          <Input
            label="Phone"
            value={form.contact_phone ?? ''}
            onChange={(e) => setForm({ ...form, contact_phone: e.target.value || null })}
          />
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : supplier ? 'Save changes' : 'Create supplier'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

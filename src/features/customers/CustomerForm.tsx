import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useAreas } from '../settings/api'
import { AreaForm } from '../settings/AreaForm'
import { useCreateCustomer, useUpdateCustomer, type Customer, type CustomerInput } from './api'

const emptyForm: CustomerInput = { name: '', phone: '', email: '', address: '', area_id: null }

export function CustomerForm({
  orgId,
  customer,
  onClose,
  onCreated,
}: {
  orgId: string
  customer?: Customer | null
  onClose: () => void
  onCreated?: (customer: Customer) => void
}) {
  const [form, setForm] = useState<CustomerInput>(
    customer
      ? {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          area_id: customer.area_id,
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createCustomer = useCreateCustomer(orgId)
  const updateCustomer = useUpdateCustomer(orgId)
  const { data: areas } = useAreas(orgId)
  const toast = useToast()
  const saving = createCustomer.isPending || updateCustomer.isPending
  const [addingArea, setAddingArea] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (customer) {
        await updateCustomer.mutateAsync({ id: customer.id, input: form })
        toast.success('Customer updated')
      } else {
        const created = await createCustomer.mutateAsync(form)
        toast.success('Customer created')
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={customer ? 'Edit customer' : 'New customer'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Phone"
            value={form.phone ?? ''}
            onChange={(e) => setForm({ ...form, phone: e.target.value || null })}
          />
          <Input
            label="Email"
            type="email"
            value={form.email ?? ''}
            onChange={(e) => setForm({ ...form, email: e.target.value || null })}
          />
        </div>
        <Input
          label="Address"
          value={form.address ?? ''}
          onChange={(e) => setForm({ ...form, address: e.target.value || null })}
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select
              label="Area / Zone"
              value={form.area_id ?? ''}
              onChange={(e) => setForm({ ...form, area_id: e.target.value || null })}
            >
              <option value="">None</option>
              {areas?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAddingArea(true)}>
            <Plus size={14} />
          </Button>
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : customer ? 'Save changes' : 'Create customer'}
          </Button>
        </div>
      </form>

      {addingArea && (
        <AreaForm
          orgId={orgId}
          onClose={() => setAddingArea(false)}
          onCreated={(created) => setForm((f) => ({ ...f, area_id: created.id }))}
        />
      )}
    </Modal>
  )
}

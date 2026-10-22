import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCreateSalesRep, useUpdateSalesRep, type SalesRep, type SalesRepInput } from './api'

const emptyForm: SalesRepInput = { name: '', phone: null, email: null, is_active: true }

export function SalesRepForm({
  orgId,
  rep,
  onClose,
  onCreated,
}: {
  orgId: string
  rep?: SalesRep | null
  onClose: () => void
  onCreated?: (rep: SalesRep) => void
}) {
  const [form, setForm] = useState<SalesRepInput>(
    rep ? { name: rep.name, phone: rep.phone, email: rep.email, is_active: rep.is_active } : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createRep = useCreateSalesRep(orgId)
  const updateRep = useUpdateSalesRep(orgId)
  const toast = useToast()
  const saving = createRep.isPending || updateRep.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (rep) {
        await updateRep.mutateAsync({ id: rep.id, input: form })
        toast.success('Representative updated')
      } else {
        const created = await createRep.mutateAsync(form)
        toast.success('Representative added')
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message.includes('sales_reps_org_name_key') ? 'There is already a representative with this name.' : message)
    }
  }

  return (
    <Modal title={rep ? 'Edit representative' : 'New representative'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        {rep && (
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={form.is_active ?? true}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Active (inactive representatives keep their past sales but can't be picked on new documents)
          </label>
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : rep ? 'Save changes' : 'Add representative'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

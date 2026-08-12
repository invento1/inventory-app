import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import {
  useCreateUnitOfMeasure,
  useUpdateUnitOfMeasure,
  type UnitOfMeasure,
  type UnitOfMeasureInput,
} from './api'

const emptyForm: UnitOfMeasureInput = { name: '', abbreviation: '' }

export function UnitForm({
  orgId,
  unit,
  onClose,
  onCreated,
}: {
  orgId: string
  unit?: UnitOfMeasure | null
  onClose: () => void
  onCreated?: (unit: UnitOfMeasure) => void
}) {
  const [form, setForm] = useState<UnitOfMeasureInput>(
    unit ? { name: unit.name, abbreviation: unit.abbreviation } : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createUnit = useCreateUnitOfMeasure(orgId)
  const updateUnit = useUpdateUnitOfMeasure(orgId)
  const toast = useToast()
  const saving = createUnit.isPending || updateUnit.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (unit) {
        await updateUnit.mutateAsync({ id: unit.id, input: form })
        toast.success('Unit updated')
      } else {
        const created = await createUnit.mutateAsync(form)
        toast.success('Unit created')
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={unit ? 'Edit unit' : 'New unit'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Unit name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="Abbreviation"
          placeholder="e.g. pcs, kg"
          value={form.abbreviation ?? ''}
          onChange={(e) => setForm({ ...form, abbreviation: e.target.value || null })}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : unit ? 'Save changes' : 'Create unit'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

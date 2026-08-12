import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCreateArea, useUpdateArea, type Area, type AreaInput } from './api'

const emptyForm: AreaInput = { name: '', region: '' }

export function AreaForm({
  orgId,
  area,
  onClose,
  onCreated,
}: {
  orgId: string
  area?: Area | null
  onClose: () => void
  onCreated?: (area: Area) => void
}) {
  const [form, setForm] = useState<AreaInput>(
    area ? { name: area.name, region: area.region } : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createArea = useCreateArea(orgId)
  const updateArea = useUpdateArea(orgId)
  const toast = useToast()
  const saving = createArea.isPending || updateArea.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (area) {
        await updateArea.mutateAsync({ id: area.id, input: form })
        toast.success('Area updated')
      } else {
        const created = await createArea.mutateAsync(form)
        toast.success('Area created')
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={area ? 'Edit area' : 'New area'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Area / Zone"
          required
          placeholder="e.g. Bajaur — Pashat"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="Region (optional)"
          value={form.region ?? ''}
          onChange={(e) => setForm({ ...form, region: e.target.value || null })}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : area ? 'Save changes' : 'Create area'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

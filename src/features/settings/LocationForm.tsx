import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import type { Location } from '../../lib/useLocations'
import { useCreateLocation, useUpdateLocation, type LocationInput, type LocationType } from './api'

const emptyForm: LocationInput = {
  name: '',
  address: '',
  is_active: true,
}

export function LocationForm({
  orgId,
  type,
  singular,
  location,
  onClose,
}: {
  orgId: string
  type: LocationType
  singular: string
  location?: Location | null
  onClose: () => void
}) {
  const [form, setForm] = useState<LocationInput>(
    location
      ? { name: location.name, address: location.address, is_active: location.is_active }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createLocation = useCreateLocation(orgId, type)
  const updateLocation = useUpdateLocation(orgId, type)
  const toast = useToast()
  const saving = createLocation.isPending || updateLocation.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (location) {
        await updateLocation.mutateAsync({ id: location.id, input: form })
        toast.success(`${singular} updated`)
      } else {
        await createLocation.mutateAsync(form)
        toast.success(`${singular} created`)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={location ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="Address"
          value={form.address ?? ''}
          onChange={(e) => setForm({ ...form, address: e.target.value || null })}
        />
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={form.is_active ?? true}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Active
        </label>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : location ? 'Save changes' : `Create ${singular.toLowerCase()}`}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

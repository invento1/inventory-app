import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  type Category,
  type CategoryInput,
} from './api'

const emptyForm: CategoryInput = { name: '', parent_id: null }

export function CategoryForm({
  orgId,
  category,
  onClose,
  onCreated,
}: {
  orgId: string
  category?: Category | null
  onClose: () => void
  onCreated?: (category: Category) => void
}) {
  const { data: categories } = useCategories(orgId)
  const [form, setForm] = useState<CategoryInput>(
    category ? { name: category.name, parent_id: category.parent_id } : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createCategory = useCreateCategory(orgId)
  const updateCategory = useUpdateCategory(orgId)
  const toast = useToast()
  const saving = createCategory.isPending || updateCategory.isPending

  // A category can't be its own parent -- exclude it from the options list
  // when editing. No deeper cycle detection beyond that.
  const parentOptions = (categories ?? []).filter((c) => c.id !== category?.id)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (category) {
        await updateCategory.mutateAsync({ id: category.id, input: form })
        toast.success('Category updated')
      } else {
        const created = await createCategory.mutateAsync(form)
        toast.success('Category created')
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Select
          label="Parent category"
          value={form.parent_id ?? ''}
          onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })}
        >
          <option value="">None</option>
          {parentOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : category ? 'Save changes' : 'Create category'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCategories, useBrands, useUnitsOfMeasure } from '../settings/api'
import { CategoryForm } from '../settings/CategoryForm'
import { BrandForm } from '../settings/BrandForm'
import { UnitForm } from '../settings/UnitForm'
import { useCreateItem, type ItemInput } from './api'

const emptyForm: Omit<ItemInput, 'sku'> = {
  barcode: '',
  name: '',
  description: '',
  unit: 'unit',
  unit_price: 0,
  reorder_threshold: null,
  category_id: null,
  brand_id: null,
}

export function NewItemPage() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState<Omit<ItemInput, 'sku'>>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const createItem = useCreateItem(orgId)
  const { data: categories } = useCategories(orgId)
  const { data: brands } = useBrands(orgId)
  const { data: units } = useUnitsOfMeasure(orgId)
  const saving = createItem.isPending

  const [addingCategory, setAddingCategory] = useState(false)
  const [addingBrand, setAddingBrand] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)

  // The default 'unit' value won't necessarily match any UOM row (e.g. a
  // fresh org with none created yet) -- keep it displayable via a
  // synthetic option instead of leaving the select in a mismatched state.
  const currentUnitKnown = (units ?? []).some((u) => (u.abbreviation || u.name) === form.unit)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const item = await createItem.mutateAsync(form)
      toast.success(`Item created — SKU ${item.sku}`)
      navigate('/items/list')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New item"
        subtitle="SKU is assigned automatically"
        action={
          <button
            type="button"
            onClick={() => navigate('/items/list')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="Barcode"
              value={form.barcode ?? ''}
              onChange={(e) => setForm({ ...form, barcode: e.target.value || null })}
            />
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    label="Unit"
                    value={form.unit ?? 'unit'}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  >
                    {!currentUnitKnown && form.unit && <option value={form.unit}>{form.unit}</option>}
                    {units?.map((u) => (
                      <option key={u.id} value={u.abbreviation || u.name}>
                        {u.name}
                        {u.abbreviation ? ` (${u.abbreviation})` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAddingUnit(true)}>
                  <Plus size={14} />
                </Button>
              </div>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    label="Category"
                    value={form.category_id ?? ''}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {categories?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAddingCategory(true)}>
                  <Plus size={14} />
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    label="Brand"
                    value={form.brand_id ?? ''}
                    onChange={(e) => setForm({ ...form, brand_id: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {brands?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAddingBrand(true)}>
                  <Plus size={14} />
                </Button>
              </div>
            </div>
            <Input
              label="Description"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value || null })}
            />
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/items/list')}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create item'}
          </Button>
        </div>
      </form>

      {addingCategory && (
        <CategoryForm
          orgId={orgId}
          onClose={() => setAddingCategory(false)}
          onCreated={(created) => setForm((f) => ({ ...f, category_id: created.id }))}
        />
      )}
      {addingBrand && (
        <BrandForm
          orgId={orgId}
          onClose={() => setAddingBrand(false)}
          onCreated={(created) => setForm((f) => ({ ...f, brand_id: created.id }))}
        />
      )}
      {addingUnit && (
        <UnitForm
          orgId={orgId}
          onClose={() => setAddingUnit(false)}
          onCreated={(created) => setForm((f) => ({ ...f, unit: created.abbreviation || created.name }))}
        />
      )}
    </div>
  )
}

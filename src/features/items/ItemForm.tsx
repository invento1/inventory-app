import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useCategories, useBrands, useUnitsOfMeasure } from '../settings/api'
import { useSuppliers } from '../suppliers/api'
import { CategoryForm } from '../settings/CategoryForm'
import { BrandForm } from '../settings/BrandForm'
import { UnitForm } from '../settings/UnitForm'
import { SupplierForm } from '../suppliers/SupplierForm'
import { useUpdateItem, type Item, type ItemInput } from './api'
import { BarcodeField } from './BarcodeField'
import { ItemAccountsFields } from './ItemAccountsFields'
import { useOrg } from '../../auth/OrgProvider'

export function ItemForm({
  orgId,
  item,
  onClose,
}: {
  orgId: string
  item: Item & { on_hand?: number }
  onClose: () => void
}) {
  const { can } = useOrg()
  const [form, setForm] = useState<ItemInput>({
    sku: item.sku,
    barcode: item.barcode,
    name: item.name,
    description: item.description,
    unit: item.unit,
    unit_price: item.unit_price,
    reorder_threshold: item.reorder_threshold,
    expiry_date: item.expiry_date,
    commission_rate: item.commission_rate,
    category_id: item.category_id,
    brand_id: item.brand_id,
    supplier_id: item.supplier_id,
    income_account_id: item.income_account_id,
    cogs_account_id: item.cogs_account_id,
    inventory_account_id: item.inventory_account_id,
  })
  const [error, setError] = useState<string | null>(null)
  const updateItem = useUpdateItem(orgId)
  const { data: categories } = useCategories(orgId)
  const { data: brands } = useBrands(orgId)
  const { data: units } = useUnitsOfMeasure(orgId)
  const { data: suppliers } = useSuppliers(orgId)
  const toast = useToast()
  const saving = updateItem.isPending

  const [addingCategory, setAddingCategory] = useState(false)
  const [addingBrand, setAddingBrand] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [addingSupplier, setAddingSupplier] = useState(false)

  // Existing items may have a unit value that predates the UOM list (or
  // doesn't match any current abbreviation/name) -- keep it selectable
  // instead of silently losing it.
  const currentUnitKnown = (units ?? []).some(
    (u) => (u.abbreviation || u.name) === form.unit,
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await updateItem.mutateAsync({ id: item.id, input: form })
      toast.success('Item updated')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title="Edit item" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="SKU"
            required
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
          />
          <BarcodeField value={form.barcode ?? ''} onChange={(barcode) => setForm({ ...form, barcode })} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            {can('settings.master_data') && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setAddingUnit(true)}>
                <Plus size={14} />
              </Button>
            )}
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
          <Input
            label="Commission %"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.commission_rate ?? 0}
            onChange={(e) => setForm({ ...form, commission_rate: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            {can('settings.master_data') && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setAddingCategory(true)}>
                <Plus size={14} />
              </Button>
            )}
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
            {can('settings.master_data') && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setAddingBrand(true)}>
                <Plus size={14} />
              </Button>
            )}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select
                label="Supplier"
                value={form.supplier_id ?? ''}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value || null })}
              >
                <option value="">None</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            {can('suppliers.create') && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setAddingSupplier(true)}>
                <Plus size={14} />
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input
              label="Description"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value || null })}
            />
          </div>
          <Input
            label="Expiry date"
            type="date"
            title="Optional. Stock past this date shows in the Damaged / Expired Inventory report."
            value={form.expiry_date ?? ''}
            onChange={(e) => setForm({ ...form, expiry_date: e.target.value || null })}
          />
        </div>
        <ItemAccountsFields
          orgId={orgId}
          value={{
            income_account_id: form.income_account_id ?? null,
            cogs_account_id: form.cogs_account_id ?? null,
            inventory_account_id: form.inventory_account_id ?? null,
          }}
          onChange={(accounts) => setForm({ ...form, ...accounts })}
          saved={item}
          stockValue={(item.on_hand ?? 0) * (item.avg_cost ?? 0)}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
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
          onCreated={(created) =>
            setForm((f) => ({ ...f, unit: created.abbreviation || created.name }))
          }
        />
      )}
      {addingSupplier && (
        <SupplierForm
          orgId={orgId}
          onClose={() => setAddingSupplier(false)}
          onCreated={(created) => setForm((f) => ({ ...f, supplier_id: created.id }))}
        />
      )}
    </Modal>
  )
}

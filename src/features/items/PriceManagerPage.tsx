import { useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { useCategories, useBrands } from '../settings/api'
import { useItems, useUpdateItem } from './api'

interface Edit {
  unit_price: string
  reorder_threshold: string
}

export function PriceManagerPage() {
  const { orgId } = useOrg()
  const toast = useToast()
  const { data: items, isLoading } = useItems(orgId)
  const { data: categories } = useCategories(orgId)
  const { data: brands } = useBrands(orgId)
  const updateItem = useUpdateItem(orgId)

  const [categoryId, setCategoryId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    if (!items) return []
    return items.filter(
      (i) => (!categoryId || i.category_id === categoryId) && (!brandId || i.brand_id === brandId),
    )
  }, [items, categoryId, brandId])

  const editCount = Object.keys(edits).length

  function markEdit(itemId: string, patch: Partial<Edit>, defaults: Edit) {
    setEdits((current) => ({
      ...current,
      [itemId]: { ...(current[itemId] ?? defaults), ...patch },
    }))
  }

  async function handleSave() {
    const rows = Object.entries(edits)
    if (rows.length === 0) return
    setSaving(true)
    try {
      for (const [id, edit] of rows) {
        await updateItem.mutateAsync({
          id,
          input: {
            unit_price: Number(edit.unit_price),
            reorder_threshold: edit.reorder_threshold === '' ? null : Number(edit.reorder_threshold),
          },
        })
      }
      setEdits({})
      toast.success(`Updated ${rows.length} item(s)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Price manager"
        subtitle="Bulk-update prices and reorder points"
        action={
          <Button onClick={handleSave} disabled={editCount === 0 || saving}>
            {saving ? 'Saving…' : editCount ? `Save ${editCount} change(s)` : 'Save changes'}
          </Button>
        }
      />

      <Card className="mb-4">
        <CardBody>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">All</option>
              {brands?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>SKU</Th>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>Brand</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">Reorder at</Th>
            </THead>
            <tbody>
              {filtered.length === 0 && <EmptyState message="No items match these filters." />}
              {filtered.map((item) => {
                const defaults: Edit = {
                  unit_price: String(item.unit_price),
                  reorder_threshold: item.reorder_threshold != null ? String(item.reorder_threshold) : '',
                }
                const edit = edits[item.id] ?? defaults
                return (
                  <Tr key={item.id}>
                    <Td>{item.sku}</Td>
                    <Td className="font-medium">{item.name}</Td>
                    <Td>{item.category_name || '—'}</Td>
                    <Td>{item.brand_name || '—'}</Td>
                    <Td className="text-right">{item.on_hand}</Td>
                    <Td className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right"
                        value={edit.unit_price}
                        onChange={(e) => markEdit(item.id, { unit_price: e.target.value }, defaults)}
                      />
                    </Td>
                    <Td className="text-right">
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        className="text-right"
                        value={edit.reorder_threshold}
                        onChange={(e) => markEdit(item.id, { reorder_threshold: e.target.value }, defaults)}
                      />
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

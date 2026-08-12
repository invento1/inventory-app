import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { useItems, type Item } from './api'
import { ItemForm } from './ItemForm'

export function ItemsListPage() {
  const { orgId } = useOrg()
  const { data: items, isLoading } = useItems(orgId)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Item | null | undefined>(undefined)

  const filtered = useMemo(() => {
    if (!items) return []
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.barcode?.toLowerCase().includes(q),
    )
  }, [items, search])

  return (
    <div>
      <PageHeader
        title="Items"
        subtitle="Your product catalog"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New item
          </Button>
        }
      />

      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Search name, SKU, barcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>SKU</Th>
              <Th>Barcode</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">Reorder at</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {filtered.length === 0 && <EmptyState message="No items yet." />}
              {filtered.map((item) => (
                <Tr key={item.id} onClick={() => setEditing(item)}>
                  <Td className="font-medium">{item.name}</Td>
                  <Td>{item.sku}</Td>
                  <Td>{item.barcode || '—'}</Td>
                  <Td className="text-right">${item.unit_price.toFixed(2)}</Td>
                  <Td className="text-right">{item.reorder_threshold ?? '—'}</Td>
                  <Td>
                    <Badge tone={item.is_active ? 'success' : 'neutral'}>
                      {item.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <ItemForm orgId={orgId} item={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Box } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useItems, type ItemListRow } from './api'
import { useItemStockMovements } from '../stock/api'

const reasonTone: Record<string, 'accent' | 'success' | 'warning' | 'neutral'> = {
  receive: 'success',
  sale: 'accent',
  adjustment: 'warning',
  transfer: 'neutral',
  void: 'neutral',
}

export function ItemSearchPage() {
  const { orgId, currencySymbol } = useOrg()
  const { data: items, isLoading } = useItems(orgId)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ItemListRow | null>(null)

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
      <PageHeader title="Search item" subtitle="Find an item and see its stock and history" />

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Search by name, SKU, or barcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          {isLoading ? (
            <PageSpinner />
          ) : (
            <Table>
              <THead>
                <Th>SKU</Th>
                <Th>Name</Th>
                <Th>Category</Th>
              </THead>
              <tbody>
                {filtered.length === 0 && <EmptyState message="No matching items." />}
                {filtered.map((item) => (
                  <Tr
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={selected?.id === item.id ? 'bg-accent-50' : undefined}
                  >
                    <Td>{item.sku}</Td>
                    <Td className="font-medium">{item.name}</Td>
                    <Td>{item.category_name || '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {selected ? (
          <ItemDetail orgId={orgId} item={selected} currencySymbol={currencySymbol} />
        ) : (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-12 text-center text-text-muted">
              <Box size={28} />
              <p className="text-sm">Search above and pick an item to see its stock and history.</p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}

function ItemDetail({
  orgId,
  item,
  currencySymbol,
}: {
  orgId: string
  item: ItemListRow
  currencySymbol: string
}) {
  const { data: movements, isLoading } = useItemStockMovements(orgId, item.id)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={item.name} subtitle={`SKU ${item.sku}`} />
        <CardBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <p className="text-xs text-text-muted">On-hand</p>
              <p className="text-lg font-semibold text-text">{item.on_hand}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Price</p>
              <p className="text-lg font-semibold text-text">{formatMoney(item.unit_price, currencySymbol)}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Category</p>
              <p className="text-sm text-text">{item.category_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Brand</p>
              <p className="text-sm text-text">{item.brand_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Supplier</p>
              <p className="text-sm text-text">{item.supplier_name || '—'}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Stock history" />
        <CardBody className="p-0">
          {isLoading ? (
            <PageSpinner />
          ) : (
            <Table>
              <THead>
                <Th>Date</Th>
                <Th>Location</Th>
                <Th>Reason</Th>
                <Th className="text-right">Change</Th>
              </THead>
              <tbody>
                {(!movements || movements.length === 0) && (
                  <EmptyState message="No stock movements recorded yet." />
                )}
                {movements?.map((m) => (
                  <Tr key={m.id}>
                    <Td>{new Date(m.created_at).toLocaleString()}</Td>
                    <Td>{m.location_name}</Td>
                    <Td>
                      <Badge tone={reasonTone[m.reason] ?? 'neutral'}>{m.reason}</Badge>
                    </Td>
                    <Td
                      className={`text-right ${m.quantity_delta < 0 ? 'text-danger-600' : 'text-success-600'}`}
                    >
                      {m.quantity_delta > 0 ? '+' : ''}
                      {m.quantity_delta}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, History } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { useStockLevels } from './api'
import { AdjustStockModal } from './AdjustStockModal'

export function StockLevelsPage() {
  const { orgId } = useOrg()
  const { data: rows, isLoading } = useStockLevels(orgId)
  const [adjusting, setAdjusting] = useState(false)

  return (
    <div>
      <PageHeader
        title="Stock"
        subtitle="On-hand quantity by item and location"
        action={
          <div className="flex gap-2">
            <Link to="/stock/movements">
              <Button variant="secondary">
                <History size={16} />
                Movement history
              </Button>
            </Link>
            <Button onClick={() => setAdjusting(true)}>
              <Plus size={16} />
              Adjust stock
            </Button>
          </div>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Item</Th>
              <Th>SKU</Th>
              <Th>Location</Th>
              <Th className="text-right">On hand</Th>
            </THead>
            <tbody>
              {(!rows || rows.length === 0) && <EmptyState message="No stock recorded yet." />}
              {rows?.map((row) => (
                <Tr key={`${row.item_id}-${row.location_id}`}>
                  <Td className="font-medium">{row.item_name}</Td>
                  <Td>{row.item_sku}</Td>
                  <Td>{row.location_name}</Td>
                  <Td className="text-right">
                    {row.quantity <= 0 ? (
                      <Badge tone="danger">{row.quantity}</Badge>
                    ) : (
                      row.quantity
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {adjusting && <AdjustStockModal orgId={orgId} onClose={() => setAdjusting(false)} />}
    </div>
  )
}

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { AdjustStockModal } from '../stock/AdjustStockModal'
import { useStockAdjustments } from './api'

export function InventoryAdjustmentsPage() {
  const { orgId } = useOrg()
  const { data: adjustments, isLoading } = useStockAdjustments(orgId)
  const [adjusting, setAdjusting] = useState(false)

  return (
    <div>
      <PageHeader
        title="Inventory adjustment"
        subtitle="Manual stock corrections"
        action={
          <Button onClick={() => setAdjusting(true)}>
            <Plus size={16} />
            New adjustment
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Item</Th>
              <Th>Location</Th>
              <Th className="text-right">Change</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {(!adjustments || adjustments.length === 0) && (
                <EmptyState message="No adjustments recorded yet." />
              )}
              {adjustments?.map((row) => (
                <Tr key={row.id}>
                  <Td>{new Date(row.created_at).toLocaleDateString()}</Td>
                  <Td className="font-medium">
                    {row.item_name} ({row.item_sku})
                  </Td>
                  <Td>{row.location_name}</Td>
                  <Td
                    className={`text-right ${row.quantity_delta < 0 ? 'text-danger-600' : 'text-success-600'}`}
                  >
                    {row.quantity_delta > 0 ? '+' : ''}
                    {row.quantity_delta}
                  </Td>
                  <Td>{row.notes ?? '—'}</Td>
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

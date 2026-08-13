import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useStockTransfers } from './api'
import { NewTransferModal } from './NewTransferModal'

export function InventoryTransfersPage() {
  const { orgId } = useOrg()
  const { data: transfers, isLoading } = useStockTransfers(orgId)
  const [creating, setCreating] = useState(false)

  return (
    <div>
      <PageHeader
        title="Inventory transfer"
        subtitle="Move stock between locations"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            New transfer
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
              <Th>From</Th>
              <Th>To</Th>
              <Th className="text-right">Quantity</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {(!transfers || transfers.length === 0) && <EmptyState message="No transfers yet." />}
              {transfers?.map((t) => (
                <Tr key={t.reference_id}>
                  <Td>{new Date(t.transfer_date).toLocaleDateString()}</Td>
                  <Td className="font-medium">
                    {t.item_name} ({t.item_sku})
                  </Td>
                  <Td>{t.from_location_name}</Td>
                  <Td>{t.to_location_name}</Td>
                  <Td className="text-right">{t.quantity}</Td>
                  <Td>{t.notes ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && <NewTransferModal orgId={orgId} onClose={() => setCreating(false)} />}
    </div>
  )
}

import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { usePurchaseOrders } from './api'

const statusTone: Record<string, 'neutral' | 'accent' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  submitted: 'accent',
  partially_received: 'warning',
  received: 'success',
  cancelled: 'danger',
}

export function PurchaseOrdersListPage() {
  const { orgId } = useOrg()
  const { data: orders, isLoading } = usePurchaseOrders(orgId)
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Orders placed with your suppliers"
        action={
          <Button onClick={() => navigate('/purchase-orders/new')}>
            <Plus size={16} />
            New purchase order
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Supplier</Th>
              <Th>Expected</Th>
              <Th>Status</Th>
              <Th>Created</Th>
            </THead>
            <tbody>
              {(!orders || orders.length === 0) && <EmptyState message="No purchase orders yet." />}
              {orders?.map((po) => (
                <Tr key={po.id}>
                  <Td className="font-medium">
                    <Link to={`/purchase-orders/${po.id}`} className="hover:text-accent-600">
                      {po.supplier_name}
                    </Link>
                  </Td>
                  <Td>{po.expected_date ?? '—'}</Td>
                  <Td>
                    <Badge tone={statusTone[po.status] ?? 'neutral'}>
                      {po.status.replace('_', ' ')}
                    </Badge>
                  </Td>
                  <Td>{new Date(po.created_at).toLocaleDateString()}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

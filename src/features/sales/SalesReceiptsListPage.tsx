import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useSalesReceipts } from './api'

export function SalesReceiptsListPage() {
  const { orgId, currencySymbol } = useOrg()
  const { data: receipts, isLoading } = useSalesReceipts(orgId)
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Completed sales receipts"
        action={
          <Button onClick={() => navigate('/sales/new')}>
            <Plus size={16} />
            New sale
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Receipt #</Th>
              <Th>Customer</Th>
              <Th>Payment</Th>
              <Th className="text-right">Total</Th>
              <Th>Date</Th>
            </THead>
            <tbody>
              {(!receipts || receipts.length === 0) && <EmptyState message="No sales yet." />}
              {receipts?.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">
                    <Link to={`/sales/${r.id}`} className="hover:text-accent-600">
                      {r.receipt_number}
                    </Link>
                  </Td>
                  <Td>{r.customer_name ?? 'Walk-in'}</Td>
                  <Td>
                    <Badge tone="neutral">{r.payment_method.replace('_', ' ')}</Badge>
                  </Td>
                  <Td className="text-right">{formatMoney(r.total, currencySymbol)}</Td>
                  <Td>{new Date(r.created_at).toLocaleString()}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

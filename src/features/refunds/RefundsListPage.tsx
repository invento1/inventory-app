import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useRefunds } from './api'

export function RefundsListPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data: refunds, isLoading } = useRefunds(orgId)

  return (
    <div>
      <PageHeader
        title="Refunds"
        subtitle="Cash paid back to customers"
        action={
          <Button onClick={() => navigate('/refunds/new')}>
            <Plus size={16} />
            New refund
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
              <Th>Refund #</Th>
              <Th>Reference</Th>
              <Th>Customer</Th>
              <Th>Method</Th>
              <Th>Account</Th>
              <Th className="text-right">Amount</Th>
            </THead>
            <tbody>
              {(!refunds || refunds.length === 0) && <EmptyState message="No refunds yet." />}
              {refunds?.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.refund_date}</Td>
                  <Td className="font-medium">{r.refund_number}</Td>
                  <Td>{r.reference_number ?? '—'}</Td>
                  <Td>{r.customer_name}</Td>
                  <Td>
                    <Badge tone="neutral">{r.payment_method.replace('_', ' ')}</Badge>
                  </Td>
                  <Td>{r.account_name}</Td>
                  <Td className="text-right">{formatMoney(r.amount, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

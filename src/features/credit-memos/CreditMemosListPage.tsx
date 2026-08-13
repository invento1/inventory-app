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
import { useCreditMemos } from './api'

export function CreditMemosListPage() {
  const { orgId, currencySymbol } = useOrg()
  const { data: creditMemos, isLoading } = useCreditMemos(orgId)
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Credit memos"
        subtitle="Customer returns and billing credits"
        action={
          <Button onClick={() => navigate('/credit-memos/new')}>
            <Plus size={16} />
            New credit memo
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Credit memo #</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!creditMemos || creditMemos.length === 0) && <EmptyState message="No credit memos yet." />}
              {creditMemos?.map((cm) => (
                <Tr key={cm.id} onClick={() => navigate(`/credit-memos/${cm.id}`)}>
                  <Td className="font-medium">
                    <Link to={`/credit-memos/${cm.id}`} className="hover:text-accent-600">
                      {cm.credit_memo_number}
                    </Link>
                  </Td>
                  <Td>{cm.customer_name}</Td>
                  <Td>{cm.issue_date}</Td>
                  <Td className="text-right">{formatMoney(cm.total, currencySymbol)}</Td>
                  <Td>
                    <Badge tone={cm.status === 'void' ? 'neutral' : 'warning'}>
                      {cm.status === 'void' ? 'Void' : 'Open'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

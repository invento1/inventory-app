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
import { useQuotations } from './api'

export function QuotationsListPage() {
  const { orgId, currencySymbol } = useOrg()
  const { data: quotations, isLoading } = useQuotations(orgId)
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Estimates for customers — don't affect stock or the ledger"
        action={
          <Button onClick={() => navigate('/quotations/new')}>
            <Plus size={16} />
            New quotation
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Quotation #</Th>
              <Th>Customer</Th>
              <Th>Expiry</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!quotations || quotations.length === 0) && <EmptyState message="No quotations yet." />}
              {quotations?.map((q) => (
                <Tr key={q.id} onClick={() => navigate(`/quotations/${q.id}`)}>
                  <Td className="font-medium">
                    <Link to={`/quotations/${q.id}`} className="hover:text-accent-600">
                      {q.quotation_number}
                    </Link>
                  </Td>
                  <Td>{q.customer_name}</Td>
                  <Td>{q.expiry_date ?? '—'}</Td>
                  <Td className="text-right">{formatMoney(q.total, currencySymbol)}</Td>
                  <Td>
                    <Badge tone={q.status === 'void' ? 'neutral' : 'accent'}>
                      {q.status === 'void' ? 'Void' : 'Open'}
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

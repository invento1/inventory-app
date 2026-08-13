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
import { useInvoicePayments } from './api'

export function ViewPaymentsPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data: payments, isLoading } = useInvoicePayments(orgId)

  return (
    <div>
      <PageHeader
        title="View payments"
        subtitle="Every customer payment received"
        action={
          <Button onClick={() => navigate('/account/receive-payment')}>
            <Plus size={16} />
            Receive payment
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
              <Th>Reference</Th>
              <Th>Customer</Th>
              <Th>Invoice #</Th>
              <Th>Method</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!payments || payments.length === 0) && <EmptyState message="No payments yet." />}
              {payments?.map((p) => (
                <Tr key={p.id} onClick={() => navigate(`/invoices/${p.invoice_id}`)}>
                  <Td>{new Date(p.paid_at).toLocaleDateString()}</Td>
                  <Td>{p.reference_number ?? '—'}</Td>
                  <Td>{p.customer_name}</Td>
                  <Td className="font-medium">{p.invoice_number}</Td>
                  <Td>
                    <Badge tone="neutral">{p.payment_method.replace('_', ' ')}</Badge>
                  </Td>
                  <Td className="text-right">{formatMoney(p.amount, currencySymbol)}</Td>
                  <Td>
                    <Badge tone={p.deposit_id ? 'success' : 'warning'}>
                      {p.deposit_id ? 'Deposited' : 'Undeposited'}
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

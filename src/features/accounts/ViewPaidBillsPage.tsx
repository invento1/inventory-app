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
import { useSupplierBillPayments } from './api'

export function ViewPaidBillsPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data: payments, isLoading } = useSupplierBillPayments(orgId)

  return (
    <div>
      <PageHeader
        title="View paid bills"
        subtitle="Every supplier bill payment made"
        action={
          <Button onClick={() => navigate('/account/pay-bills')}>
            <Plus size={16} />
            Pay bills
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
              <Th>Supplier</Th>
              <Th>Bill #</Th>
              <Th>Method</Th>
              <Th>Account</Th>
              <Th className="text-right">Amount</Th>
            </THead>
            <tbody>
              {(!payments || payments.length === 0) && <EmptyState message="No supplier payments yet." />}
              {payments?.map((p) => (
                <Tr key={p.id} onClick={() => navigate(`/supplier-bills/${p.bill_id}`)}>
                  <Td>{new Date(p.paid_at).toLocaleDateString()}</Td>
                  <Td>{p.reference_number ?? '—'}</Td>
                  <Td>{p.supplier_name}</Td>
                  <Td className="font-medium">{p.bill_number}</Td>
                  <Td>
                    <Badge tone="neutral">{p.payment_method.replace('_', ' ')}</Badge>
                  </Td>
                  <Td>{p.account_name}</Td>
                  <Td className="text-right">{formatMoney(p.amount, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

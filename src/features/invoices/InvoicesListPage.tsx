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
import { useInvoices, invoiceStatusTone } from './api'

export function InvoicesListPage() {
  const { orgId, currencySymbol } = useOrg()
  const { data: invoices, isLoading } = useInvoices(orgId)
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Credit sales and accounts receivable"
        action={
          <Button onClick={() => navigate('/invoices/new')}>
            <Plus size={16} />
            New invoice
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Invoice #</Th>
              <Th>Customer</Th>
              <Th>Due date</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!invoices || invoices.length === 0) && <EmptyState message="No invoices yet." />}
              {invoices?.map((inv) => {
                const { tone, label } = invoiceStatusTone(inv)
                return (
                  <Tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <Td className="font-medium">
                      <Link to={`/invoices/${inv.id}`} className="hover:text-accent-600">
                        {inv.invoice_number}
                      </Link>
                    </Td>
                    <Td>{inv.customer_name}</Td>
                    <Td>{inv.due_date}</Td>
                    <Td className="text-right">{formatMoney(inv.total, currencySymbol)}</Td>
                    <Td className="text-right">
                      {formatMoney(inv.total - inv.amount_paid, currencySymbol)}
                    </Td>
                    <Td>
                      <Badge tone={tone}>{label}</Badge>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

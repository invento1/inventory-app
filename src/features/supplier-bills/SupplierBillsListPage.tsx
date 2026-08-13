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
import { useSupplierBills, billStatusTone } from './api'

export function SupplierBillsListPage() {
  const { orgId, currencySymbol } = useOrg()
  const { data: bills, isLoading } = useSupplierBills(orgId)
  const navigate = useNavigate()

  return (
    <div>
      <PageHeader
        title="Supplier bills"
        subtitle="Goods received and accounts payable"
        action={
          <Button onClick={() => navigate('/supplier-bills/new')}>
            <Plus size={16} />
            New bill
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Bill #</Th>
              <Th>Supplier</Th>
              <Th>Due date</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!bills || bills.length === 0) && <EmptyState message="No supplier bills yet." />}
              {bills?.map((bill) => {
                const { tone, label } = billStatusTone(bill)
                return (
                  <Tr key={bill.id} onClick={() => navigate(`/supplier-bills/${bill.id}`)}>
                    <Td className="font-medium">
                      <Link to={`/supplier-bills/${bill.id}`} className="hover:text-accent-600">
                        {bill.bill_number}
                      </Link>
                    </Td>
                    <Td>{bill.supplier_name}</Td>
                    <Td>{bill.due_date}</Td>
                    <Td className="text-right">{formatMoney(bill.total, currencySymbol)}</Td>
                    <Td className="text-right">
                      {formatMoney(bill.total - bill.amount_paid, currencySymbol)}
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

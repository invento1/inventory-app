import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useExpenses, useVoidExpense } from './api'

export function ExpensesListPage() {
  const { orgId, role, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: expenses, isLoading } = useExpenses(orgId)
  const voidExpense = useVoidExpense(orgId)

  async function handleVoid(id: string) {
    try {
      await voidExpense.mutateAsync(id)
      toast.success('Expense voided')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Non-inventory business expenses, paid immediately"
        action={
          <Button onClick={() => navigate('/expenses/new')}>
            <Plus size={16} />
            New expense
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
              <Th>Expense #</Th>
              <Th>Payee</Th>
              <Th>Category</Th>
              <Th>Paid from</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th></Th>
            </THead>
            <tbody>
              {(!expenses || expenses.length === 0) && <EmptyState message="No expenses yet." />}
              {expenses?.map((e) => (
                <Tr key={e.id}>
                  <Td>{e.expense_date}</Td>
                  <Td className="font-medium">{e.expense_number}</Td>
                  <Td>{e.payee_name || e.payee_supplier_name || '—'}</Td>
                  <Td>{e.category_name}</Td>
                  <Td>{e.account_name}</Td>
                  <Td className="text-right">{formatMoney(e.amount, currencySymbol)}</Td>
                  <Td>
                    <Badge tone={e.status === 'void' ? 'neutral' : 'success'}>
                      {e.status === 'void' ? 'Void' : 'Completed'}
                    </Badge>
                  </Td>
                  <Td>
                    {role !== 'staff' && e.status !== 'void' && (
                      <Button variant="ghost" size="sm" onClick={() => handleVoid(e.id)}>
                        Void
                      </Button>
                    )}
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

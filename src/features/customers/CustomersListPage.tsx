import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useCustomers, type Customer } from './api'
import { CustomerForm } from './CustomerForm'

export function CustomersListPage() {
  const { orgId } = useOrg()
  const { data: customers, isLoading } = useCustomers(orgId)
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Who you sell to"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New customer
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Email</Th>
              <Th>Address</Th>
            </THead>
            <tbody>
              {(!customers || customers.length === 0) && <EmptyState message="No customers yet." />}
              {customers?.map((c) => (
                <Tr key={c.id} onClick={() => setEditing(c)}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.phone || '—'}</Td>
                  <Td>{c.email || '—'}</Td>
                  <Td>{c.address || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <CustomerForm orgId={orgId} customer={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

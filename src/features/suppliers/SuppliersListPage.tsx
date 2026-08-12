import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useSuppliers, type Supplier } from './api'
import { SupplierForm } from './SupplierForm'

export function SuppliersListPage() {
  const { orgId } = useOrg()
  const { data: suppliers, isLoading } = useSuppliers(orgId)
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy stock from"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New supplier
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
              <Th>Contact</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
            </THead>
            <tbody>
              {(!suppliers || suppliers.length === 0) && <EmptyState message="No suppliers yet." />}
              {suppliers?.map((s) => (
                <Tr key={s.id} onClick={() => setEditing(s)}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{s.contact_name || '—'}</Td>
                  <Td>{s.contact_email || '—'}</Td>
                  <Td>{s.contact_phone || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <SupplierForm orgId={orgId} supplier={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { useSalesReps, type SalesRep } from './api'
import { SalesRepForm } from './SalesRepForm'

export function SalesRepsPage() {
  const { orgId } = useOrg()
  const { data: reps, isLoading } = useSalesReps(orgId)
  const [editing, setEditing] = useState<SalesRep | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Sales Representatives"
        subtitle="Reps and salesmen. Set one on each customer, and it's filled in on their invoices; commission rates are on each item."
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New representative
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
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!reps || reps.length === 0) && <EmptyState message="No sales representatives yet." />}
              {reps?.map((r) => (
                <Tr key={r.id} onClick={() => setEditing(r)}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="text-text-muted">{r.phone ?? '—'}</Td>
                  <Td className="text-text-muted">{r.email ?? '—'}</Td>
                  <Td>
                    <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && <SalesRepForm orgId={orgId} rep={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

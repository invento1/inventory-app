import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useUnitsOfMeasure, type UnitOfMeasure } from './api'
import { UnitForm } from './UnitForm'

export function UnitsPage() {
  const { orgId } = useOrg()
  const { data: units, isLoading } = useUnitsOfMeasure(orgId)
  const [editing, setEditing] = useState<UnitOfMeasure | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Units (UOM)"
        subtitle="Units of measure for items"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New unit
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
              <Th>Abbreviation</Th>
            </THead>
            <tbody>
              {(!units || units.length === 0) && <EmptyState message="No units yet." />}
              {units?.map((u) => (
                <Tr key={u.id} onClick={() => setEditing(u)}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td>{u.abbreviation || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <UnitForm orgId={orgId} unit={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

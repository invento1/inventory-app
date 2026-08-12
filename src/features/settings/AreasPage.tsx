import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useAreas, type Area } from './api'
import { AreaForm } from './AreaForm'

export function AreasPage() {
  const { orgId } = useOrg()
  const { data: areas, isLoading } = useAreas(orgId)
  const [editing, setEditing] = useState<Area | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Regions & Areas"
        subtitle="Zones used to group customers"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New area
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Area / Zone</Th>
              <Th>Region</Th>
            </THead>
            <tbody>
              {(!areas || areas.length === 0) && <EmptyState message="No areas yet." />}
              {areas?.map((a) => (
                <Tr key={a.id} onClick={() => setEditing(a)}>
                  <Td className="font-medium">{a.name}</Td>
                  <Td>{a.region || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <AreaForm orgId={orgId} area={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

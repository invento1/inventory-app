import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import type { Location } from '../../lib/useLocations'
import { useAllLocations, type LocationType } from './api'
import { LocationForm } from './LocationForm'

export function LocationsSettingsPage({
  type,
  title,
  subtitle,
  singular,
}: {
  type: LocationType
  title: string
  subtitle: string
  singular: string
}) {
  const { orgId } = useOrg()
  const { data: locations, isLoading } = useAllLocations(orgId, type)
  const [editing, setEditing] = useState<Location | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New {singular.toLowerCase()}
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
              <Th>Address</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!locations || locations.length === 0) && (
                <EmptyState message={`No ${title.toLowerCase()} yet.`} />
              )}
              {locations?.map((loc) => (
                <Tr key={loc.id} onClick={() => setEditing(loc)}>
                  <Td className="font-medium">{loc.name}</Td>
                  <Td>{loc.address || '—'}</Td>
                  <Td>
                    <Badge tone={loc.is_active ? 'success' : 'neutral'}>
                      {loc.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <LocationForm
          orgId={orgId}
          type={type}
          singular={singular}
          location={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}

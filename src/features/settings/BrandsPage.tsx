import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useBrands, type Brand } from './api'
import { BrandForm } from './BrandForm'

export function BrandsPage() {
  const { orgId } = useOrg()
  const { data: brands, isLoading } = useBrands(orgId)
  const [editing, setEditing] = useState<Brand | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Brands"
        subtitle="Manufacturer / brand names"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New brand
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
            </THead>
            <tbody>
              {(!brands || brands.length === 0) && <EmptyState message="No brands yet." />}
              {brands?.map((b) => (
                <Tr key={b.id} onClick={() => setEditing(b)}>
                  <Td className="font-medium">{b.name}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <BrandForm orgId={orgId} brand={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

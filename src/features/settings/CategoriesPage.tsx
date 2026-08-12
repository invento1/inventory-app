import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useCategories, type Category } from './api'
import { CategoryForm } from './CategoryForm'

export function CategoriesPage() {
  const { orgId } = useOrg()
  const { data: categories, isLoading } = useCategories(orgId)
  const [editing, setEditing] = useState<Category | null | undefined>(undefined)

  const nameById = new Map((categories ?? []).map((c) => [c.id, c.name]))

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Group items into categories"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New category
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
              <Th>Parent</Th>
            </THead>
            <tbody>
              {(!categories || categories.length === 0) && <EmptyState message="No categories yet." />}
              {categories?.map((c) => (
                <Tr key={c.id} onClick={() => setEditing(c)}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{(c.parent_id && nameById.get(c.parent_id)) || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <CategoryForm orgId={orgId} category={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

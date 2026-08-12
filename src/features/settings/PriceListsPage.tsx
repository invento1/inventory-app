import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { usePriceLists, type PriceList } from './api'
import { PriceListForm } from './PriceListForm'

const typeLabel: Record<string, string> = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  custom: 'Custom',
}

export function PriceListsPage() {
  const { orgId } = useOrg()
  const { data: priceLists, isLoading } = usePriceLists(orgId)
  const [editing, setEditing] = useState<PriceList | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Price Lists"
        subtitle="Dated price sheets, by type"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New price list
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
              <Th>Type</Th>
              <Th>Image</Th>
            </THead>
            <tbody>
              {(!priceLists || priceLists.length === 0) && <EmptyState message="No price lists yet." />}
              {priceLists?.map((pl) => (
                <Tr key={pl.id} onClick={() => setEditing(pl)}>
                  <Td className="font-medium">{pl.list_date}</Td>
                  <Td>
                    <Badge tone="neutral">{typeLabel[pl.list_type] ?? pl.list_type}</Badge>
                  </Td>
                  <Td>
                    {pl.image_url ? (
                      <a
                        href={pl.image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <PriceListForm orgId={orgId} priceList={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

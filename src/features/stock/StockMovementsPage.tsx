import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { useStockMovements } from './api'

const reasonTone: Record<string, 'accent' | 'success' | 'warning' | 'neutral'> = {
  receive: 'success',
  sale: 'accent',
  adjustment: 'warning',
  transfer: 'neutral',
}

export function StockMovementsPage() {
  const { orgId } = useOrg()
  const { data: rows, isLoading } = useStockMovements(orgId)

  return (
    <div>
      <PageHeader
        title="Movement history"
        subtitle="Last 200 stock changes, most recent first"
        action={
          <Link to="/stock">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text">
              <ArrowLeft size={16} />
              Back to stock
            </span>
          </Link>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Item</Th>
              <Th>Location</Th>
              <Th>Reason</Th>
              <Th className="text-right">Change</Th>
            </THead>
            <tbody>
              {(!rows || rows.length === 0) && <EmptyState message="No stock movements yet." />}
              {rows?.map((row) => (
                <Tr key={row.id}>
                  <Td>{new Date(row.created_at).toLocaleString()}</Td>
                  <Td className="font-medium">{row.item_name}</Td>
                  <Td>{row.location_name}</Td>
                  <Td>
                    <Badge tone={reasonTone[row.reason] ?? 'neutral'}>{row.reason}</Badge>
                  </Td>
                  <Td className={`text-right ${row.quantity_delta < 0 ? 'text-danger-600' : 'text-success-600'}`}>
                    {row.quantity_delta > 0 ? '+' : ''}
                    {row.quantity_delta}
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

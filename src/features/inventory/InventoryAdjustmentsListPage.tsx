import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useInventoryAdjustments, type AdjustmentType } from './api'

const TYPE_LABELS: Record<AdjustmentType, string> = {
  quantity: 'Quantity',
  value: 'Value',
  quantity_and_value: 'Quantity & Value',
}

export function InventoryAdjustmentsListPage() {
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const { data: adjustments, isLoading } = useInventoryAdjustments(orgId)

  return (
    <div>
      <PageHeader
        title="Inventory adjustments"
        subtitle="Quantity and value corrections, posted to the ledger"
        action={
          can('inventory.adjust') && (
            <Link to="/inventory-adjustments/new">
              <Button>
                <Plus size={16} />
                New adjustment
              </Button>
            </Link>
          )
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Adjustment #</Th>
              <Th>Date</Th>
              <Th>Location</Th>
              <Th>Type</Th>
              <Th>Adjustment account</Th>
              <Th className="text-right">Total value</Th>
              <Th>Description</Th>
            </THead>
            <tbody>
              {(!adjustments || adjustments.length === 0) && (
                <EmptyState message="No inventory adjustments recorded yet." />
              )}
              {adjustments?.map((row) => (
                <Tr key={row.id} onClick={() => navigate(`/inventory-adjustments/${row.id}`)}>
                  <Td className="font-medium">{row.adjustment_number}</Td>
                  <Td>{row.adjustment_date}</Td>
                  <Td>{row.location_name}</Td>
                  <Td>
                    <Badge tone="neutral">{TYPE_LABELS[row.adjustment_type as AdjustmentType]}</Badge>
                  </Td>
                  <Td>{row.adjustment_account_name}</Td>
                  <Td
                    className={`text-right font-medium ${
                      row.total_value_diff > 0
                        ? 'text-success-600'
                        : row.total_value_diff < 0
                          ? 'text-danger-600'
                          : 'text-text-muted'
                    }`}
                  >
                    {row.total_value_diff > 0 ? '+' : ''}
                    {formatMoney(row.total_value_diff, currencySymbol)}
                  </Td>
                  <Td>{row.description ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

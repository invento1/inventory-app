import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useInventoryAdjustment, type AdjustmentType } from './api'

const TYPE_LABELS: Record<AdjustmentType, string> = {
  quantity: 'Quantity',
  value: 'Value',
  quantity_and_value: 'Quantity & Value',
}

export function InventoryAdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data, isLoading } = useInventoryAdjustment(orgId, id!)

  if (isLoading || !data) return <PageSpinner />

  const { adjustment, lines } = data
  const type = adjustment.adjustment_type as AdjustmentType

  return (
    <div>
      <PageHeader
        title={adjustment.adjustment_number}
        subtitle={adjustment.location_name}
        action={
          <button
            type="button"
            onClick={() => navigate('/inventory-adjustments')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone="neutral">{TYPE_LABELS[type]}</Badge>
        <span className="text-sm text-text-muted">Dated {adjustment.adjustment_date}</span>
        <span className="text-sm text-text-muted">Adjustment account: {adjustment.adjustment_account_name}</span>
        {adjustment.reference_number && (
          <span className="text-sm text-text-muted">Ref: {adjustment.reference_number}</span>
        )}
      </div>

      <Card>
        <CardHeader title="Items" />
        <CardBody className="p-0">
          <Table>
            <THead>
              <Th>Item</Th>
              <Th className="text-right">Qty on hand</Th>
              <Th className="text-right">Current value</Th>
              <Th className="text-right">New qty</Th>
              <Th className="text-right">New value</Th>
              <Th className="text-right">Value diff.</Th>
            </THead>
            <tbody>
              {lines.map((line) => (
                <Tr key={line.id}>
                  <Td className="font-medium">
                    {line.item_name} ({line.item_sku})
                  </Td>
                  <Td className="text-right">{line.qty_on_hand_before}</Td>
                  <Td className="text-right">{formatMoney(line.current_value_before, currencySymbol)}</Td>
                  <Td className="text-right">{line.new_qty}</Td>
                  <Td className="text-right">{formatMoney(line.new_value, currencySymbol)}</Td>
                  <Td
                    className={`text-right font-medium ${
                      line.value_diff > 0 ? 'text-success-600' : line.value_diff < 0 ? 'text-danger-600' : ''
                    }`}
                  >
                    {line.value_diff > 0 ? '+' : ''}
                    {formatMoney(line.value_diff, currencySymbol)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mt-4 flex justify-end">
        <div className="w-64 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex justify-between text-base font-semibold text-text">
            <span>Total value of adjustment</span>
            <span
              className={
                adjustment.total_value_diff > 0
                  ? 'text-success-600'
                  : adjustment.total_value_diff < 0
                    ? 'text-danger-600'
                    : ''
              }
            >
              {adjustment.total_value_diff > 0 ? '+' : ''}
              {formatMoney(adjustment.total_value_diff, currencySymbol)}
            </span>
          </div>
        </div>
      </div>

      {adjustment.description && <p className="mt-4 text-sm text-text-muted">{adjustment.description}</p>}
    </div>
  )
}

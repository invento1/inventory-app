import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useSalesReceipt } from './api'

export function SalesReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data, isLoading } = useSalesReceipt(orgId, id!)

  if (isLoading || !data) return <PageSpinner />

  const { receipt, lines } = data

  return (
    <div>
      <PageHeader
        title={receipt.receipt_number}
        subtitle={new Date(receipt.created_at).toLocaleString()}
        action={
          <button
            type="button"
            onClick={() => navigate('/sales')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={receipt.status === 'completed' ? 'success' : 'danger'}>
          {receipt.status}
        </Badge>
        <span className="text-sm text-text-muted">
          {receipt.customers?.name ?? 'Walk-in customer'}
        </span>
        <Badge tone="neutral">{receipt.payment_method.replace('_', ' ')}</Badge>
      </div>

      <Card>
        <CardHeader title="Items" />
        <CardBody className="p-0">
          <Table>
            <THead>
              <Th>Item</Th>
              <Th>Location</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Unit price</Th>
              <Th className="text-right">Line total</Th>
            </THead>
            <tbody>
              {lines.map((line) => (
                <Tr key={line.id}>
                  <Td className="font-medium">
                    {line.item_name} ({line.item_sku})
                  </Td>
                  <Td>{line.location_name}</Td>
                  <Td className="text-right">{line.quantity}</Td>
                  <Td className="text-right">{formatMoney(line.unit_price, currencySymbol)}</Td>
                  <Td className="text-right">{formatMoney(line.line_total, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mt-4 flex justify-end">
        <div className="w-64 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex justify-between text-sm text-text-muted">
            <span>Subtotal</span>
            <span>{formatMoney(receipt.subtotal, currencySymbol)}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-semibold text-text">
            <span>Total</span>
            <span>{formatMoney(receipt.total, currencySymbol)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

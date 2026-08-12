import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { useLocations } from '../../lib/useLocations'
import { formatMoney } from '../../lib/currency'
import { usePurchaseOrder, useReceivePurchaseOrderLine } from './api'

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = usePurchaseOrder(orgId, id!)
  const { data: locations } = useLocations(orgId)
  const receiveLine = useReceivePurchaseOrderLine(orgId, id!)

  const [locationId, setLocationId] = useState('')
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({})

  if (isLoading || !data) return <PageSpinner />

  const { po, lines } = data

  async function handleReceive(lineId: string) {
    const qty = Number(receiveQty[lineId])
    if (!locationId) {
      toast.error('Choose a location first.')
      return
    }
    if (!qty || qty <= 0) {
      toast.error('Enter a quantity greater than zero.')
      return
    }
    try {
      await receiveLine.mutateAsync({ poLineId: lineId, locationId, quantity: qty })
      setReceiveQty((current) => ({ ...current, [lineId]: '' }))
      toast.success('Stock received')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title={`PO — ${po.suppliers?.name ?? 'Unknown supplier'}`}
        subtitle={`Expected ${po.expected_date ?? 'no date set'}`}
        action={
          <button
            type="button"
            onClick={() => navigate('/purchase-orders')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={po.status === 'received' ? 'success' : 'accent'}>
          {po.status.replace('_', ' ')}
        </Badge>
        <div className="w-56">
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Receiving location…</option>
            {locations?.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader title="Line items" />
        <CardBody className="p-0">
          <Table>
            <THead>
              <Th>Item</Th>
              <Th className="text-right">Ordered</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Unit cost</Th>
              <Th>Receive</Th>
            </THead>
            <tbody>
              {lines.map((line) => {
                const remaining = line.quantity_ordered - line.quantity_received
                return (
                  <Tr key={line.id}>
                    <Td className="font-medium">
                      {line.item_name} ({line.item_sku})
                    </Td>
                    <Td className="text-right">{line.quantity_ordered}</Td>
                    <Td className="text-right">{line.quantity_received}</Td>
                    <Td className="text-right">
                      {line.unit_cost != null ? formatMoney(line.unit_cost, currencySymbol) : '—'}
                    </Td>
                    <Td>
                      {remaining <= 0 ? (
                        <span className="text-xs text-text-muted">Fully received</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-24">
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              placeholder={`${remaining}`}
                              value={receiveQty[line.id] ?? ''}
                              onChange={(e) =>
                                setReceiveQty((current) => ({ ...current, [line.id]: e.target.value }))
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleReceive(line.id)}
                            disabled={receiveLine.isPending}
                          >
                            Receive
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  )
}

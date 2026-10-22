import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Pencil } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { SALES_ORDER_STATUS, useCancelSalesOrder, useSalesOrder, type SalesOrderStatus } from './api'

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useSalesOrder(orgId, id)
  const cancelOrder = useCancelSalesOrder(orgId, id!)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  if (isLoading || !data) return <PageSpinner />

  const { order, lines } = data
  const status = SALES_ORDER_STATUS[order.status as SalesOrderStatus] ?? SALES_ORDER_STATUS.open
  const isOpen = order.status === 'open'
  const hasLineDiscounts = lines.some((l) => l.discount > 0)

  async function handleCancel() {
    try {
      await cancelOrder.mutateAsync()
      toast.success('Sales order cancelled')
      setConfirmingCancel(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title={order.order_number}
        subtitle={order.customers?.name ?? ''}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {isOpen && can('sales_orders.create') && (
              <Button variant="secondary" size="sm" onClick={() => navigate(`/sales-orders/${order.id}/edit`)}>
                <Pencil size={14} />
                Edit
              </Button>
            )}
            {isOpen && can('invoices.create') && (
              <Button size="sm" onClick={() => navigate(`/invoices/new?fromOrder=${order.id}`)}>
                <FileText size={14} />
                Convert to invoice
              </Button>
            )}
            <button
              type="button"
              onClick={() => navigate('/sales-orders')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="text-sm text-text-muted">Ordered {order.order_date}</span>
        {order.delivery_date && <span className="text-sm text-text-muted">Deliver by {order.delivery_date}</span>}
        {order.sales_reps && <span className="text-sm text-text-muted">Rep: {order.sales_reps.name}</span>}
        {order.invoice_id && order.invoices && (
          <span className="text-sm text-text-muted">
            Invoiced as{' '}
            <Link to={`/invoices/${order.invoice_id}`} className="font-medium text-accent-700 hover:underline">
              {order.invoices.invoice_number}
            </Link>
          </span>
        )}
      </div>

      <Card>
        <CardHeader title="Items" />
        <CardBody className="p-0">
          <Table>
            <THead>
              <Th>Item</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Unit price</Th>
              {hasLineDiscounts && <Th className="text-right">Discount</Th>}
              <Th className="text-right">Line total</Th>
            </THead>
            <tbody>
              {lines.map((line) => (
                <Tr key={line.id}>
                  <Td className="font-medium">
                    {line.item_name} ({line.item_sku})
                  </Td>
                  <Td className="text-right">{line.quantity}</Td>
                  <Td className="text-right">{formatMoney(line.unit_price, currencySymbol)}</Td>
                  {hasLineDiscounts && (
                    <Td className="text-right">{line.discount > 0 ? formatMoney(line.discount, currencySymbol) : '—'}</Td>
                  )}
                  <Td className="text-right">{formatMoney(line.line_total, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mt-4 flex justify-end">
        <div className="w-64 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex justify-between text-sm text-text-muted">
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotal, currencySymbol)}</span>
          </div>
          {order.discount > 0 && (
            <div className="mt-1 flex justify-between text-sm text-text-muted">
              <span>Discount</span>
              <span>− {formatMoney(order.discount, currencySymbol)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-base font-semibold text-text">
            <span>Total</span>
            <span>{formatMoney(order.total, currencySymbol)}</span>
          </div>
        </div>
      </div>

      {order.notes && <p className="mt-4 text-sm text-text-muted">{order.notes}</p>}

      {isOpen && can('sales_orders.void') && (
        <div className="mt-6 flex items-center justify-end gap-3">
          {confirmingCancel ? (
            <>
              <span className="text-sm text-text-muted">Cancel this sales order?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingCancel(false)}>
                Keep it
              </Button>
              <Button variant="danger" size="sm" onClick={handleCancel} disabled={cancelOrder.isPending}>
                {cancelOrder.isPending ? 'Cancelling…' : 'Confirm cancel'}
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmingCancel(true)}>
              Cancel order
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

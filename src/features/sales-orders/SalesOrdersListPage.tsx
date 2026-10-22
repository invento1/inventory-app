import { useState } from 'react'
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
import { cn } from '../../lib/cn'
import { SALES_ORDER_STATUS, useSalesOrders, type SalesOrderStatus } from './api'

const FILTERS: { key: SalesOrderStatus | 'all'; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'invoiced', label: 'Invoiced' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
]

export function SalesOrdersListPage() {
  const { orgId, currencySymbol, can } = useOrg()
  const { data: orders, isLoading } = useSalesOrders(orgId)
  const navigate = useNavigate()
  const [filter, setFilter] = useState<SalesOrderStatus | 'all'>('open')

  const shown = (orders ?? []).filter((o) => filter === 'all' || o.status === filter)
  const count = (key: SalesOrderStatus | 'all') =>
    key === 'all' ? (orders?.length ?? 0) : (orders ?? []).filter((o) => o.status === key).length

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        subtitle="A customer's order before it's invoiced. Doesn't touch stock or the ledger until you convert it."
        action={
          can('sales_orders.create') && (
            <Button onClick={() => navigate('/sales-orders/new')}>
              <Plus size={16} />
              New sales order
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              filter === f.key
                ? 'border-accent-600 bg-accent-50 text-accent-700'
                : 'border-border text-text-muted hover:bg-surface-muted hover:text-text',
            )}
          >
            {f.label} <span className="tabular-nums">{count(f.key)}</span>
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Order #</Th>
              <Th>Date</Th>
              <Th>Customer</Th>
              <Th>Rep</Th>
              <Th>Delivery</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {shown.length === 0 && <EmptyState message="No sales orders here." />}
              {shown.map((o) => {
                const status = SALES_ORDER_STATUS[o.status as SalesOrderStatus] ?? SALES_ORDER_STATUS.open
                return (
                  <Tr key={o.id} onClick={() => navigate(`/sales-orders/${o.id}`)}>
                    <Td className="font-medium">
                      <Link to={`/sales-orders/${o.id}`} className="hover:text-accent-600">
                        {o.order_number}
                      </Link>
                    </Td>
                    <Td>{o.order_date}</Td>
                    <Td>{o.customer_name}</Td>
                    <Td className="text-text-muted">{o.rep_name ?? '—'}</Td>
                    <Td>{o.delivery_date ?? '—'}</Td>
                    <Td className="text-right">{formatMoney(o.total, currencySymbol)}</Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {o.invoice_number && <span className="ml-2 text-xs text-text-muted">{o.invoice_number}</span>}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

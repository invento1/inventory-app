import { useNavigate } from 'react-router-dom'
import { Package, AlertTriangle, Receipt, DollarSign, Plus, FileWarning } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useDashboardSummary, useLowStock } from './api'

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  to,
}: {
  label: string
  value: string
  icon: typeof Package
  tone: string
  to: string
}) {
  const navigate = useNavigate()
  return (
    <Card
      onClick={() => navigate(to)}
      className="cursor-pointer transition-shadow hover:shadow-md"
    >
      <CardBody className="flex items-center gap-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
          <Icon size={20} />
        </div>
        <div>
          <p className="text-xs font-medium text-text-muted">{label}</p>
          <p className="text-xl font-semibold text-text">{value}</p>
        </div>
      </CardBody>
    </Card>
  )
}

export function DashboardPage() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary(orgId)
  const { data: lowStock, isLoading: lowStockLoading } = useLowStock(orgId)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        action={
          <Button onClick={() => navigate('/sales/new')}>
            <Plus size={16} />
            New sale
          </Button>
        }
      />

      {summaryLoading ? (
        <PageSpinner />
      ) : (
        <div className="mb-6 grid grid-cols-3 gap-4 lg:grid-cols-6">
          <StatCard
            label="Active items"
            value={String(summary?.item_count ?? 0)}
            icon={Package}
            tone="bg-accent-50 text-accent-700"
            to="/items"
          />
          <StatCard
            label="Low stock"
            value={String(summary?.low_stock_count ?? 0)}
            icon={AlertTriangle}
            tone="bg-warning-50 text-warning-600"
            to="/stock"
          />
          <StatCard
            label="Sales today"
            value={String(summary?.today_sales_count ?? 0)}
            icon={Receipt}
            tone="bg-success-50 text-success-600"
            to="/sales"
          />
          <StatCard
            label="Revenue today"
            value={`$${(summary?.today_sales_total ?? 0).toFixed(2)}`}
            icon={DollarSign}
            tone="bg-accent-50 text-accent-700"
            to="/sales"
          />
          <StatCard
            label="Outstanding AR"
            value={`$${(summary?.outstanding_ar_total ?? 0).toFixed(2)}`}
            icon={DollarSign}
            tone="bg-warning-50 text-warning-600"
            to="/invoices"
          />
          <StatCard
            label="Overdue invoices"
            value={String(summary?.overdue_invoice_count ?? 0)}
            icon={FileWarning}
            tone="bg-danger-50 text-danger-600"
            to="/invoices"
          />
        </div>
      )}

      <Card>
        <CardHeader title="Low stock" subtitle="Items at or below their reorder point" />
        <CardBody className="p-0">
          {lowStockLoading ? (
            <PageSpinner />
          ) : (
            <Table>
              <THead>
                <Th>Item</Th>
                <Th>Location</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Reorder at</Th>
              </THead>
              <tbody>
                {(!lowStock || lowStock.length === 0) && (
                  <EmptyState message="Nothing is low on stock." />
                )}
                {lowStock?.map((row) => (
                  <Tr key={`${row.item_id}-${row.location_id}`}>
                    <Td className="font-medium">
                      {row.item_name} ({row.item_sku})
                    </Td>
                    <Td>{row.location_name}</Td>
                    <Td className="text-right text-danger-600">{row.quantity}</Td>
                    <Td className="text-right">{row.reorder_threshold}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

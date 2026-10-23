import { Link, useNavigate } from 'react-router-dom'
import { Download, Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import {
  DOCUMENT_LIST_LIMIT,
  daysOverdue,
  isOverdue,
  sortDocuments,
  useDocumentListFilters,
} from '../../lib/documentListFilters'
import { downloadCsv, type CsvRow } from '../reports/csv'
import { useCustomers } from '../customers/api'
import { useSalesReps } from '../sales-reps/api'
import { DocumentFilterBar, DocumentTotals } from '../transactions/DocumentListParts'
import { useInvoices, invoiceStatusTone } from './api'

export function InvoicesListPage() {
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const { filters, setFilter, clear, isFiltered } = useDocumentListFilters()
  const { data, isLoading } = useInvoices(orgId, filters)
  const { data: customers } = useCustomers(orgId)
  const { data: reps } = useSalesReps(orgId)
  const invoices = sortDocuments(data?.rows ?? [], filters.sort)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Invoice', 'Issued', 'Customer', 'Sales rep', 'Due date', 'Status', 'Total', 'Paid', 'Balance', 'Days overdue'],
      ...invoices.map((inv): CsvRow => [
        inv.invoice_number,
        inv.issue_date,
        inv.customer_name,
        inv.rep_name ?? '',
        inv.due_date,
        invoiceStatusTone(inv).label,
        inv.total,
        inv.amount_paid,
        inv.total - inv.amount_paid,
        isOverdue(inv) ? daysOverdue(inv.due_date) : '',
      ]),
    ]
    downloadCsv('invoices', out)
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Credit sales and accounts receivable"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={invoices.length === 0}>
              <Download size={16} />
              Export CSV
            </Button>
            {can('invoices.create') && (
              <Button onClick={() => navigate('/invoices/new')}>
                <Plus size={16} />
                New invoice
              </Button>
            )}
          </div>
        }
      />

      <DocumentFilterBar
        filters={filters}
        setFilter={setFilter}
        clear={clear}
        isFiltered={isFiltered}
        numberLabel="Invoice number…"
        partyLabel="Customer"
        parties={customers ?? []}
        reps={reps ?? []}
      />

      {!isLoading && (
        <DocumentTotals
          rows={invoices}
          noun="invoice"
          symbol={currencySymbol}
          isOverdue={isOverdue}
          truncated={data?.truncated ?? false}
          limit={DOCUMENT_LIST_LIMIT}
        />
      )}

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Invoice #</Th>
              <Th>Issued</Th>
              <Th>Customer</Th>
              <Th>Rep</Th>
              <Th>Due date</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {invoices.length === 0 && (
                <EmptyState message={isFiltered ? 'No invoices match these filters.' : 'No invoices yet.'} />
              )}
              {invoices.map((inv) => {
                const { tone, label } = invoiceStatusTone(inv)
                const overdue = isOverdue(inv)
                return (
                  <Tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <Td className="font-medium">
                      <Link to={`/invoices/${inv.id}`} className="hover:text-accent-600">
                        {inv.invoice_number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-text-muted">{inv.issue_date}</Td>
                    <Td>{inv.customer_name}</Td>
                    <Td className="text-text-muted">{inv.rep_name ?? '—'}</Td>
                    <Td className="whitespace-nowrap">
                      {inv.due_date}
                      {overdue && (
                        <span className="ml-2 text-xs text-danger-600">{daysOverdue(inv.due_date)} days late</span>
                      )}
                    </Td>
                    <Td className="text-right">{formatMoney(inv.total, currencySymbol)}</Td>
                    <Td className="text-right">
                      {inv.status === 'void' ? '—' : formatMoney(inv.total - inv.amount_paid, currencySymbol)}
                    </Td>
                    <Td>
                      <Badge tone={tone}>{label}</Badge>
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

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
import { useSuppliers } from '../suppliers/api'
import { DocumentFilterBar, DocumentTotals } from '../transactions/DocumentListParts'
import { useSupplierBills, billStatusTone } from './api'

export function SupplierBillsListPage() {
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const { filters, setFilter, clear, isFiltered } = useDocumentListFilters()
  const { data, isLoading } = useSupplierBills(orgId, filters)
  const { data: suppliers } = useSuppliers(orgId)
  const bills = sortDocuments(data?.rows ?? [], filters.sort)

  function exportCsv() {
    const out: CsvRow[] = [
      ['Bill', 'Issued', 'Supplier', 'Due date', 'Status', 'Total', 'Paid', 'Balance', 'Days overdue'],
      ...bills.map((bill): CsvRow => [
        bill.bill_number,
        bill.issue_date,
        bill.supplier_name,
        bill.due_date,
        billStatusTone(bill).label,
        bill.total,
        bill.amount_paid,
        bill.total - bill.amount_paid,
        isOverdue(bill) ? daysOverdue(bill.due_date) : '',
      ]),
    ]
    downloadCsv('supplier-bills', out)
  }

  return (
    <div>
      <PageHeader
        title="Supplier bills"
        subtitle="Goods received and accounts payable"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={bills.length === 0}>
              <Download size={16} />
              Export CSV
            </Button>
            {can('supplier_bills.create') && (
              <Button onClick={() => navigate('/supplier-bills/new')}>
                <Plus size={16} />
                New bill
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
        numberLabel="Bill number…"
        partyLabel="Supplier"
        parties={suppliers ?? []}
      />

      {!isLoading && (
        <DocumentTotals
          rows={bills}
          noun="bill"
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
              <Th>Bill #</Th>
              <Th>Issued</Th>
              <Th>Supplier</Th>
              <Th>Due date</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {bills.length === 0 && (
                <EmptyState message={isFiltered ? 'No bills match these filters.' : 'No supplier bills yet.'} />
              )}
              {bills.map((bill) => {
                const { tone, label } = billStatusTone(bill)
                const overdue = isOverdue(bill)
                return (
                  <Tr key={bill.id} onClick={() => navigate(`/supplier-bills/${bill.id}`)}>
                    <Td className="font-medium">
                      <Link to={`/supplier-bills/${bill.id}`} className="hover:text-accent-600">
                        {bill.bill_number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-text-muted">{bill.issue_date}</Td>
                    <Td>{bill.supplier_name}</Td>
                    <Td className="whitespace-nowrap">
                      {bill.due_date}
                      {overdue && (
                        <span className="ml-2 text-xs text-danger-600">{daysOverdue(bill.due_date)} days late</span>
                      )}
                    </Td>
                    <Td className="text-right">{formatMoney(bill.total, currencySymbol)}</Td>
                    <Td className="text-right">
                      {bill.status === 'void' ? '—' : formatMoney(bill.total - bill.amount_paid, currencySymbol)}
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

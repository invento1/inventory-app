import { useNavigate } from 'react-router-dom'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useAllTransactions, DOC_TYPE_LABELS, DOC_TYPE_ROUTES } from './api'

export function AllTransactionsPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data: transactions, isLoading } = useAllTransactions(orgId)

  return (
    <div>
      <PageHeader title="All transactions" subtitle="Every document across the business, newest first" />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Doc #</Th>
              <Th>Party</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!transactions || transactions.length === 0) && (
                <EmptyState message="No transactions recorded yet." />
              )}
              {transactions?.map((t) => {
                const routeFor = t.doc_type ? DOC_TYPE_ROUTES[t.doc_type] : undefined
                const clickable = routeFor && t.doc_id
                return (
                  <Tr
                    key={`${t.doc_type}-${t.doc_id}`}
                    onClick={clickable ? () => navigate(routeFor(t.doc_id!)) : undefined}
                  >
                    <Td>{t.txn_date}</Td>
                    <Td>
                      <Badge tone="neutral">{t.doc_type ? DOC_TYPE_LABELS[t.doc_type] ?? t.doc_type : '—'}</Badge>
                    </Td>
                    <Td className="font-medium">{t.doc_number}</Td>
                    <Td>{t.party_name || '—'}</Td>
                    <Td className="text-right">{formatMoney(t.total ?? 0, currencySymbol)}</Td>
                    <Td>{t.status ?? '—'}</Td>
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

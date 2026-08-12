import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useJournalEntries } from './api'

export function FiscalDaybookPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data: lines, isLoading } = useJournalEntries(orgId)

  return (
    <div>
      <PageHeader
        title="Fiscal Daybook"
        subtitle="General journal"
        action={
          <Button onClick={() => navigate('/account/fiscal-daybook/new')}>
            <Plus size={16} />
            New entry
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Entry #</Th>
              <Th>Account</Th>
              <Th>Name</Th>
              <Th>Memo</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
            </THead>
            <tbody>
              {(!lines || lines.length === 0) && <EmptyState message="No journal entries yet." />}
              {lines?.map((l) => (
                <Tr key={l.id}>
                  <Td>{l.entry_date}</Td>
                  <Td className="font-medium">{l.entry_number}</Td>
                  <Td>{l.account_name}</Td>
                  <Td>{l.name || '—'}</Td>
                  <Td>{l.memo || l.entry_memo || '—'}</Td>
                  <Td className="text-right">{l.debit ? formatMoney(l.debit, currencySymbol) : ''}</Td>
                  <Td className="text-right">{l.credit ? formatMoney(l.credit, currencySymbol) : ''}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

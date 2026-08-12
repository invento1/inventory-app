import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useAccountLedger, accountTypeLabel } from './api'
import { LedgerAccountForm } from './LedgerAccountForm'

export function AccountLedgerPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data, isLoading } = useAccountLedger(orgId, id!)
  const [editing, setEditing] = useState(false)

  if (isLoading || !data) return <PageSpinner />

  const { account, lines } = data

  return (
    <div>
      <PageHeader
        title={account.name}
        subtitle={`${accountTypeLabel(account.account_type)} · balance ${formatMoney(
          lines.length ? lines[lines.length - 1].running_balance : 0,
          currencySymbol,
        )}`}
        action={
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit
            </Button>
            <button
              type="button"
              onClick={() => navigate('/account/capital-matrix')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          </div>
        }
      />

      <Card>
        <CardHeader title="Transactions" />
        <CardBody className="p-0">
          {lines.length === 0 ? (
            <Table>
              <tbody>
                <EmptyState message="This account has no journal entries yet." />
              </tbody>
            </Table>
          ) : (
            <Table>
              <THead>
                <Th>Entry</Th>
                <Th>Name</Th>
                <Th>Memo</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
                <Th className="text-right">Balance</Th>
              </THead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={l.id}>
                    <Td className="font-medium">{l.entry_number}</Td>
                    <Td>{l.name || '—'}</Td>
                    <Td>{l.memo || '—'}</Td>
                    <Td className="text-right">{l.debit ? formatMoney(l.debit, currencySymbol) : ''}</Td>
                    <Td className="text-right">{l.credit ? formatMoney(l.credit, currencySymbol) : ''}</Td>
                    <Td className="text-right">{formatMoney(l.running_balance, currencySymbol)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {editing && (
        <LedgerAccountForm orgId={orgId} account={account} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

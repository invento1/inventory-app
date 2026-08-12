import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useLedgerAccounts, accountTypeLabel, type LedgerAccountRow } from './api'
import { LedgerAccountForm } from './LedgerAccountForm'

export function CapitalMatrixPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data: accounts, isLoading } = useLedgerAccounts(orgId)
  const [editing, setEditing] = useState<LedgerAccountRow | null | undefined>(undefined)

  return (
    <div>
      <PageHeader
        title="Capital Matrix"
        subtitle="Chart of accounts"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            New account
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {(!accounts || accounts.length === 0) && <EmptyState message="No accounts yet." />}
              {accounts?.map((a) => (
                <Tr key={a.id} onClick={() => navigate(`/account/capital-matrix/${a.id}`)}>
                  <Td className="font-medium">{a.name}</Td>
                  <Td>{accountTypeLabel(a.account_type)}</Td>
                  <Td className="text-right">{formatMoney(a.balance, currencySymbol)}</Td>
                  <Td>
                    <Badge tone={a.is_active ? 'success' : 'neutral'}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing !== undefined && (
        <LedgerAccountForm orgId={orgId} account={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useDeposits, useDeposit } from './api'

function DepositDetailModal({ orgId, depositId, onClose }: { orgId: string; depositId: string; onClose: () => void }) {
  const { currencySymbol } = useOrg()
  const { data, isLoading } = useDeposit(orgId, depositId)

  return (
    <Modal title={data ? `Deposit ${data.deposit.deposit_number}` : 'Deposit'} onClose={onClose}>
      {isLoading || !data ? (
        <PageSpinner />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            {data.deposit.deposit_date} · into {data.deposit.ledger_accounts?.name ?? '—'}
            {data.deposit.memo ? ` · ${data.deposit.memo}` : ''}
          </p>
          <Table>
            <THead>
              <Th>Customer</Th>
              <Th>Reference</Th>
              <Th className="text-right">Amount</Th>
            </THead>
            <tbody>
              {data.payments.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.customer_name}</Td>
                  <Td>{p.reference_number ?? '—'}</Td>
                  <Td className="text-right">{formatMoney(p.amount, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="flex justify-end text-base font-semibold text-text">
            Total: {formatMoney(data.deposit.total, currencySymbol)}
          </div>
        </div>
      )}
    </Modal>
  )
}

export function ViewDepositsPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const { data: deposits, isLoading } = useDeposits(orgId)
  const [viewingId, setViewingId] = useState<string | null>(null)

  return (
    <div>
      <PageHeader
        title="View deposits"
        subtitle="Payments that have been deposited into a bank account"
        action={
          <Button onClick={() => navigate('/account/record-deposit')}>
            <Plus size={16} />
            Record deposit
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
              <Th>Deposit #</Th>
              <Th>Deposited to</Th>
              <Th>Memo</Th>
              <Th className="text-right">Total</Th>
            </THead>
            <tbody>
              {(!deposits || deposits.length === 0) && <EmptyState message="No deposits yet." />}
              {deposits?.map((d) => (
                <Tr key={d.id} onClick={() => setViewingId(d.id)}>
                  <Td>{d.deposit_date}</Td>
                  <Td className="font-medium">{d.deposit_number}</Td>
                  <Td>{d.account_name}</Td>
                  <Td>{d.memo ?? '—'}</Td>
                  <Td className="text-right">{formatMoney(d.total, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {viewingId && <DepositDetailModal orgId={orgId} depositId={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  )
}

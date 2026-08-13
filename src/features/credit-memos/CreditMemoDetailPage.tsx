import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useCreditMemo, useVoidCreditMemo } from './api'

export function CreditMemoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, role, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useCreditMemo(orgId, id!)
  const voidCreditMemo = useVoidCreditMemo(orgId, id!)

  const [confirmingVoid, setConfirmingVoid] = useState(false)

  if (isLoading || !data) return <PageSpinner />

  const { creditMemo, lines } = data
  const canVoid = role !== 'staff' && creditMemo.status !== 'void'

  async function handleVoid() {
    try {
      await voidCreditMemo.mutateAsync()
      toast.success('Credit memo voided')
      setConfirmingVoid(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title={creditMemo.credit_memo_number}
        subtitle={creditMemo.customers?.name ?? 'Unknown customer'}
        action={
          <button
            type="button"
            onClick={() => navigate('/credit-memos')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={creditMemo.status === 'void' ? 'neutral' : 'warning'}>
          {creditMemo.status === 'void' ? 'Void' : 'Open'}
        </Badge>
        <span className="text-sm text-text-muted">Issued {creditMemo.issue_date}</span>
      </div>

      <Card>
        <CardHeader title="Returned items" />
        <CardBody className="p-0">
          <Table>
            <THead>
              <Th>Item</Th>
              <Th>Location</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Unit price</Th>
              <Th className="text-right">Line total</Th>
            </THead>
            <tbody>
              {lines.map((line) => (
                <Tr key={line.id}>
                  <Td className="font-medium">
                    {line.item_name} ({line.item_sku})
                  </Td>
                  <Td>{line.location_name}</Td>
                  <Td className="text-right">{line.quantity}</Td>
                  <Td className="text-right">{formatMoney(line.unit_price, currencySymbol)}</Td>
                  <Td className="text-right">{formatMoney(line.line_total, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mt-4 flex justify-end">
        <div className="w-64 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex justify-between text-base font-semibold text-text">
            <span>Total credit</span>
            <span>{formatMoney(creditMemo.total, currencySymbol)}</span>
          </div>
        </div>
      </div>

      {creditMemo.notes && <p className="mt-4 text-sm text-text-muted">{creditMemo.notes}</p>}

      {canVoid && (
        <div className="mt-6 flex items-center justify-end gap-3">
          {confirmingVoid ? (
            <>
              <span className="text-sm text-text-muted">Void this credit memo and reverse stock?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingVoid(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleVoid} disabled={voidCreditMemo.isPending}>
                {voidCreditMemo.isPending ? 'Voiding…' : 'Confirm void'}
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmingVoid(true)}>
              Void credit memo
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

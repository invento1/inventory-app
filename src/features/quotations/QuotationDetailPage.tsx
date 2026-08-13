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
import { useQuotation, useVoidQuotation } from './api'

export function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, role, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useQuotation(orgId, id!)
  const voidQuotation = useVoidQuotation(orgId, id!)

  const [confirmingVoid, setConfirmingVoid] = useState(false)

  if (isLoading || !data) return <PageSpinner />

  const { quotation, lines } = data
  const canVoid = role !== 'staff' && quotation.status !== 'void'

  async function handleVoid() {
    try {
      await voidQuotation.mutateAsync()
      toast.success('Quotation voided')
      setConfirmingVoid(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title={quotation.quotation_number}
        subtitle={quotation.customers?.name ?? 'Walk-in / unspecified'}
        action={
          <button
            type="button"
            onClick={() => navigate('/quotations')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={quotation.status === 'void' ? 'neutral' : 'accent'}>
          {quotation.status === 'void' ? 'Void' : 'Open'}
        </Badge>
        <span className="text-sm text-text-muted">Issued {quotation.issue_date}</span>
        {quotation.expiry_date && <span className="text-sm text-text-muted">Expires {quotation.expiry_date}</span>}
      </div>

      <Card>
        <CardHeader title="Items" />
        <CardBody className="p-0">
          <Table>
            <THead>
              <Th>Item</Th>
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
            <span>Total</span>
            <span>{formatMoney(quotation.total, currencySymbol)}</span>
          </div>
        </div>
      </div>

      {quotation.notes && <p className="mt-4 text-sm text-text-muted">{quotation.notes}</p>}

      {canVoid && (
        <div className="mt-6 flex items-center justify-end gap-3">
          {confirmingVoid ? (
            <>
              <span className="text-sm text-text-muted">Void this quotation?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingVoid(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleVoid} disabled={voidQuotation.isPending}>
                {voidQuotation.isPending ? 'Voiding…' : 'Confirm void'}
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmingVoid(true)}>
              Void quotation
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

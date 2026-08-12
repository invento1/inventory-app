import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { useInvoice, useVoidInvoice, invoiceStatusTone } from './api'
import { RecordPaymentModal } from './RecordPaymentModal'

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, role } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useInvoice(orgId, id!)
  const voidInvoice = useVoidInvoice(orgId, id!)

  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [confirmingVoid, setConfirmingVoid] = useState(false)

  if (isLoading || !data) return <PageSpinner />

  const { invoice, lines, payments } = data
  const balance = invoice.total - invoice.amount_paid
  const { tone, label } = invoiceStatusTone(invoice)

  const canRecordPayment = invoice.status !== 'paid' && invoice.status !== 'void'
  const canVoid = role !== 'staff' && invoice.amount_paid === 0 && invoice.status !== 'void'

  async function handleVoid() {
    try {
      await voidInvoice.mutateAsync()
      toast.success('Invoice voided')
      setConfirmingVoid(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title={invoice.invoice_number}
        subtitle={invoice.customers?.name ?? 'Unknown customer'}
        action={
          <button
            type="button"
            onClick={() => navigate('/invoices')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={tone}>{label}</Badge>
        <span className="text-sm text-text-muted">Issued {invoice.issue_date}</span>
        <span className="text-sm text-text-muted">Due {invoice.due_date}</span>
      </div>

      <Card>
        <CardHeader title="Items" />
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
                  <Td className="text-right">${line.unit_price.toFixed(2)}</Td>
                  <Td className="text-right">${line.line_total.toFixed(2)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mt-4 flex justify-end">
        <div className="w-64 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex justify-between text-sm text-text-muted">
            <span>Subtotal</span>
            <span>${invoice.subtotal.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-semibold text-text">
            <span>Total</span>
            <span>${invoice.total.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between text-sm text-text-muted">
            <span>Paid</span>
            <span>${invoice.amount_paid.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-semibold text-text">
            <span>Balance</span>
            <span>${balance.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Payment history"
            action={
              canRecordPayment ? (
                <Button size="sm" onClick={() => setShowPaymentModal(true)}>
                  Record payment
                </Button>
              ) : undefined
            }
          />
          <CardBody className="p-0">
            <Table>
              <THead>
                <Th>Date</Th>
                <Th>Method</Th>
                <Th className="text-right">Amount</Th>
                <Th>Notes</Th>
              </THead>
              <tbody>
                {payments.length === 0 && <EmptyState message="No payments recorded yet." />}
                {payments.map((p) => (
                  <Tr key={p.id}>
                    <Td>{new Date(p.paid_at).toLocaleDateString()}</Td>
                    <Td>
                      <Badge tone="neutral">{p.payment_method.replace('_', ' ')}</Badge>
                    </Td>
                    <Td className="text-right">${p.amount.toFixed(2)}</Td>
                    <Td>{p.notes ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      {canVoid && (
        <div className="mt-6 flex items-center justify-end gap-3">
          {confirmingVoid ? (
            <>
              <span className="text-sm text-text-muted">Void this invoice and restore stock?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingVoid(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleVoid} disabled={voidInvoice.isPending}>
                {voidInvoice.isPending ? 'Voiding…' : 'Confirm void'}
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmingVoid(true)}>
              Void invoice
            </Button>
          )}
        </div>
      )}

      {showPaymentModal && (
        <RecordPaymentModal
          orgId={orgId}
          invoiceId={invoice.id}
          balance={balance}
          onClose={() => setShowPaymentModal(false)}
        />
      )}
    </div>
  )
}

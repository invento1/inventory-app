import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useInvoice, useVoidInvoice, invoiceStatusTone, historyOptionsOf } from './api'
import { InvoiceHistoryCard } from './CustomerHistory'
import { useSourceQuotation } from '../quotations/api'
import { RecordPaymentModal } from './RecordPaymentModal'
import {
  ApplyCreditModal,
  useCreditApplications,
  useOpenCredits,
  useRemoveCreditApplication,
} from '../credit-memos/applications'

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useInvoice(orgId, id!)
  const voidInvoice = useVoidInvoice(orgId, id!)

  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [confirmingVoid, setConfirmingVoid] = useState(false)
  const [applyingCredit, setApplyingCredit] = useState(false)
  const { data: credits } = useCreditApplications(orgId, { invoiceId: id })
  const { data: openCredits } = useOpenCredits(orgId, data?.invoice.customer_id)
  const removeCredit = useRemoveCreditApplication(orgId)
  const { data: sourceQuotation } = useSourceQuotation(orgId, { invoiceId: id })

  if (isLoading || !data) return <PageSpinner />

  const { invoice, lines, payments, salesOrder } = data
  const balance = invoice.total - invoice.amount_paid - invoice.amount_credited
  const hasLineDiscounts = lines.some((l) => l.discount > 0)
  const { tone, label } = invoiceStatusTone(invoice)

  const canRecordPayment =
    can('customer_payments.receive') && invoice.status !== 'paid' && invoice.status !== 'void'
  const canVoid = can('invoices.void') && invoice.amount_paid === 0 && invoice.status !== 'void'
  const isOpen = invoice.status === 'unpaid' || invoice.status === 'partially_paid'
  const canApplyCredit = can('customer_payments.receive') && isOpen && (openCredits?.length ?? 0) > 0
  const canReturn = can('credit_memos.create') && invoice.status !== 'void'

  async function handleRemoveCredit(applicationId: string) {
    try {
      await removeCredit.mutateAsync(applicationId)
      toast.success('Credit removed from this invoice')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

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
          <div className="flex items-center gap-3">
            {canReturn && (
              <Button variant="secondary" size="sm" onClick={() => navigate(`/credit-memos/new?invoice=${invoice.id}`)}>
                Return items
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => navigate(`/invoices/${invoice.id}/print`)}>
              <Printer size={14} />
              Print
            </Button>
            <button
              type="button"
              onClick={() => navigate('/invoices')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={tone}>{label}</Badge>
        <span className="text-sm text-text-muted">Issued {invoice.issue_date}</span>
        <span className="text-sm text-text-muted">Due {invoice.due_date}</span>
        {invoice.sales_reps && <span className="text-sm text-text-muted">Rep: {invoice.sales_reps.name}</span>}
        {sourceQuotation && (
          <span className="text-sm text-text-muted">
            From quotation{' '}
            <Link to={`/quotations/${sourceQuotation.id}`} className="font-medium text-accent-700 hover:underline">
              {sourceQuotation.quotation_number}
            </Link>
          </span>
        )}
        {salesOrder && (
          <span className="text-sm text-text-muted">
            From sales order{' '}
            <Link to={`/sales-orders/${salesOrder.id}`} className="font-medium text-accent-700 hover:underline">
              {salesOrder.order_number}
            </Link>
          </span>
        )}
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
              {hasLineDiscounts && <Th className="text-right">Discount</Th>}
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
                  {hasLineDiscounts && (
                    <Td className="text-right">{line.discount > 0 ? formatMoney(line.discount, currencySymbol) : '—'}</Td>
                  )}
                  <Td className="text-right">{formatMoney(line.line_total, currencySymbol)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mt-4 flex justify-end">
        <div className="w-64 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex justify-between text-sm text-text-muted">
            <span>Subtotal</span>
            <span>{formatMoney(invoice.subtotal, currencySymbol)}</span>
          </div>
          {invoice.discount > 0 && (
            <div className="mt-1 flex justify-between text-sm text-text-muted">
              <span>Discount</span>
              <span>− {formatMoney(invoice.discount, currencySymbol)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-base font-semibold text-text">
            <span>Total</span>
            <span>{formatMoney(invoice.total, currencySymbol)}</span>
          </div>
          <div className="mt-1 flex justify-between text-sm text-text-muted">
            <span>Paid</span>
            <span>{formatMoney(invoice.amount_paid, currencySymbol)}</span>
          </div>
          {invoice.amount_credited > 0 && (
            <div className="mt-1 flex justify-between text-sm text-text-muted">
              <span>Credits applied</span>
              <span>{formatMoney(invoice.amount_credited, currencySymbol)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-base font-semibold text-text">
            <span>Balance</span>
            <span>{formatMoney(balance, currencySymbol)}</span>
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
                    <Td className="text-right">{formatMoney(p.amount, currencySymbol)}</Td>
                    <Td>{p.notes ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      {((credits?.length ?? 0) > 0 || canApplyCredit) && (
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Credits applied"
              action={
                canApplyCredit ? (
                  <Button size="sm" variant="secondary" onClick={() => setApplyingCredit(true)}>
                    Apply credit
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="p-0">
              <Table>
                <THead>
                  <Th>Credit memo</Th>
                  <Th>Applied</Th>
                  <Th className="text-right">Amount</Th>
                  <Th />
                </THead>
                <tbody>
                  {(credits?.length ?? 0) === 0 && (
                    <EmptyState message="This customer has unused credit. Apply it to settle part of this invoice." />
                  )}
                  {credits?.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <Link to={`/credit-memos/${c.credit_memo_id}`} className="font-medium text-accent-700 hover:underline">
                          {c.credit_memo_number}
                        </Link>
                      </Td>
                      <Td>{c.applied_date ?? '—'}</Td>
                      <Td className="text-right">{formatMoney(c.amount, currencySymbol)}</Td>
                      <Td className="text-right">
                        {can('customer_payments.receive') && invoice.status !== 'void' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveCredit(c.id)}
                            disabled={removeCredit.isPending}
                          >
                            Remove
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <InvoiceHistoryCard
          invoiceId={invoice.id}
          options={historyOptionsOf(invoice)}
          canEdit={can('invoices.create')}
        />
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

      {applyingCredit && openCredits && (
        <ApplyCreditModal
          orgId={orgId}
          title={`Apply credit to ${invoice.invoice_number}`}
          fixedSide={{ invoiceId: invoice.id }}
          fixedAvailable={balance}
          choiceLabel="Credit memo"
          choices={openCredits.map((c) => ({ id: c.id, label: `${c.credit_memo_number} · ${c.issue_date}`, available: c.remaining }))}
          currencySymbol={currencySymbol}
          onClose={() => setApplyingCredit(false)}
        />
      )}

      {showPaymentModal && (
        <RecordPaymentModal
          orgId={orgId}
          invoiceId={invoice.id}
          balance={balance}
          currencySymbol={currencySymbol}
          onClose={() => setShowPaymentModal(false)}
        />
      )}
    </div>
  )
}

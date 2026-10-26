import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useCreditMemo, useVoidCreditMemo, creditMemoStatus } from './api'
import { useOutstandingInvoicesForCustomer } from '../accounts/api'
import { ApplyCreditModal, useCreditApplications, useRemoveCreditApplication } from './applications'

export function CreditMemoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useCreditMemo(orgId, id!)
  const voidCreditMemo = useVoidCreditMemo(orgId, id!)

  const [confirmingVoid, setConfirmingVoid] = useState(false)
  const [applying, setApplying] = useState(false)
  const { data: applications } = useCreditApplications(orgId, { creditMemoId: id })
  const { data: openInvoices } = useOutstandingInvoicesForCustomer(orgId, data?.creditMemo.customer_id ?? '')
  const removeCredit = useRemoveCreditApplication(orgId)

  if (isLoading || !data) return <PageSpinner />

  const { creditMemo, lines } = data
  const canVoid = can('credit_memos.void') && creditMemo.status !== 'void'
  const remaining = creditMemo.total - creditMemo.amount_applied
  const status = creditMemoStatus(creditMemo)
  const canApply =
    can('customer_payments.receive') && creditMemo.status !== 'void' && remaining > 0 && (openInvoices?.length ?? 0) > 0

  async function handleRemove(applicationId: string) {
    try {
      await removeCredit.mutateAsync(applicationId)
      toast.success('Credit taken off the invoice')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

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
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="text-sm text-text-muted">Issued {creditMemo.issue_date}</span>
        {creditMemo.invoice_id && (
          <span className="text-sm text-text-muted">
            Return against{' '}
            <Link to={`/invoices/${creditMemo.invoice_id}`} className="font-medium text-accent-700 hover:underline">
              {creditMemo.invoices?.invoice_number ?? 'invoice'}
            </Link>
          </span>
        )}
        {creditMemo.sales_reps && <span className="text-sm text-text-muted">Rep: {creditMemo.sales_reps.name}</span>}
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
        <div className="w-64 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex justify-between text-base font-semibold text-text">
            <span>Total credit</span>
            <span>{formatMoney(creditMemo.total, currencySymbol)}</span>
          </div>
          {creditMemo.status !== 'void' && (
            <>
              <div className="mt-1 flex justify-between text-sm text-text-muted">
                <span>Applied to invoices</span>
                <span>{formatMoney(creditMemo.amount_applied, currencySymbol)}</span>
              </div>
              <div className="mt-1 flex justify-between text-base font-semibold text-text">
                <span>Credit left</span>
                <span>{formatMoney(remaining, currencySymbol)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {creditMemo.status !== 'void' && (
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Applied to invoices"
              action={
                canApply ? (
                  <Button size="sm" variant="secondary" onClick={() => setApplying(true)}>
                    Apply to invoice
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="p-0">
              <Table>
                <THead>
                  <Th>Invoice</Th>
                  <Th>Applied</Th>
                  <Th className="text-right">Amount</Th>
                  <Th />
                </THead>
                <tbody>
                  {(applications?.length ?? 0) === 0 && (
                    <EmptyState
                      message={
                        (openInvoices?.length ?? 0) > 0
                          ? "Not applied yet. Apply it to one of the customer's open invoices."
                          : 'Not applied yet. The customer has no open invoices.'
                      }
                    />
                  )}
                  {applications?.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <Link to={`/invoices/${a.invoice_id}`} className="font-medium text-accent-700 hover:underline">
                          {a.invoice_number}
                        </Link>
                      </Td>
                      <Td>{a.applied_date ?? '—'}</Td>
                      <Td className="text-right">{formatMoney(a.amount, currencySymbol)}</Td>
                      <Td className="text-right">
                        {can('customer_payments.receive') && (
                          <Button size="sm" variant="ghost" onClick={() => handleRemove(a.id)} disabled={removeCredit.isPending}>
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

      {creditMemo.notes && <p className="mt-4 text-sm text-text-muted">{creditMemo.notes}</p>}

      {canVoid && (
        <div className="mt-6 flex items-center justify-end gap-3">
          {confirmingVoid ? (
            <>
              <span className="text-sm text-text-muted">
                {creditMemo.amount_applied > 0
                  ? 'Void this credit memo, reverse stock and take its credit off the invoices?'
                  : 'Void this credit memo and reverse stock?'}
              </span>
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

      {applying && openInvoices && (
        <ApplyCreditModal
          orgId={orgId}
          title={`Apply ${creditMemo.credit_memo_number} to an invoice`}
          fixedSide={{ creditMemoId: creditMemo.id }}
          fixedAvailable={remaining}
          choiceLabel="Invoice"
          choices={openInvoices.map((i) => ({ id: i.id, label: `${i.invoice_number} · due ${i.due_date}`, available: i.balance }))}
          currencySymbol={currencySymbol}
          onClose={() => setApplying(false)}
        />
      )}
    </div>
  )
}

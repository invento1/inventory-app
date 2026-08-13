import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
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
import { useSupplierBill, useVoidSupplierBill, billStatusTone } from './api'
import { RecordBillPaymentModal } from './RecordBillPaymentModal'

export function SupplierBillDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId, role, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useSupplierBill(orgId, id!)
  const voidBill = useVoidSupplierBill(orgId, id!)

  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [confirmingVoid, setConfirmingVoid] = useState(false)

  if (isLoading || !data) return <PageSpinner />

  const { bill, lines, payments } = data
  const balance = bill.total - bill.amount_paid
  const { tone, label } = billStatusTone(bill)

  const canRecordPayment = bill.status !== 'paid' && bill.status !== 'void'
  const canVoid = role !== 'staff' && bill.amount_paid === 0 && bill.status !== 'void'

  async function handleVoid() {
    try {
      await voidBill.mutateAsync()
      toast.success('Bill voided')
      setConfirmingVoid(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title={bill.bill_number}
        subtitle={bill.suppliers?.name ?? 'Unknown supplier'}
        action={
          <button
            type="button"
            onClick={() => navigate('/supplier-bills')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={tone}>{label}</Badge>
        <span className="text-sm text-text-muted">Issued {bill.issue_date}</span>
        <span className="text-sm text-text-muted">Due {bill.due_date}</span>
        {bill.purchase_order_id && (
          <Link
            to={`/purchase-orders/${bill.purchase_order_id}`}
            className="text-sm font-medium text-accent-600 hover:underline"
          >
            ← From purchase order
          </Link>
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
              <Th className="text-right">Unit cost</Th>
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
                  <Td className="text-right">{formatMoney(line.unit_cost, currencySymbol)}</Td>
                  <Td className="text-right">{formatMoney(line.line_total, currencySymbol)}</Td>
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
            <span>{formatMoney(bill.subtotal, currencySymbol)}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-semibold text-text">
            <span>Total</span>
            <span>{formatMoney(bill.total, currencySymbol)}</span>
          </div>
          <div className="mt-1 flex justify-between text-sm text-text-muted">
            <span>Paid</span>
            <span>{formatMoney(bill.amount_paid, currencySymbol)}</span>
          </div>
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

      {canVoid && (
        <div className="mt-6 flex items-center justify-end gap-3">
          {confirmingVoid ? (
            <>
              <span className="text-sm text-text-muted">Void this bill and reverse stock?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingVoid(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleVoid} disabled={voidBill.isPending}>
                {voidBill.isPending ? 'Voiding…' : 'Confirm void'}
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmingVoid(true)}>
              Void bill
            </Button>
          )}
        </div>
      )}

      {showPaymentModal && (
        <RecordBillPaymentModal
          orgId={orgId}
          billId={bill.id}
          balance={balance}
          currencySymbol={currencySymbol}
          onClose={() => setShowPaymentModal(false)}
        />
      )}
    </div>
  )
}

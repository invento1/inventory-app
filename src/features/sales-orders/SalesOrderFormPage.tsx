import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Autocomplete } from '../../components/ui/Autocomplete'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useCustomers } from '../customers/api'
import { CustomerForm } from '../customers/CustomerForm'
import { useItems, type Item } from '../items/api'
import { SalesRepSelect } from '../sales-reps/SalesRepSelect'
import {
  DocumentDiscountField,
  NO_DOCUMENT_DISCOUNT,
  documentDiscountAmount,
  documentDiscountError,
  lineDiscountAmount,
  lineDiscountError,
  type DocumentDiscount,
} from '../sales/discounts'
import {
  useCreateSalesOrder,
  useSalesOrder,
  useUpdateSalesOrder,
  type SalesOrderLinePayload,
} from './api'

interface DraftLine {
  key: number
  item_id: string
  quantity: string
  unit_price: string
  discount: string
}

let nextKey = 1
const blankLine = (): DraftLine => ({ key: nextKey++, item_id: '', quantity: '', unit_price: '', discount: '' })

const itemKey = (i: Item) => i.id
const itemLabel = (i: Item) => `${i.name} (${i.sku})`
const itemSearchText = (i: Item) => `${i.name} ${i.sku} ${i.barcode ?? ''}`

// New sales order (/sales-orders/new) and editing an open one (/sales-orders/:id/edit).
export function SalesOrderFormPage() {
  const { id } = useParams<{ id: string }>()
  const editing = !!id
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: customers } = useCustomers(orgId)
  const { data: items } = useItems(orgId)
  const { data: existing, isLoading } = useSalesOrder(orgId, id)
  const createOrder = useCreateSalesOrder(orgId)
  const updateOrder = useUpdateSalesOrder(orgId, id ?? '')

  const [customerId, setCustomerId] = useState('')
  const [salesRepId, setSalesRepId] = useState<string | null>(null)
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [docDiscount, setDocDiscount] = useState<DocumentDiscount>(NO_DOCUMENT_DISCOUNT)
  const [error, setError] = useState<string | null>(null)
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [loadedId, setLoadedId] = useState<string | null>(null)

  // Editing: load the order into the form once.
  useEffect(() => {
    if (!existing || loadedId === existing.order.id) return
    const o = existing.order
    setCustomerId(o.customer_id)
    setSalesRepId(o.sales_rep_id)
    setDeliveryDate(o.delivery_date ?? '')
    setNotes(o.notes ?? '')
    setLines(
      existing.lines.map((l) => ({
        key: nextKey++,
        item_id: l.item_id,
        quantity: String(l.quantity),
        unit_price: String(l.unit_price),
        discount: l.discount ? String(l.discount) : '',
      })),
    )
    setDocDiscount(o.discount ? { mode: 'amount', value: String(o.discount) } : NO_DOCUMENT_DISCOUNT)
    setLoadedId(o.id)
  }, [existing, loadedId])

  type Customer = NonNullable<typeof customers>[number]
  const customerKey = useCallback((c: Customer) => c.id, [])
  const customerLabel = useCallback((c: Customer) => c.name, [])

  function chooseCustomer(customer: string) {
    setCustomerId(customer)
    setSalesRepId(customers?.find((c) => c.id === customer)?.sales_rep_id ?? null)
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function selectItem(key: number, itemId: string) {
    const item = items?.find((i) => i.id === itemId)
    setLines((current) =>
      current.map((l) =>
        l.key === key
          ? { ...l, item_id: itemId, unit_price: item ? String(item.unit_price) : '', quantity: l.quantity || (item ? '1' : '') }
          : l,
      ),
    )
  }

  const lineGross = (l: DraftLine) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)
  const lineNet = (l: DraftLine) => {
    const discount = lineDiscountAmount(l.discount, lineGross(l))
    return lineGross(l) - (Number.isNaN(discount) ? 0 : discount)
  }
  const subtotal = lines.reduce((sum, l) => (l.item_id ? sum + lineNet(l) : sum), 0)
  const docDiscountAmount = documentDiscountAmount(docDiscount, subtotal)
  const total = subtotal - docDiscountAmount

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Choose a customer.')
      return
    }

    const validLines: SalesOrderLinePayload[] = []
    for (const line of lines) {
      if (!line.item_id) continue
      const qty = Number(line.quantity)
      if (!qty || qty <= 0) {
        setError('Every line needs a quantity greater than zero.')
        return
      }
      const unitPrice = Number(line.unit_price)
      if (line.unit_price === '' || unitPrice < 0) {
        setError('Every line needs a unit price.')
        return
      }
      const problem = lineDiscountError(line.discount, qty * unitPrice)
      if (problem) {
        setError(problem)
        return
      }
      validLines.push({
        item_id: line.item_id,
        quantity: qty,
        unit_price: unitPrice,
        discount: lineDiscountAmount(line.discount, qty * unitPrice),
      })
    }
    if (validLines.length === 0) {
      setError('Add at least one item line.')
      return
    }
    const docProblem = documentDiscountError(docDiscount, subtotal)
    if (docProblem) {
      setError(docProblem)
      return
    }

    const input = {
      customerId,
      salesRepId,
      deliveryDate: deliveryDate || null,
      lines: validLines,
      discount: docDiscountAmount,
      notes: notes || null,
    }
    try {
      const order = editing ? await updateOrder.mutateAsync(input) : await createOrder.mutateAsync(input)
      toast.success(editing ? 'Sales order updated' : 'Sales order created')
      navigate(`/sales-orders/${order.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (editing && (isLoading || !existing)) return <PageSpinner />
  if (editing && existing && existing.order.status !== 'open') {
    return (
      <div>
        <PageHeader title={`Edit ${existing.order.order_number}`} />
        <p className="text-sm text-text-muted">Only an open sales order can be edited. This one is {existing.order.status}.</p>
      </div>
    )
  }

  const saving = createOrder.isPending || updateOrder.isPending
  const backTo = editing ? `/sales-orders/${id}` : '/sales-orders'

  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${existing?.order.order_number ?? 'sales order'}` : 'New sales order'}
        action={
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Autocomplete
                    label="Customer"
                    required
                    items={customers ?? []}
                    getKey={customerKey}
                    getLabel={customerLabel}
                    getDescription={(c) => c.phone ?? c.email ?? undefined}
                    getSearchText={customerLabel}
                    value={customerId}
                    onChange={chooseCustomer}
                    placeholder="Type to search customers…"
                    emptyText="No customers match"
                  />
                </div>
                {can('customers.create') && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mb-1"
                    aria-label="Add customer"
                    onClick={() => setAddingCustomer(true)}
                  >
                    <Plus size={14} />
                  </Button>
                )}
              </div>
              <SalesRepSelect value={salesRepId} onChange={setSalesRepId} />
              <Input
                label="Delivery date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
              <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <div className="flex min-w-[720px] flex-col gap-3">
                {lines.map((line) => (
                  <div key={line.key} className="grid grid-cols-12 items-end gap-3">
                    <div className="col-span-5">
                      <Autocomplete
                        label="Item"
                        items={items ?? []}
                        getKey={itemKey}
                        getLabel={itemLabel}
                        getDescription={(i) => i.barcode ?? undefined}
                        getSearchText={itemSearchText}
                        value={line.item_id}
                        onChange={(itemId) => selectItem(line.key, itemId)}
                        placeholder="Search name, SKU, barcode…"
                        emptyText="No items match"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        label="Quantity"
                        type="number"
                        min="0"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        label="Unit price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unit_price}
                        onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        label="Discount"
                        placeholder="0 or 5%"
                        title="An amount off this line (e.g. 250) or a percentage (e.g. 5%)"
                        value={line.discount}
                        error={line.discount && lineDiscountError(line.discount, lineGross(line)) ? ' ' : undefined}
                        onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                      />
                      {line.item_id && (
                        <p className="mt-1 text-right text-xs tabular-nums text-text-muted">
                          {formatMoney(lineNet(line), currencySymbol)}
                        </p>
                      )}
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => setLines((current) => [...current, blankLine()])}
            >
              <Plus size={16} />
              Add line
            </Button>
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Card className="w-full sm:w-80">
            <CardHeader title="Summary" />
            <CardBody>
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">Subtotal</dt>
                  <dd className="tabular-nums text-text">{formatMoney(subtotal, currencySymbol)}</dd>
                </div>
                <div className="my-1">
                  <DocumentDiscountField label="Order discount" value={docDiscount} onChange={setDocDiscount} />
                  {documentDiscountError(docDiscount, subtotal) && (
                    <p className="mt-1 text-xs text-danger-600">{documentDiscountError(docDiscount, subtotal)}</p>
                  )}
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                  <dt className="text-text">Total</dt>
                  <dd className="tabular-nums text-text">{formatMoney(total, currencySymbol)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(backTo)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create sales order'}
          </Button>
        </div>
      </form>

      {addingCustomer && (
        <CustomerForm
          orgId={orgId}
          onClose={() => setAddingCustomer(false)}
          onCreated={(created) => {
            setCustomerId(created.id)
            setSalesRepId(created.sales_rep_id)
          }}
        />
      )}
    </div>
  )
}

import { useCallback, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, ScanLine, Trash2 } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Autocomplete, type AutocompleteHandle } from '../../components/ui/Autocomplete'
import { CameraScanner } from '../../components/ui/CameraScanner'
import { useToast } from '../../components/ui/Toast'
import { useCustomers } from '../customers/api'
import { CustomerForm } from '../customers/CustomerForm'
import { useItems, type Item } from '../items/api'
import { useStockLevels } from '../stock/api'
import { useLocations } from '../../lib/useLocations'
import { formatMoney } from '../../lib/currency'
import { primeBeep } from '../../lib/beep'
import { useCreateInvoice, type InvoiceLinePayload } from './api'
import { ymd } from '../../lib/dates'

interface DraftLine {
  key: number
  item_id: string
  location_id: string
  quantity: string
  unit_price: string
}

let nextKey = 1

function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return ymd(d)
}

// Autocomplete accessors (stable references, shared by the pickers below).
const itemKey = (i: Item) => i.id
const itemLabel = (i: Item) => `${i.name} (${i.sku})`
const itemSearchText = (i: Item) => `${i.name} ${i.sku} ${i.barcode ?? ''}`

export function NewInvoicePage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: customers } = useCustomers(orgId)
  const { data: items } = useItems(orgId)
  const { data: locations } = useLocations(orgId)
  const { data: stockLevels } = useStockLevels(orgId)
  const createInvoice = useCreateInvoice(orgId)

  const stockByKey = new Map((stockLevels ?? []).map((s) => [`${s.item_id}:${s.location_id}`, s.quantity]))
  const avgCostByItem = new Map((items ?? []).map((i) => [i.id, i.avg_cost]))
  const [addingCustomer, setAddingCustomer] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState(defaultDueDate())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([
    { key: nextKey++, item_id: '', location_id: '', quantity: '', unit_price: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  // Fast entry: scan or search to add items.
  const quickAddRef = useRef<AutocompleteHandle>(null)
  const [newLineLocationId, setNewLineLocationId] = useState('')
  const [lastAdded, setLastAdded] = useState<{ text: string; tone: 'ok' | 'miss' } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const defaultLocationId = newLineLocationId || locations?.[0]?.id || ''

  type Customer = NonNullable<typeof customers>[number]
  const customerKey = useCallback((c: Customer) => c.id, [])
  const customerLabel = useCallback((c: Customer) => c.name, [])

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { key: nextKey++, item_id: '', location_id: '', quantity: '', unit_price: '' },
    ])
  }

  function removeLine(key: number) {
    setLines((current) => current.filter((l) => l.key !== key))
  }

  function selectItem(key: number, itemId: string) {
    const item = items?.find((i) => i.id === itemId)
    setLines((current) =>
      current.map((l) =>
        l.key === key
          ? {
              ...l,
              item_id: itemId,
              unit_price: item ? String(item.unit_price) : '',
              // Picking an item on a fresh line also gives it the default location.
              location_id: l.location_id || (item ? defaultLocationId : ''),
              quantity: l.quantity || (item ? '1' : ''),
            }
          : l,
      ),
    )
  }

  // Exact barcode/SKU match (case-insensitive) -- what a scan resolves to.
  const findByCode = useCallback(
    (code: string) => {
      const c = code.trim().toLowerCase()
      if (!c) return undefined
      return (
        items?.find((i) => i.barcode?.trim().toLowerCase() === c) ??
        items?.find((i) => i.sku.trim().toLowerCase() === c)
      )
    },
    [items],
  )

  // Scanned/picked item: bump its quantity if it's already on the invoice,
  // otherwise fill the first empty line or append a new one with qty 1.
  function addItem(item: Item) {
    const existing = lines.find((l) => l.item_id === item.id)
    if (existing) {
      const qty = (Number(existing.quantity) || 0) + 1
      updateLine(existing.key, { quantity: String(qty) })
      setLastAdded({ text: `${item.name}: quantity now ${qty}`, tone: 'ok' })
    } else {
      const filled = {
        item_id: item.id,
        quantity: '1',
        unit_price: String(item.unit_price),
      }
      setLines((current) => {
        const blank = current.find((l) => !l.item_id)
        if (blank) {
          return current.map((l) =>
            l.key === blank.key ? { ...l, ...filled, location_id: l.location_id || defaultLocationId } : l,
          )
        }
        return [...current, { key: nextKey++, ...filled, location_id: defaultLocationId }]
      })
      setLastAdded({ text: `Added ${item.name}`, tone: 'ok' })
    }
    // Ready for the next scan.
    requestAnimationFrame(() => quickAddRef.current?.focus())
  }

  function noMatch(code: string) {
    setLastAdded({ text: `No item matches "${code}"`, tone: 'miss' })
    quickAddRef.current?.clear()
    quickAddRef.current?.focus()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Choose a customer.')
      return
    }
    if (!dueDate) {
      setError('Choose a due date.')
      return
    }

    const validLines: InvoiceLinePayload[] = []
    for (const line of lines) {
      if (!line.item_id) continue
      if (!line.location_id) {
        setError('Every line needs a location.')
        return
      }
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
      validLines.push({
        item_id: line.item_id,
        location_id: line.location_id,
        quantity: qty,
        unit_price: unitPrice,
      })
    }
    if (validLines.length === 0) {
      setError('Add at least one item line.')
      return
    }

    try {
      const invoice = await createInvoice.mutateAsync({
        customerId,
        dueDate,
        lines: validLines,
        notes: notes || null,
      })
      toast.success('Invoice created')
      navigate(`/invoices/${invoice.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New invoice"
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

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                    onChange={(id) => setCustomerId(id)}
                    placeholder="Type to search customers…"
                    emptyText="No customers match"
                  />
                </div>
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
              </div>
              <Input
                label="Due date"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-4">
            {/* Fast entry: scan (USB scanner or camera) or search to add items. */}
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted/60 p-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Autocomplete
                  ref={quickAddRef}
                  label="Scan or search to add items"
                  items={items ?? []}
                  getKey={itemKey}
                  getLabel={itemLabel}
                  getDescription={(i) =>
                    [i.barcode, formatMoney(i.unit_price, currencySymbol)].filter(Boolean).join(' · ')
                  }
                  getSearchText={itemSearchText}
                  clearOnPick
                  onPick={addItem}
                  resolveExact={findByCode}
                  onNoMatch={noMatch}
                  showSearchIcon
                  placeholder="Scan a barcode, or type a name / SKU…"
                  emptyText="No items match"
                />
              </div>
              <div className="w-full sm:w-48">
                <Select
                  label="Location for new lines"
                  value={defaultLocationId}
                  onChange={(e) => setNewLineLocationId(e.target.value)}
                >
                  {locations?.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  primeBeep()
                  setCameraOpen(true)
                }}
              >
                <ScanLine size={16} />
                Camera
              </Button>
            </div>
            {lastAdded && (
              <p
                className={`-mt-2 text-xs font-medium ${lastAdded.tone === 'ok' ? 'text-success-600' : 'text-warning-600'}`}
                role="status"
                aria-live="polite"
              >
                {lastAdded.text}
              </p>
            )}

            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto">
              <div className="flex min-w-[640px] flex-col gap-3">
              {lines.map((line) => {
                const onHand = line.item_id && line.location_id
                  ? (stockByKey.get(`${line.item_id}:${line.location_id}`) ?? 0)
                  : null
                const avgCost = line.item_id ? avgCostByItem.get(line.item_id) : undefined
                const priceTitle = avgCost != null
                  ? `Moving average cost: ${formatMoney(avgCost, currencySymbol)}`
                  : 'No cost data for this item'

                return (
                  <div key={line.key} className="grid grid-cols-12 items-end gap-3">
                    <div className="col-span-4">
                      <Autocomplete
                        label="Item"
                        items={items ?? []}
                        getKey={itemKey}
                        getLabel={itemLabel}
                        getDescription={(i) => i.barcode ?? undefined}
                        getSearchText={itemSearchText}
                        value={line.item_id}
                        onChange={(id) => selectItem(line.key, id)}
                        placeholder="Search name, SKU, barcode…"
                        emptyText="No items match"
                      />
                      {onHand !== null && (
                        <p className={`mt-1 text-xs ${onHand <= 0 ? 'text-danger-600' : 'text-text-muted'}`}>
                          On hand: {onHand}
                        </p>
                      )}
                    </div>
                    <div className="col-span-3">
                      <Select
                        label="Location"
                        value={line.location_id}
                        onChange={(e) => updateLine(line.key, { location_id: e.target.value })}
                      >
                        <option value="">Select a location…</option>
                        {locations?.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </Select>
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
                        title={priceTitle}
                        value={line.unit_price}
                        onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                )
              })}
              </div>
              </div>
              <Button type="button" variant="secondary" className="self-start" onClick={addLine}>
                <Plus size={16} />
                Add line
              </Button>
            </div>
          </CardBody>
        </Card>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/invoices')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createInvoice.isPending}>
            {createInvoice.isPending ? 'Creating…' : 'Create invoice'}
          </Button>
        </div>
      </form>

      {addingCustomer && (
        <CustomerForm
          orgId={orgId}
          onClose={() => setAddingCustomer(false)}
          onCreated={(created) => setCustomerId(created.id)}
        />
      )}

      {cameraOpen && (
        <CameraScanner
          title="Scan item barcode"
          onDetected={(code) => {
            setCameraOpen(false)
            const item = findByCode(code)
            if (item) addItem(item)
            else noMatch(code)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}

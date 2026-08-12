import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine, Search } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { useLocations } from '../../lib/useLocations'
import { useItems, type Item } from '../items/api'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { SalesReceiptCartLine } from './SalesReceiptCartLine'
import { CustomerPicker } from './CustomerPicker'
import { useBarcodeInput } from './useBarcodeInput'
import { useCreateSalesReceipt } from './api'
import type { CartLine } from './types'

export function NewSalesReceiptPage() {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: items } = useItems(orgId)
  const { data: locations } = useLocations(orgId)
  const createReceipt = useCreateSalesReceipt(orgId)

  const [defaultLocationId, setDefaultLocationId] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [searchTerm, setSearchTerm] = useState('')

  const activeLocationId = defaultLocationId || locations?.[0]?.id || ''

  const codeIndex = useMemo(() => {
    const map = new Map<string, Item>()
    for (const item of items ?? []) {
      if (item.barcode) map.set(item.barcode.trim().toLowerCase(), item)
      map.set(item.sku.trim().toLowerCase(), item)
    }
    return map
  }, [items])

  function addToCart(item: Item) {
    if (!activeLocationId) {
      toast.error('Choose a location first.')
      return
    }
    setCart((current) => {
      const existing = current.find(
        (l) => l.item_id === item.id && l.location_id === activeLocationId,
      )
      if (existing) {
        return current.map((l) =>
          l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l,
        )
      }
      return [
        ...current,
        {
          key: `${item.id}-${activeLocationId}-${Date.now()}`,
          item_id: item.id,
          item_name: item.name,
          item_sku: item.sku,
          location_id: activeLocationId,
          quantity: 1,
          unit_price: item.unit_price,
        },
      ]
    })
  }

  const barcodeInput = useBarcodeInput<Item>({
    lookup: (code) => codeIndex.get(code.trim().toLowerCase()),
    onMatch: (item) => addToCart(item),
    onNoMatch: (code) => toast.error(`No item matches "${code}"`),
  })

  const searchResults = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q || !items) return []
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q) ||
          i.barcode?.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [items, searchTerm])

  function updateLine(key: string, patch: Partial<CartLine>) {
    setCart((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: string) {
    setCart((current) => current.filter((l) => l.key !== key))
  }

  const subtotal = cart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)

  async function handleCompleteSale() {
    if (cart.length === 0) {
      toast.error('Add at least one item to the sale.')
      return
    }
    try {
      const receipt = await createReceipt.mutateAsync({
        customerId: customerId || null,
        paymentMethod,
        lines: cart.map((l) => ({
          item_id: l.item_id,
          location_id: l.location_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
      })
      toast.success(`Sale ${receipt.receipt_number} completed`)
      setCart([])
      navigate(`/sales/${receipt.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader title="New sale" subtitle="Scan or search to add items" />

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 flex flex-col gap-6">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                  <Select
                    label="Location"
                    value={activeLocationId}
                    onChange={(e) => setDefaultLocationId(e.target.value)}
                  >
                    {locations?.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-text">Scan or type barcode / SKU</span>
                    <div className="relative">
                      <ScanLine
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                      />
                      <input
                        ref={barcodeInput.inputRef}
                        value={barcodeInput.value}
                        onChange={(e) => barcodeInput.setValue(e.target.value)}
                        onKeyDown={barcodeInput.handleKeyDown}
                        placeholder="Scan a barcode…"
                        className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div className="relative">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-text">Or search by name</span>
                  <div className="relative">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                    />
                    <input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search items…"
                      className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                    />
                  </div>
                </label>
                {searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-white shadow-lg">
                    {searchResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          addToCart(item)
                          setSearchTerm('')
                          barcodeInput.focus()
                        }}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
                      >
                        <span>
                          <span className="font-medium text-text">{item.name}</span>
                          <span className="ml-2 text-text-muted">{item.sku}</span>
                        </span>
                        <span className="text-text-muted">${item.unit_price.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Cart" subtitle={`${cart.length} line item(s)`} />
            <CardBody>
              {cart.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">
                  Scan or search to add items to this sale.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {cart.map((line) => (
                    <SalesReceiptCartLine
                      key={line.key}
                      line={line}
                      locations={locations ?? []}
                      onChange={(patch) => updateLine(line.key, patch)}
                      onRemove={() => removeLine(line.key)}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="col-span-1">
          <Card>
            <CardHeader title="Complete sale" />
            <CardBody className="flex flex-col gap-4">
              <CustomerPicker value={customerId} onChange={setCustomerId} />
              <Select
                label="Payment method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </Select>

              <div className="border-t border-border pt-4">
                <div className="flex justify-between text-sm text-text-muted">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex justify-between text-base font-semibold text-text">
                  <span>Total</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
              </div>

              <Button
                onClick={handleCompleteSale}
                disabled={cart.length === 0 || createReceipt.isPending}
                className="w-full"
              >
                {createReceipt.isPending ? 'Completing…' : 'Complete sale'}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

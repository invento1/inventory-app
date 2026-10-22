import { Trash2 } from 'lucide-react'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { formatMoney } from '../../lib/currency'
import type { Location } from '../../lib/useLocations'
import type { CartLine } from './types'
import { lineDiscountAmount, lineDiscountError } from './discounts'

export function SalesReceiptCartLine({
  line,
  locations,
  onChange,
  onRemove,
  currencySymbol,
  onHand,
  avgCost,
}: {
  line: CartLine
  locations: Location[]
  onChange: (patch: Partial<CartLine>) => void
  onRemove: () => void
  currencySymbol: string
  onHand: number
  avgCost?: number
}) {
  const gross = line.quantity * line.unit_price
  const discount = lineDiscountAmount(line.discount, gross)
  const lineTotal = gross - (Number.isNaN(discount) ? 0 : discount)
  const discountProblem = line.discount ? lineDiscountError(line.discount, gross) : null
  const priceTitle = avgCost != null
    ? `Moving average cost: ${formatMoney(avgCost, currencySymbol)}`
    : 'No cost data for this item'

  return (
    <div className="grid grid-cols-12 items-center gap-3 py-2">
      <div className="col-span-3">
        <p className="text-sm font-medium text-text">{line.item_name}</p>
        <p className="text-xs text-text-muted">{line.item_sku}</p>
        <p className={`text-xs ${onHand <= 0 ? 'text-danger-600' : 'text-text-muted'}`}>On hand: {onHand}</p>
      </div>
      <div className="col-span-1">
        <Input
          type="number"
          min="1"
          step="1"
          aria-label="Quantity"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) })}
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          aria-label="Unit price"
          title={priceTitle}
          value={line.unit_price}
          onChange={(e) => onChange({ unit_price: Number(e.target.value) })}
        />
      </div>
      <div className="col-span-2">
        <Input
          aria-label="Discount"
          placeholder="Disc. 0 or 5%"
          title={discountProblem ?? 'An amount off this line (e.g. 250) or a percentage (e.g. 5%)'}
          value={line.discount}
          error={discountProblem ? ' ' : undefined}
          onChange={(e) => onChange({ discount: e.target.value })}
        />
      </div>
      <div className="col-span-2">
        <Select aria-label="Location" value={line.location_id} onChange={(e) => onChange({ location_id: e.target.value })}>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="col-span-1 text-right text-sm font-medium text-text">
        {formatMoney(lineTotal, currencySymbol)}
      </div>
      <div className="col-span-1 text-right">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove line">
          <Trash2 size={16} />
        </Button>
      </div>
    </div>
  )
}

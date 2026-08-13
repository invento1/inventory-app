import { Trash2 } from 'lucide-react'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { formatMoney } from '../../lib/currency'
import type { Location } from '../../lib/useLocations'
import type { ItemLastPurchasePrice } from '../items/api'
import type { CartLine } from './types'

export function SalesReceiptCartLine({
  line,
  locations,
  onChange,
  onRemove,
  currencySymbol,
  onHand,
  lastPurchasePrice,
}: {
  line: CartLine
  locations: Location[]
  onChange: (patch: Partial<CartLine>) => void
  onRemove: () => void
  currencySymbol: string
  onHand: number
  lastPurchasePrice?: ItemLastPurchasePrice
}) {
  const lineTotal = line.quantity * line.unit_price
  const priceTitle = lastPurchasePrice
    ? `Last purchase price: ${formatMoney(lastPurchasePrice.unit_cost, currencySymbol)}`
    : 'No purchase history for this item'

  return (
    <div className="grid grid-cols-12 items-center gap-3 py-2">
      <div className="col-span-4">
        <p className="text-sm font-medium text-text">{line.item_name}</p>
        <p className="text-xs text-text-muted">{line.item_sku}</p>
        <p className={`text-xs ${onHand <= 0 ? 'text-danger-600' : 'text-text-muted'}`}>On hand: {onHand}</p>
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          min="1"
          step="1"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) })}
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          title={priceTitle}
          value={line.unit_price}
          onChange={(e) => onChange({ unit_price: Number(e.target.value) })}
        />
      </div>
      <div className="col-span-2">
        <Select value={line.location_id} onChange={(e) => onChange({ location_id: e.target.value })}>
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
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 size={16} />
        </Button>
      </div>
    </div>
  )
}

import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'

// Discounts on sales documents (invoices, sales receipts, sales orders).
// What's stored is always an amount: a line's discount (line_total =
// qty x price - discount) and the document's (total = subtotal - discount).
// The forms let people type either form, as in the old HashirHub.

// A line discount as typed: "" (none), "5%" (of the line's quantity x price)
// or "250" (an amount off the line). Returns NaN for anything else.
export function lineDiscountAmount(input: string, gross: number): number {
  const text = input.trim()
  if (!text) return 0
  if (text.endsWith('%')) {
    const pct = Number(text.slice(0, -1).trim())
    return Number.isFinite(pct) ? round2((gross * pct) / 100) : NaN
  }
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : NaN
}

// Why a typed line discount can't be used, or null if it's fine.
export function lineDiscountError(input: string, gross: number): string | null {
  const amount = lineDiscountAmount(input, gross)
  if (Number.isNaN(amount)) return 'Discount must be an amount (e.g. 250) or a percentage (e.g. 5%).'
  if (amount < 0) return "A discount can't be negative."
  if (amount > gross + 0.005) return "A line's discount can't be more than the line."
  return null
}

export type DocumentDiscountMode = 'percent' | 'amount'

export interface DocumentDiscount {
  mode: DocumentDiscountMode
  value: string
}

export const NO_DOCUMENT_DISCOUNT: DocumentDiscount = { mode: 'percent', value: '' }

export function documentDiscountAmount(discount: DocumentDiscount, subtotal: number): number {
  const n = Number(discount.value)
  if (!discount.value.trim() || !Number.isFinite(n)) return 0
  return discount.mode === 'percent' ? round2((subtotal * n) / 100) : n
}

export function documentDiscountError(discount: DocumentDiscount, subtotal: number): string | null {
  if (!discount.value.trim()) return null
  const n = Number(discount.value)
  if (!Number.isFinite(n) || n < 0) return 'The discount must be a positive number.'
  if (discount.mode === 'percent' && n > 100) return "A discount can't be more than 100%."
  if (documentDiscountAmount(discount, subtotal) > subtotal + 0.005) return "The discount can't be more than the subtotal."
  return null
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// "% / Amount" picker plus the value, for the whole document.
export function DocumentDiscountField({
  value,
  onChange,
  label = 'Discount',
}: {
  value: DocumentDiscount
  onChange: (value: DocumentDiscount) => void
  label?: string
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="w-28 shrink-0">
        <Select
          label={label}
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as DocumentDiscountMode })}
        >
          <option value="percent">Percent</option>
          <option value="amount">Amount</option>
        </Select>
      </div>
      <div className="min-w-0 flex-1">
        <Input
          aria-label={value.mode === 'percent' ? 'Discount percent' : 'Discount amount'}
          type="number"
          min="0"
          step="0.01"
          max={value.mode === 'percent' ? '100' : undefined}
          placeholder={value.mode === 'percent' ? '0 %' : '0'}
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
      </div>
    </div>
  )
}

export interface CartLine {
  key: string
  item_id: string
  item_name: string
  item_sku: string
  location_id: string
  quantity: number
  unit_price: number
  // As typed: "", "250" or "5%" (see discounts.tsx).
  discount: string
}

// Selling-price defaults that protect against selling below cost.

// The item's moving average cost, rounded up to the cent (so a price at this
// figure is never a fraction below cost). Null when there's no cost yet.
export function costFloor(avgCost: number | null | undefined): number | null {
  if (avgCost == null || !(avgCost > 0)) return null
  return Math.ceil(avgCost * 100 - 1e-6) / 100
}

// The price a new sale line starts at: the item's set price, or its moving
// average cost when that's higher (purchase prices have gone up since the
// set price was chosen).
export function sellingPrice(item: { unit_price: number; avg_cost: number | null }): number {
  const floor = costFloor(item.avg_cost)
  return floor != null && floor > item.unit_price ? floor : item.unit_price
}

// True when a price entered on a line is below the item's average cost.
export function isBelowCost(price: number, avgCost: number | null | undefined): boolean {
  const floor = costFloor(avgCost)
  return floor != null && price < floor
}

import type { Item } from './api'

// Purchase Order / Supplier Bill item pickers: once a supplier is chosen, only
// items linked to that supplier (items.supplier_id) are offered, unless the
// user ticks "Show all items". Items with no supplier count as unlinked.

export function supplierItemOptions(items: Item[] | undefined, supplierId: string, showAll: boolean) {
  const all = items ?? []
  const linked = supplierId ? all.filter((i) => i.supplier_id === supplierId) : all
  const filtering = !!supplierId && !showAll
  return {
    options: filtering ? linked : all,
    linkedCount: linked.length,
    filtering,
    // Whether a line's item may stay selected under the current supplier/toggle.
    allows: (itemId: string) => !itemId || !filtering || linked.some((i) => i.id === itemId),
  }
}

// Clears the item (and its cost, which belonged to that item) on every line
// whose item isn't linked to the supplier. Returns the new lines and how many
// were cleared, so the form can say so.
export function clearUnlinkedLines<L extends { item_id: string; unit_cost: string }>(
  lines: L[],
  items: Item[] | undefined,
  supplierId: string,
  showAll: boolean,
): { lines: L[]; cleared: number } {
  const { allows } = supplierItemOptions(items, supplierId, showAll)
  let cleared = 0
  const next = lines.map((line) => {
    if (allows(line.item_id)) return line
    cleared++
    return { ...line, item_id: '', unit_cost: '' }
  })
  return { lines: cleared ? next : lines, cleared }
}

// The "Show all items" checkbox shown under the Supplier field, plus a short
// status line: what's being shown, and how many lines a supplier switch cleared.
export function SupplierItemsToggle({
  supplierName,
  linkedCount,
  showAll,
  onShowAllChange,
  clearedCount,
}: {
  supplierName: string | undefined
  linkedCount: number
  showAll: boolean
  onShowAllChange: (showAll: boolean) => void
  clearedCount: number
}) {
  const hasSupplier = !!supplierName
  return (
    <div className="mt-2 flex flex-col gap-1">
      <label className="inline-flex w-fit items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => onShowAllChange(e.target.checked)}
          disabled={!hasSupplier}
          className="h-4 w-4 rounded border-border-strong"
        />
        Show all items
      </label>
      <p className="text-xs text-text-muted" role="status">
        {!hasSupplier
          ? 'Choose a supplier to list only the items it supplies.'
          : showAll
            ? `Showing every catalog item, including ones not linked to ${supplierName}.`
            : linkedCount === 0
              ? `No items are linked to ${supplierName} yet. Tick "Show all items", or set the supplier on the item.`
              : `Showing the ${linkedCount} item${linkedCount === 1 ? '' : 's'} linked to ${supplierName}.`}
      </p>
      {clearedCount > 0 && (
        <p className="text-xs font-medium text-warning-600" role="status">
          Cleared {clearedCount} line{clearedCount === 1 ? '' : 's'} with an item not linked to {supplierName}.
        </p>
      )}
    </div>
  )
}

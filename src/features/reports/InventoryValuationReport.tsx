import { useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { CheckboxControl, FilterSelect } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, MoneyTd, NumTd, ReportTable, Row, TotalRow } from './ReportParts'
import { useCategoryOptions, useLocationOptions } from './filterOptions'
import { useInventoryStatus } from './api'

export function InventoryValuationReport() {
  const { orgId, currencySymbol } = useOrg()
  const [locationId, setLocationId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [showZero, setShowZero] = useState(false)
  const locations = useLocationOptions(orgId)
  const categories = useCategoryOptions(orgId)
  const { data, isLoading, error } = useInventoryStatus(orgId, { locationId, categoryId })

  const rows = (data ?? []).filter((r) => showZero || r.quantity !== 0)
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0)
  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const locationName = locations.find((l) => l.value === locationId)?.label ?? 'All locations'

  function exportCsv() {
    const out: CsvRow[] = [
      ['Inventory Valuation', locationName],
      [],
      ['Item', 'SKU', 'Category', 'Quantity', 'Avg cost', 'Value'],
      ...rows.map((r): CsvRow => [r.item_name, r.sku, r.category_name, r.quantity, r.avg_cost, r.value]),
      ['Total', '', '', totalQty, '', totalValue],
    ]
    downloadCsv(`inventory-valuation-${locationName}`, out)
  }

  return (
    <ReportShell
      title="Inventory Valuation"
      period={`${locationName} · as of today`}
      controls={
        <>
          <FilterSelect label="Location" value={locationId} onChange={setLocationId} allLabel="All locations" options={locations} />
          <FilterSelect label="Category" value={categoryId} onChange={setCategoryId} allLabel="All categories" options={categories} />
          <CheckboxControl label="Show items with no stock" checked={showZero} onChange={setShowZero} />
        </>
      }
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell>Item</HeadCell>
            <HeadCell>SKU</HeadCell>
            <HeadCell>Category</HeadCell>
            <HeadCell right>Quantity</HeadCell>
            <HeadCell right>Avg cost</HeadCell>
            <HeadCell right>Value</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={6} message="No stock on hand for these filters." />}
        {rows.map((r) => (
          <Row key={r.item_id}>
            <Cell>{r.item_name}</Cell>
            <Cell className="text-text-muted">{r.sku}</Cell>
            <Cell className="text-text-muted">{r.category_name}</Cell>
            <NumTd value={r.quantity} className={r.quantity < 0 ? 'text-danger-600' : undefined} />
            <MoneyTd value={r.avg_cost} symbol={currencySymbol} className="text-text-muted" />
            <MoneyTd value={r.value} symbol={currencySymbol} />
          </Row>
        ))}
        <TotalRow grand>
          <Cell colSpan={3}>Total inventory value</Cell>
          <NumTd value={totalQty} />
          <Cell />
          <MoneyTd value={totalValue} symbol={currencySymbol} />
        </TotalRow>
      </ReportTable>
      <p className="px-5 py-3 text-xs text-text-muted">
        Value = quantity on hand × moving average cost. It can differ from the Inventory account where stock moved
        without a cost entry (credit memo returns, older direct purchase-order receipts).
      </p>
    </ReportShell>
  )
}

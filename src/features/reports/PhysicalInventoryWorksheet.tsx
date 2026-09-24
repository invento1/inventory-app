import { useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { formatDate, ymd } from './dates'
import { CheckboxControl, FilterSelect } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, NumTd, ReportTable, Row } from './ReportParts'
import { useCategoryOptions, useLocationOptions } from './filterOptions'
import { useInventoryStatus } from './api'

// A printable count sheet: blank Counted / Difference columns to fill in by
// hand. Hiding the system quantity gives a "blind count", so counters record
// what's actually on the shelf rather than confirming the expected number.
// Counted results go back in through a Quantity-type Inventory Adjustment.
export function PhysicalInventoryWorksheet() {
  const { orgId } = useOrg()
  const [locationId, setLocationId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [showSystemQty, setShowSystemQty] = useState(true)
  const locations = useLocationOptions(orgId)
  const categories = useCategoryOptions(orgId)
  const { data, isLoading, error } = useInventoryStatus(orgId, { locationId, categoryId })

  const rows = data ?? []
  const locationName = locations.find((l) => l.value === locationId)?.label ?? 'All locations'
  const cols = showSystemQty ? 7 : 6

  function exportCsv() {
    const out: CsvRow[] = [
      ['Physical Inventory Worksheet', locationName, formatDate(ymd(new Date()))],
      [],
      ['#', 'Item', 'SKU', 'Unit', ...(showSystemQty ? ['System qty'] : []), 'Counted qty', 'Difference'],
      ...rows.map((r, i): CsvRow => [
        i + 1,
        r.item_name,
        r.sku,
        r.unit,
        ...(showSystemQty ? [r.quantity] : []),
        '',
        '',
      ]),
    ]
    downloadCsv(`inventory-count-sheet-${locationName}`, out)
  }

  return (
    <ReportShell
      title="Physical Inventory Worksheet"
      period={`${locationName} · ${formatDate(ymd(new Date()))}`}
      controls={
        <>
          <FilterSelect label="Location" value={locationId} onChange={setLocationId} allLabel="All locations" options={locations} />
          <FilterSelect label="Category" value={categoryId} onChange={setCategoryId} allLabel="All categories" options={categories} />
          <CheckboxControl label="Show system quantity" checked={showSystemQty} onChange={setShowSystemQty} />
        </>
      }
      onExportCsv={exportCsv}
      isLoading={isLoading}
      error={error}
    >
      <ReportTable
        head={
          <>
            <HeadCell right>#</HeadCell>
            <HeadCell>Item</HeadCell>
            <HeadCell>SKU</HeadCell>
            <HeadCell>Unit</HeadCell>
            {showSystemQty && <HeadCell right>System qty</HeadCell>}
            <HeadCell className="w-32">Counted qty</HeadCell>
            <HeadCell className="w-32">Difference</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={cols} message="No items match these filters." />}
        {rows.map((r, i) => (
          <Row key={r.item_id}>
            <NumTd value={i + 1} className="text-text-muted" />
            <Cell>{r.item_name}</Cell>
            <Cell className="text-text-muted">{r.sku}</Cell>
            <Cell className="text-text-muted">{r.unit}</Cell>
            {showSystemQty && <NumTd value={r.quantity} />}
            <td className="px-4 py-2.5">
              <div className="h-5 border-b border-text-muted" />
            </td>
            <td className="px-4 py-2.5">
              <div className="h-5 border-b border-text-muted" />
            </td>
          </Row>
        ))}
      </ReportTable>
      <div className="grid grid-cols-1 gap-6 px-5 py-6 text-sm text-text-muted sm:grid-cols-3">
        {['Counted by', 'Verified by', 'Approved by'].map((label) => (
          <div key={label}>
            <div className="h-8 border-b border-text-muted" />
            <p className="mt-1">{label}</p>
          </div>
        ))}
      </div>
    </ReportShell>
  )
}

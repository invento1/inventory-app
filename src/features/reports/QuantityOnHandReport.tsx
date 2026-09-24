import { useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { Badge } from '../../components/ui/Badge'
import { downloadCsv, type CsvRow } from './csv'
import { FilterSelect } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, NumTd, ReportTable, Row, TotalRow } from './ReportParts'
import { useCategoryOptions, useLocationOptions } from './filterOptions'
import { stockStatus, useInventoryStatus } from './api'

export function QuantityOnHandReport() {
  const { orgId } = useOrg()
  const [locationId, setLocationId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const locations = useLocationOptions(orgId)
  const categories = useCategoryOptions(orgId)
  const { data, isLoading, error } = useInventoryStatus(orgId, { locationId, categoryId })

  const rows = data ?? []
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0)
  const locationName = locations.find((l) => l.value === locationId)?.label ?? 'All locations'

  function exportCsv() {
    const out: CsvRow[] = [
      ['Quantity On Hand', locationName],
      [],
      ['Item', 'SKU', 'Category', 'Unit', 'On hand', 'Reorder at', 'Status'],
      ...rows.map((r): CsvRow => [
        r.item_name,
        r.sku,
        r.category_name,
        r.unit,
        r.quantity,
        r.reorder_threshold,
        stockStatus(r.quantity, r.reorder_threshold).label,
      ]),
      ['Total', '', '', '', totalQty],
    ]
    downloadCsv(`quantity-on-hand-${locationName}`, out)
  }

  return (
    <ReportShell
      title="Quantity On Hand"
      period={locationName}
      controls={
        <>
          <FilterSelect label="Location" value={locationId} onChange={setLocationId} allLabel="All locations" options={locations} />
          <FilterSelect label="Category" value={categoryId} onChange={setCategoryId} allLabel="All categories" options={categories} />
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
            <HeadCell right>On hand</HeadCell>
            <HeadCell right>Reorder at</HeadCell>
            <HeadCell>Status</HeadCell>
          </>
        }
      >
        {rows.length === 0 && <EmptyRow colSpan={6} message="No items match these filters." />}
        {rows.map((r) => {
          const status = stockStatus(r.quantity, r.reorder_threshold)
          return (
            <Row key={r.item_id}>
              <Cell>{r.item_name}</Cell>
              <Cell className="text-text-muted">{r.sku}</Cell>
              <Cell className="text-text-muted">{r.category_name}</Cell>
              <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                {r.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                {r.unit && <span className="ml-1 text-xs text-text-muted">{r.unit}</span>}
              </td>
              <NumTd value={r.reorder_threshold} className="text-text-muted" />
              <Cell>
                <Badge tone={status.tone}>{status.label}</Badge>
              </Cell>
            </Row>
          )
        })}
        <TotalRow grand>
          <Cell colSpan={3}>
            Total · {rows.length} item{rows.length === 1 ? '' : 's'}
          </Cell>
          <NumTd value={totalQty} />
          <Cell colSpan={2} />
        </TotalRow>
      </ReportTable>
    </ReportShell>
  )
}

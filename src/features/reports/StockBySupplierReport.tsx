import { Fragment, useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { Badge } from '../../components/ui/Badge'
import { downloadCsv, type CsvRow } from './csv'
import { FilterSelect } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, NumTd, ReportTable, Row, SectionRow } from './ReportParts'
import { useSupplierOptions } from './filterOptions'
import { stockStatus, useInventoryStatus, type InventoryStatusRow } from './api'

export function StockBySupplierReport() {
  const { orgId } = useOrg()
  const [supplierId, setSupplierId] = useState('')
  const suppliers = useSupplierOptions(orgId)
  const { data, isLoading, error } = useInventoryStatus(orgId, { supplierId })

  // One section per supplier (items with no supplier last).
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: InventoryStatusRow[] }>()
    for (const r of data ?? []) {
      const key = r.supplier_id ?? ''
      const group = map.get(key) ?? { name: r.supplier_name ?? 'No supplier', rows: [] }
      group.rows.push(r)
      map.set(key, group)
    }
    return [...map.entries()]
      .sort(([a, ga], [b, gb]) => Number(!a) - Number(!b) || ga.name.localeCompare(gb.name))
      .map(([, g]) => g)
  }, [data])

  function exportCsv() {
    const out: CsvRow[] = [['Stock by Supplier'], [], ['Supplier', 'Item', 'SKU', 'Category', 'On hand', 'Reorder at', 'Status']]
    for (const g of groups) {
      for (const r of g.rows) {
        out.push([
          g.name,
          r.item_name,
          r.sku,
          r.category_name,
          r.quantity,
          r.reorder_threshold,
          stockStatus(r.quantity, r.reorder_threshold).label,
        ])
      }
    }
    downloadCsv('stock-by-supplier', out)
  }

  return (
    <ReportShell
      title="Stock by Supplier"
      period="Current stock, all locations"
      controls={
        <FilterSelect label="Supplier" value={supplierId} onChange={setSupplierId} allLabel="All suppliers" options={suppliers} />
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
        {groups.length === 0 && <EmptyRow colSpan={6} message="No items match this filter." />}
        {groups.map((g) => (
          <Fragment key={g.name}>
            <SectionRow label={`${g.name} · ${g.rows.length} item${g.rows.length === 1 ? '' : 's'}`} colSpan={6} />
            {g.rows.map((r) => {
              const status = stockStatus(r.quantity, r.reorder_threshold)
              return (
                <Row key={r.item_id}>
                  <Cell indent>{r.item_name}</Cell>
                  <Cell className="text-text-muted">{r.sku}</Cell>
                  <Cell className="text-text-muted">{r.category_name}</Cell>
                  <NumTd value={r.quantity} />
                  <NumTd value={r.reorder_threshold} className="text-text-muted" />
                  <Cell>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </Cell>
                </Row>
              )
            })}
          </Fragment>
        ))}
      </ReportTable>
    </ReportShell>
  )
}

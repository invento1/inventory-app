import { Fragment, useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { downloadCsv, type CsvRow } from './csv'
import { useDateRange } from './dates'
import { DateRangeControls, FilterSelect } from './ReportControls'
import { ReportShell } from './ReportShell'
import { Cell, EmptyRow, HeadCell, NumTd, ReportTable, Row, SectionRow, TotalRow } from './ReportParts'
import { useCategoryOptions, useLocationOptions } from './filterOptions'
import { useInventoryMovement, type InventoryMovementRow } from './api'

const QTY_COLUMNS = [
  { key: 'opening_qty', label: 'Opening' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'sold', label: 'Sold' },
  { key: 'returned', label: 'Returned' },
  { key: 'transferred', label: 'Transferred' },
  { key: 'adjusted', label: 'Adjusted' },
  { key: 'closing_qty', label: 'Closing' },
] as const

type QtyKey = (typeof QTY_COLUMNS)[number]['key']

function sumRows(rows: InventoryMovementRow[]) {
  const totals = {} as Record<QtyKey, number>
  for (const { key } of QTY_COLUMNS) totals[key] = rows.reduce((s, r) => s + r[key], 0)
  return totals
}

export function InventoryMovementReport() {
  const { orgId } = useOrg()
  const dates = useDateRange('this-month-to-date')
  const [locationId, setLocationId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const locations = useLocationOptions(orgId)
  const categories = useCategoryOptions(orgId)
  const { data, isLoading, error } = useInventoryMovement(
    orgId,
    dates.start,
    dates.end,
    { locationId, categoryId },
    dates.valid,
  )

  const groups = useMemo(() => {
    const map = new Map<string, InventoryMovementRow[]>()
    for (const r of data ?? []) {
      const key = r.category_name ?? 'Uncategorized'
      map.set(key, [...(map.get(key) ?? []), r])
    }
    return [...map.entries()].map(([name, rows]) => ({ name, rows, totals: sumRows(rows) }))
  }, [data])
  const grand = useMemo(() => sumRows(data ?? []), [data])
  const locationName = locations.find((l) => l.value === locationId)?.label ?? 'All locations'

  function exportCsv() {
    const out: CsvRow[] = [
      ['Inventory Movement', locationName, dates.label],
      [],
      ['Category', 'Item', 'SKU', ...QTY_COLUMNS.map((c) => c.label)],
      ...(data ?? []).map((r): CsvRow => [
        r.category_name ?? 'Uncategorized',
        r.item_name,
        r.sku,
        ...QTY_COLUMNS.map((c) => r[c.key]),
      ]),
      ['Total', '', '', ...QTY_COLUMNS.map((c) => grand[c.key])],
    ]
    downloadCsv(`inventory-movement-${dates.start}-to-${dates.end}`, out)
  }

  const qtyCells = (values: Record<QtyKey, number>, bold = false) =>
    QTY_COLUMNS.map(({ key }) => (
      <NumTd
        key={key}
        value={values[key]}
        className={
          key === 'closing_qty' || bold
            ? 'font-semibold'
            : values[key] === 0
              ? 'text-text-muted'
              : undefined
        }
      />
    ))

  return (
    <ReportShell
      title="Inventory Movement"
      period={`${locationName} · ${dates.label}`}
      controls={
        <>
          <DateRangeControls state={dates} />
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
            {QTY_COLUMNS.map((c) => (
              <HeadCell key={c.key} right>
                {c.label}
              </HeadCell>
            ))}
          </>
        }
      >
        {groups.length === 0 && <EmptyRow colSpan={8} message="No stock movement in this period." />}
        {groups.map((g) => (
          <Fragment key={g.name}>
            <SectionRow label={g.name} colSpan={8} />
            {g.rows.map((r) => (
              <Row key={r.item_id}>
                <Cell indent>
                  {r.item_name} <span className="text-xs text-text-muted">{r.sku}</span>
                </Cell>
                {qtyCells(r)}
              </Row>
            ))}
            <TotalRow>
              <Cell>Total {g.name}</Cell>
              {qtyCells(g.totals, true)}
            </TotalRow>
          </Fragment>
        ))}
        {groups.length > 0 && (
          <TotalRow grand>
            <Cell>Grand total</Cell>
            {qtyCells(grand, true)}
          </TotalRow>
        )}
      </ReportTable>
      <p className="px-5 py-3 text-xs text-text-muted">
        Opening + Purchased − Sold + Returned + Transferred + Adjusted = Closing. Voids are netted into the column of
        the document they reverse. Transfers net to zero across all locations, so they only show when one location is selected.
      </p>
    </ReportShell>
  )
}

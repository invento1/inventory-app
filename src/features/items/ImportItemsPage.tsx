import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Autocomplete } from '../../components/ui/Autocomplete'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/currency'
import { downloadCsv } from '../reports/csv'
import { useBrands, useCategories, useUnitsOfMeasure, type Category } from '../settings/api'
import { useSuppliers } from '../suppliers/api'
import { useImportItems, useItems, type ItemListRow } from './api'
import {
  IMPORT_COLUMNS,
  IMPORT_ROW_LIMIT,
  buildTemplateRows,
  parseItemImport,
  suggestExamples,
  withMissingPolicy,
  type ParsedImport,
  type PreviewRow,
  type RowStatus,
} from './itemImport'

const STATUS: Record<RowStatus, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  ready: { label: 'Ready', tone: 'success' },
  warning: { label: 'Ready (note)', tone: 'warning' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
}

type Filter = 'all' | 'import' | 'error' | 'skipped'

interface ImportResult {
  row_no: number
  new_sku: string
  item_name: string
}

export function ImportItemsPage() {
  const { orgId, currencySymbol, can } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: items, isLoading: loadingItems } = useItems(orgId)
  const { data: categories } = useCategories(orgId)
  const { data: brands } = useBrands(orgId)
  const { data: units } = useUnitsOfMeasure(orgId)
  const { data: suppliers } = useSuppliers(orgId)
  const importItems = useImportItems(orgId)

  const [showTemplate, setShowTemplate] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [createMissing, setCreateMissing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const ready = !!items && !!categories && !!brands && !!units && !!suppliers
  const rows = useMemo(() => (parsed ? withMissingPolicy(parsed.rows, createMissing) : []), [parsed, createMissing])
  const counts = useMemo(() => {
    const c = { ready: 0, warning: 0, skipped: 0, error: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])
  const importable = rows.filter((r) => r.status === 'ready' || r.status === 'warning')

  // What the "create missing" option would need to create, and whether this
  // user's security group allows it (the RPC checks the same permissions).
  const missingKinds = useMemo(() => {
    const kinds = new Set<string>()
    for (const r of parsed?.rows ?? []) {
      if (r.status === 'skipped' || r.status === 'error') continue
      for (const k of Object.keys(r.missing)) kinds.add(k)
    }
    return kinds
  }, [parsed])
  const needsMasterData = ['category', 'brand', 'unit'].some((k) => missingKinds.has(k))
  const needsSuppliers = missingKinds.has('supplier')
  const mayCreate = (!needsMasterData || can('settings.master_data')) && (!needsSuppliers || can('suppliers.create'))

  async function handleFile(file: File | undefined) {
    if (!file || !ready) return
    setError(null)
    setResult(null)
    setFilter('all')
    setCreateMissing(false)
    if (!/\.(csv|txt)$/i.test(file.name) && file.type && !file.type.includes('csv') && !file.type.startsWith('text/')) {
      setParsed(null)
      setFileName(file.name)
      setError('Choose a .csv file. In Excel use File → Save As → "CSV UTF-8 (Comma delimited)".')
      return
    }
    const text = await file.text()
    setFileName(file.name)
    setParsed(parseItemImport(text, { items, categories, brands, units, suppliers }))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void handleFile(e.dataTransfer.files?.[0])
  }

  function reset() {
    setParsed(null)
    setFileName(null)
    setResult(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function handleImport() {
    setError(null)
    try {
      const created = await importItems.mutateAsync({
        createMissing,
        rows: importable.map((r) => ({
          row: r.line,
          name: r.values.name,
          barcode: r.values.barcode,
          description: r.values.description,
          unit: r.values.unit,
          unit_price: r.price === null ? '' : String(r.price),
          reorder_threshold: r.reorder === null ? '' : String(r.reorder),
          category: r.values.category,
          brand: r.values.brand,
          supplier: r.values.supplier,
          is_active: r.active ? 'yes' : 'no',
        })),
      })
      setResult(created)
      setParsed(null)
      toast.success(`Imported ${created.length} item${created.length === 1 ? '' : 's'}`)
    } catch (err) {
      setError((err as { message?: string } | null)?.message ?? 'Import failed')
    }
  }

  const visible = rows.filter((r) =>
    filter === 'all'
      ? true
      : filter === 'import'
        ? r.status === 'ready' || r.status === 'warning'
        : r.status === filter,
  )

  return (
    <div>
      <PageHeader
        title="Import items"
        subtitle="Add many items at once from a CSV file"
        action={
          <button
            type="button"
            onClick={() => navigate('/items/list')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      {loadingItems || !ready ? (
        <PageSpinner />
      ) : result ? (
        <ImportDone result={result} onAgain={reset} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Step 1 */}
          <Card>
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <Step n={1} />
                <div>
                  <p className="font-medium text-text">Download the template</p>
                  <p className="text-sm text-text-muted">
                    It comes with a few of your existing items filled in as examples, so you can see how each column
                    is used. Add your new items underneath; the examples are skipped when you import.
                  </p>
                </div>
              </div>
              <Button variant="secondary" onClick={() => setShowTemplate(true)} className="shrink-0">
                <Download size={16} />
                Download template
              </Button>
            </CardBody>
          </Card>

          {/* Step 2 */}
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="flex gap-3">
                <Step n={2} />
                <div>
                  <p className="font-medium text-text">Upload the filled-in file</p>
                  <p className="text-sm text-text-muted">
                    Save it as CSV (in Excel: File → Save As → "CSV UTF-8"). You'll see every row checked before
                    anything is saved. Up to {IMPORT_ROW_LIMIT.toLocaleString()} items per file.
                  </p>
                </div>
              </div>
              <label
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
                  dragging ? 'border-accent-600 bg-accent-50' : 'border-border-strong bg-surface-muted/50 hover:bg-surface-muted',
                )}
              >
                <Upload size={22} className="text-text-subtle" />
                <span className="text-sm font-medium text-text">
                  {fileName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <FileSpreadsheet size={16} /> {fileName}
                    </span>
                  ) : (
                    'Choose a CSV file or drag it here'
                  )}
                </span>
                <span className="text-xs text-text-muted">{fileName ? 'Choose another file to replace it' : '.csv'}</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  aria-label="CSV file"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
              </label>
              {parsed?.fatal && <p className="text-sm text-danger-600">{parsed.fatal}</p>}
              {error && !parsed && <p className="text-sm text-danger-600">{error}</p>}
            </CardBody>
          </Card>

          {/* Step 3: preview */}
          {parsed && !parsed.fatal && (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-3">
                    <Step n={3} />
                    Check and import
                  </span>
                }
                subtitle={`${rows.length} row${rows.length === 1 ? '' : 's'} in ${fileName}`}
              />
              <CardBody className="flex flex-col gap-3 border-b border-border">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['all', `All ${rows.length}`],
                      ['import', `To import ${counts.ready + counts.warning}`],
                      ['error', `Errors ${counts.error}`],
                      ['skipped', `Skipped ${counts.skipped}`],
                    ] as [Filter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors',
                        filter === key
                          ? 'bg-accent-50 text-accent-700 ring-accent-700/20'
                          : 'text-text-muted ring-border hover:bg-surface-muted',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {parsed.unknownHeaders.length > 0 && (
                  <p className="text-xs text-text-muted">
                    Ignored columns: {parsed.unknownHeaders.join(', ')}.
                  </p>
                )}

                {missingKinds.size > 0 && (
                  <label className={cn('flex items-start gap-2 text-sm', !mayCreate && 'opacity-60')}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={createMissing}
                      disabled={!mayCreate}
                      onChange={(e) => setCreateMissing(e.target.checked)}
                    />
                    <span>
                      <span className="font-medium text-text">
                        Create the {listJoin([...missingKinds].map((k) => (k === 'category' ? 'categories' : `${k}s`)))}{' '}
                        that don't exist yet
                      </span>
                      <span className="block text-xs text-text-muted">
                        {mayCreate
                          ? 'Otherwise, rows that use a name you haven’t set up yet are left out. Check the spelling first: "Samsng" would become a new brand.'
                          : 'Your security group can’t create these. Set them up in Settings first, or ask an admin.'}
                      </span>
                    </span>
                  </label>
                )}
              </CardBody>

              <CardBody className="p-0">
                <Table>
                  <THead>
                    <Th>Row</Th>
                    <Th>Status</Th>
                    <Th>Name</Th>
                    <Th>Notes</Th>
                    <Th>Barcode</Th>
                    <Th>Unit</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Reorder</Th>
                    <Th>Category</Th>
                    <Th>Brand</Th>
                    <Th>Supplier</Th>
                    <Th>Active</Th>
                  </THead>
                  <tbody>
                    {visible.length === 0 && <EmptyState message="No rows in this view." />}
                    {visible.map((r) => (
                      <PreviewLine key={r.line} row={r} symbol={currencySymbol} />
                    ))}
                  </tbody>
                </Table>
              </CardBody>

              <CardBody className="flex flex-col gap-3 border-t border-border sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-text-muted">
                  {counts.error > 0 && (
                    <p className="text-danger-600">
                      {counts.error} row{counts.error === 1 ? ' has' : 's have'} errors and will be left out. Fix them in
                      your file and upload it again (rows already imported are then skipped automatically).
                    </p>
                  )}
                  {counts.skipped > 0 && (
                    <p>
                      {counts.skipped} row{counts.skipped === 1 ? ' is' : 's are'} skipped: examples or items that already
                      exist.
                    </p>
                  )}
                  {error && <p className="text-danger-600">{error}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" onClick={reset}>
                    Cancel
                  </Button>
                  <Button onClick={handleImport} disabled={importable.length === 0 || importItems.isPending}>
                    {importItems.isPending
                      ? 'Importing…'
                      : `Import ${importable.length} item${importable.length === 1 ? '' : 's'}`}
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {showTemplate && (
        <TemplateModal items={items ?? []} categories={categories ?? []} onClose={() => setShowTemplate(false)} />
      )}
    </div>
  )
}

// ['a', 'b', 'c'] -> 'a, b and c'
function listJoin(parts: string[]) {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-50 text-sm font-semibold text-accent-700">
      {n}
    </span>
  )
}

function PreviewLine({ row, symbol }: { row: PreviewRow; symbol: string }) {
  const s = STATUS[row.status]
  const dim = row.status === 'skipped'
  return (
    <Tr className={cn(dim && 'opacity-60')}>
      <Td className="text-text-muted tabular-nums">{row.line}</Td>
      <Td>
        <Badge tone={s.tone}>{s.label}</Badge>
      </Td>
      <Td className="min-w-40 font-medium">{row.values.name || '—'}</Td>
      {/* Right after the status, so the reason is visible without scrolling sideways. */}
      <Td className="min-w-64 max-w-sm text-xs">
        {row.messages.map((m) => (
          <p key={m} className={row.status === 'error' ? 'text-danger-600' : 'text-text-muted'}>
            {m}
          </p>
        ))}
      </Td>
      <Td className="tabular-nums">{row.values.barcode || '—'}</Td>
      <Td>{row.values.unit || 'unit'}</Td>
      <Td className="text-right tabular-nums">{row.price !== null ? formatMoney(row.price, symbol) : row.values.unit_price || '—'}</Td>
      <Td className="text-right tabular-nums">{row.reorder ?? (row.values.reorder_threshold || '—')}</Td>
      <Td>{row.values.category || '—'}</Td>
      <Td>{row.values.brand || '—'}</Td>
      <Td>{row.values.supplier || '—'}</Td>
      <Td>{row.active ? 'Yes' : 'No'}</Td>
    </Tr>
  )
}

function ImportDone({ result, onAgain }: { result: ImportResult[]; onAgain: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 size={36} className="text-success-600" />
        <h2 className="text-lg font-semibold text-text">
          Imported {result.length} item{result.length === 1 ? '' : 's'}
        </h2>
        <p className="text-sm text-text-muted">Each item got its own SKU. Stock starts at zero: receive it with a supplier bill or an inventory adjustment.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              downloadCsv('imported-items', [['Row', 'SKU', 'Name'], ...result.map((r) => [r.row_no, r.new_sku, r.item_name])])
            }
          >
            <Download size={16} />
            Download the list with SKUs
          </Button>
          <Button variant="secondary" onClick={onAgain}>
            Import another file
          </Button>
          <Link to="/items/list">
            <Button>View items</Button>
          </Link>
        </div>
      </CardBody>
      <CardBody className="max-h-96 overflow-y-auto border-t border-border p-0">
        <Table>
          <THead>
            <Th>SKU</Th>
            <Th>Name</Th>
          </THead>
          <tbody>
            {result.map((r) => (
              <Tr key={r.new_sku}>
                <Td className="tabular-nums">{r.new_sku}</Td>
                <Td>{r.item_name}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  )
}

function TemplateModal({
  items,
  categories,
  onClose,
}: {
  items: ItemListRow[]
  categories: Category[]
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>(() => suggestExamples(items).map((i) => i.id))
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const chosen = selected.map((id) => byId.get(id)).filter((i): i is ItemListRow => !!i)
  const available = items.filter((i) => !selected.includes(i.id))

  function download(examples: ItemListRow[]) {
    downloadCsv('hashirhub-items-template', buildTemplateRows(examples, categories))
    onClose()
  }

  return (
    <Modal title="Download the item template" onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-4">
        {items.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text">
              <span className="font-medium">Include some of your existing items as examples?</span>{' '}
              <span className="text-text-muted">
                They show how to fill each column. They keep their SKU, so they're skipped when you import; you can
                leave them in the file.
              </span>
            </p>
            <Autocomplete
              label="Add an example item"
              items={available}
              getKey={(i) => i.id}
              getLabel={(i) => i.name}
              getDescription={(i) => `SKU ${i.sku}${i.category_name ? ` · ${i.category_name}` : ''}`}
              getSearchText={(i) => `${i.name} ${i.sku} ${i.barcode ?? ''}`}
              clearOnPick
              onPick={(i) => setSelected((s) => [...s, i.id])}
              placeholder="Search by name, SKU or barcode"
              showSearchIcon
            />
            <div className="flex flex-wrap gap-2">
              {chosen.length === 0 && <span className="text-xs text-text-muted">No examples selected.</span>}
              {chosen.map((i) => (
                <span
                  key={i.id}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-50 py-1 pl-3 pr-1.5 text-xs font-medium text-accent-700"
                >
                  {i.name}
                  <button
                    type="button"
                    aria-label={`Remove ${i.name}`}
                    onClick={() => setSelected((s) => s.filter((id) => id !== i.id))}
                    className="rounded-full p-0.5 hover:bg-accent-100"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            You don't have any items yet, so the template will have the column headings only. Use the guide below.
          </p>
        )}

        {/* Collapsed so the download buttons stay in view; the examples do most of the explaining. */}
        <details className="group rounded-lg border border-border">
          <summary className="cursor-pointer select-none rounded-lg bg-surface-muted px-3 py-2 text-sm font-medium text-text group-open:rounded-b-none group-open:border-b group-open:border-border">
            Column guide: what goes in each of the {IMPORT_COLUMNS.length} columns
          </summary>
          <ul className="divide-y divide-divider text-sm">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c.field} className="flex gap-3 px-3 py-2">
                <span className="w-32 shrink-0 font-medium text-text">
                  {c.header}
                  {c.required && <span className="text-danger-600"> *</span>}
                </span>
                <span className="text-text-muted">{c.help}</span>
              </li>
            ))}
          </ul>
        </details>
        <p className="text-xs text-text-muted">
          Tip: in Excel, format the Barcode column as Text before typing long barcodes, or Excel turns them into numbers
          like 8.90E+12. Don't rename or remove the heading row.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          {chosen.length > 0 && (
            <Button variant="ghost" onClick={() => download([])}>
              Download without examples
            </Button>
          )}
          <Button onClick={() => download(chosen)}>
            <Download size={16} />
            {chosen.length > 0
              ? `Download with ${chosen.length} example${chosen.length === 1 ? '' : 's'}`
              : 'Download template'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

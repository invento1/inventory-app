// Item CSV import: the template's columns and the row checks behind the
// preview. The checks mirror the import_items RPC (which re-validates on the
// server), so what the preview calls "ready" is what the database accepts.
import type { Category, Brand, UnitOfMeasure } from '../settings/api'
import type { Supplier } from '../suppliers/api'
import type { ItemListRow } from './api'
import { parseCsv } from '../../lib/csvParse'
import type { CsvRow } from '../reports/csv'

export type ImportField =
  | 'sku'
  | 'name'
  | 'barcode'
  | 'description'
  | 'unit'
  | 'unit_price'
  | 'reorder_threshold'
  | 'category'
  | 'brand'
  | 'supplier'
  | 'is_active'

export interface ImportColumn {
  field: ImportField
  header: string
  required: boolean
  help: string
  // Other header spellings accepted on upload (compared case/space-insensitively).
  aliases: string[]
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'sku', header: 'SKU', required: false, aliases: ['code', 'itemcode'],
    help: 'Leave blank for new items: the SKU is assigned automatically. Example rows show their SKU and are skipped on import.' },
  { field: 'name', header: 'Name', required: true, aliases: ['itemname', 'item', 'product'],
    help: 'The item name. Must be unique: a name that already exists is skipped.' },
  { field: 'barcode', header: 'Barcode', required: false, aliases: ['ean', 'upc'],
    help: 'Optional. Each barcode can belong to one item only.' },
  { field: 'description', header: 'Description', required: false, aliases: ['details'], help: 'Optional.' },
  { field: 'unit', header: 'Unit', required: false, aliases: ['uom', 'unitofmeasure'],
    help: 'A unit from Settings → Units, by abbreviation or name (e.g. pcs). Blank means "unit".' },
  { field: 'unit_price', header: 'Selling Price', required: true, aliases: ['price', 'unitprice', 'saleprice', 'sellingprice'],
    help: 'A number, without the currency symbol (e.g. 1250 or 1250.50).' },
  { field: 'reorder_threshold', header: 'Reorder Level', required: false, aliases: ['reorder', 'reorderpoint', 'reorderthreshold', 'minstock'],
    help: 'Optional. Stock at or below this shows as low stock.' },
  { field: 'category', header: 'Category', required: false, aliases: [],
    help: 'Optional. A category name, or a path for sub-categories: Parent > Child.' },
  { field: 'brand', header: 'Brand', required: false, aliases: [], help: 'Optional. A brand name.' },
  { field: 'supplier', header: 'Supplier', required: false, aliases: ['vendor'], help: 'Optional. A supplier name.' },
  { field: 'is_active', header: 'Active', required: false, aliases: ['status', 'isactive', 'enabled'],
    help: 'yes or no. Blank means yes.' },
]

export const IMPORT_ROW_LIMIT = 2000

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const key = (s: string) => s.trim().toLowerCase()

export interface MasterData {
  items: ItemListRow[]
  categories: Category[]
  brands: Brand[]
  units: UnitOfMeasure[]
  suppliers: Supplier[]
}

// "Parent > Child" for a category, as the template writes it.
export function categoryPath(id: string | null, categories: Category[]): string {
  if (!id) return ''
  const byId = new Map(categories.map((c) => [c.id, c]))
  const parts: string[] = []
  let current = byId.get(id)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return parts.join(' > ')
}

export function buildTemplateRows(examples: ItemListRow[], categories: Category[]): CsvRow[] {
  return [
    IMPORT_COLUMNS.map((c) => c.header),
    ...examples.map((item) =>
      IMPORT_COLUMNS.map((c): string | number | null => {
        switch (c.field) {
          case 'sku': return item.sku
          case 'name': return item.name
          case 'barcode': return item.barcode
          case 'description': return item.description
          case 'unit': return item.unit
          case 'unit_price': return item.unit_price
          case 'reorder_threshold': return item.reorder_threshold
          case 'category': return categoryPath(item.category_id, categories)
          case 'brand': return item.brand_name
          case 'supplier': return item.supplier_name
          case 'is_active': return item.is_active ? 'yes' : 'no'
        }
      }),
    ),
  ]
}

// Items most worth showing as examples: the most fields filled in.
export function suggestExamples(items: ItemListRow[], count = 3): ItemListRow[] {
  const score = (i: ItemListRow) =>
    [i.barcode, i.description, i.category_id, i.brand_id, i.supplier_id, i.reorder_threshold != null ? 1 : null].filter(
      (v) => v != null && v !== '',
    ).length
  return [...items].filter((i) => i.is_active).sort((a, b) => score(b) - score(a)).slice(0, count)
}

export type RowStatus = 'ready' | 'warning' | 'skipped' | 'error'

export interface MissingRefs {
  category?: string
  brand?: string
  unit?: string
  supplier?: string
}

export interface PreviewRow {
  line: number // line number in the file (header = 1)
  values: Record<ImportField, string>
  price: number | null
  reorder: number | null
  active: boolean
  status: RowStatus
  messages: string[]
  missing: MissingRefs
}

export interface ParsedImport {
  rows: PreviewRow[]
  unknownHeaders: string[]
  fatal: string | null
}

// Accepts "1,250.50", "Rs 1250", " 1250 ". Returns NaN for anything else.
function parseNumber(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const cleaned = text.replace(/[^\d.-]/g, '')
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

function parseActive(raw: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (!v || ['yes', 'y', 'true', '1', 'active'].includes(v)) return true
  if (['no', 'n', 'false', '0', 'inactive'].includes(v)) return false
  return null
}

function categoryExists(path: string, categories: Category[]): boolean {
  const parts = path.split('>').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return true
  if (parts.length === 1) return categories.some((c) => key(c.name) === key(parts[0]))
  let parent: string | null = null
  for (const part of parts) {
    const match = categories.find((c) => key(c.name) === key(part) && (c.parent_id ?? null) === parent)
    if (!match) return false
    parent = match.id
  }
  return true
}

export function parseItemImport(text: string, data: MasterData): ParsedImport {
  const table = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ''))
  if (table.length === 0) return { rows: [], unknownHeaders: [], fatal: 'The file is empty.' }

  // Map header cells to fields.
  const header = table[0]
  const fieldAt = new Map<number, ImportField>()
  const unknownHeaders: string[] = []
  header.forEach((cell, index) => {
    const n = normalize(cell)
    const column = IMPORT_COLUMNS.find((c) => normalize(c.header) === n || c.aliases.includes(n))
    if (column && ![...fieldAt.values()].includes(column.field)) fieldAt.set(index, column.field)
    else if (cell.trim()) unknownHeaders.push(cell.trim())
  })
  const present = new Set(fieldAt.values())
  const missingRequired = IMPORT_COLUMNS.filter((c) => c.required && !present.has(c.field)).map((c) => c.header)
  if (missingRequired.length) {
    return {
      rows: [],
      unknownHeaders,
      fatal: `The first row must be the template's column headings. Missing: ${missingRequired.join(', ')}. Download the template and copy your data into it.`,
    }
  }
  if (table.length - 1 > IMPORT_ROW_LIMIT) {
    return { rows: [], unknownHeaders, fatal: `The file has ${table.length - 1} rows. Import at most ${IMPORT_ROW_LIMIT} at a time.` }
  }

  const itemsBySku = new Map(data.items.map((i) => [key(i.sku), i]))
  const itemsByName = new Map(data.items.map((i) => [key(i.name), i]))
  const itemsByBarcode = new Map(data.items.filter((i) => i.barcode).map((i) => [i.barcode!.trim(), i]))
  const seenNames = new Map<string, number>()
  const seenBarcodes = new Map<string, number>()

  const rows = table.slice(1).map((cells, index): PreviewRow => {
    const line = index + 2
    const values = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.field, ''])) as Record<ImportField, string>
    fieldAt.forEach((field, col) => {
      values[field] = (cells[col] ?? '').trim()
    })
    const errors: string[] = []
    const warnings: string[] = []
    const missing: MissingRefs = {}
    let skipped: string | null = null

    // Existing item (template examples keep their SKU): never changed.
    const bySku = values.sku ? itemsBySku.get(key(values.sku)) : undefined
    if (bySku) skipped = `Existing item (SKU ${bySku.sku}). Examples and existing items aren't changed.`
    else if (values.sku) warnings.push(`SKU "${values.sku}" is ignored; a new SKU is assigned automatically.`)

    if (!values.name) errors.push('Name is required.')
    else if (!skipped) {
      const existing = itemsByName.get(key(values.name))
      const firstLine = seenNames.get(key(values.name))
      if (existing) skipped = `Already exists (SKU ${existing.sku}).`
      else if (firstLine) errors.push(`Same name as row ${firstLine}.`)
      else seenNames.set(key(values.name), line)
    }

    const price = parseNumber(values.unit_price)
    if (price === null) errors.push('Selling Price is required.')
    else if (Number.isNaN(price)) errors.push(`Selling Price "${values.unit_price}" isn't a number.`)
    else if (price < 0) errors.push("Selling Price can't be negative.")

    const reorder = parseNumber(values.reorder_threshold)
    if (reorder !== null && Number.isNaN(reorder)) errors.push(`Reorder Level "${values.reorder_threshold}" isn't a number.`)
    else if (reorder !== null && reorder < 0) errors.push("Reorder Level can't be negative.")

    const active = parseActive(values.is_active)
    if (active === null) errors.push(`Active must be yes or no (got "${values.is_active}").`)

    if (values.barcode) {
      if (/^\d+(\.\d+)?e\+\d+$/i.test(values.barcode)) {
        errors.push(
          `Barcode "${values.barcode}" was turned into scientific notation by Excel. Format the Barcode column as Text and type it again.`,
        )
      } else if (!skipped) {
        const existing = itemsByBarcode.get(values.barcode)
        const firstLine = seenBarcodes.get(values.barcode)
        if (existing) errors.push(`Barcode ${values.barcode} is already used by SKU ${existing.sku}.`)
        else if (firstLine) errors.push(`Same barcode as row ${firstLine}.`)
        else seenBarcodes.set(values.barcode, line)
      }
    }

    if (values.unit && key(values.unit) !== 'unit' &&
        !data.units.some((u) => key(u.name) === key(values.unit) || (u.abbreviation && key(u.abbreviation) === key(values.unit)))) {
      missing.unit = values.unit
    }
    if (values.category) {
      const single = values.category.split('>').filter((p) => p.trim()).length === 1
      if (single && data.categories.filter((c) => key(c.name) === key(values.category)).length > 1) {
        errors.push(`More than one category is called "${values.category}". Write the full path, e.g. "Parent > ${values.category}".`)
      } else if (!categoryExists(values.category, data.categories)) {
        missing.category = values.category
      }
    }
    if (values.brand && !data.brands.some((b) => key(b.name) === key(values.brand))) missing.brand = values.brand
    if (values.supplier && !data.suppliers.some((s) => key(s.name) === key(values.supplier))) missing.supplier = values.supplier

    const status: RowStatus = skipped ? 'skipped' : errors.length ? 'error' : warnings.length ? 'warning' : 'ready'
    return {
      line,
      values,
      price: price !== null && !Number.isNaN(price) ? price : null,
      reorder: reorder !== null && !Number.isNaN(reorder) ? reorder : null,
      active: active ?? true,
      status,
      messages: skipped ? [skipped] : [...errors, ...warnings],
      missing,
    }
  })

  return { rows, unknownHeaders, fatal: rows.length === 0 ? 'The file has headings but no item rows.' : null }
}

// Applies the "create missing ..." choice: rows that reference something that
// doesn't exist become errors, or get a "will be created" note.
export function withMissingPolicy(rows: PreviewRow[], createMissing: boolean): PreviewRow[] {
  return rows.map((row) => {
    if (row.status === 'skipped' || row.status === 'error') return row
    const refs = Object.entries(row.missing) as [keyof MissingRefs, string][]
    if (refs.length === 0) return row
    const label = { category: 'Category', brand: 'Brand', unit: 'Unit', supplier: 'Supplier' }
    const notes = refs.map(([k, v]) =>
      createMissing ? `${label[k]} "${v}" will be created.` : `${label[k]} "${v}" doesn't exist.`,
    )
    return {
      ...row,
      status: createMissing ? 'warning' : 'error',
      messages: [...row.messages, ...notes],
    }
  })
}

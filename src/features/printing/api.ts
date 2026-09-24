import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { invoiceStatusTone, type InvoiceBadgeTone } from '../invoices/api'

// Everything a printed document needs, normalized so one PrintableDocument
// component renders invoices and sales receipts alike.
export interface PrintableLine {
  name: string
  sku: string
  unit: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface PrintableParty {
  name: string
  address: string | null
  phone: string | null
  email: string | null
}

export interface PrintableDoc {
  kind: 'invoice' | 'sales_receipt'
  id: string
  number: string
  issueDate: string
  dueDate: string | null
  isVoid: boolean
  statusLabel: string
  statusTone: InvoiceBadgeTone
  party: PrintableParty | null
  lines: PrintableLine[]
  subtotal: number
  total: number
  amountPaid: number
  balance: number
  paymentMethod: string | null
  notes: string | null
}

// Documents per batch print. A few hundred A4 pages is already a lot for a
// browser print job; past this the page asks for a narrower filter.
export const BATCH_LIMIT = 200

type ItemRef = { name: string; sku: string; unit: string | null } | null

function toLines(
  rows: { quantity: number; unit_price: number; line_total: number; items: ItemRef }[],
): PrintableLine[] {
  return rows.map((l) => ({
    name: l.items?.name ?? '',
    sku: l.items?.sku ?? '',
    unit: l.items?.unit ?? null,
    quantity: l.quantity,
    unitPrice: l.unit_price,
    lineTotal: l.line_total,
  }))
}

const INVOICE_SELECT =
  'id, invoice_number, issue_date, due_date, status, subtotal, total, amount_paid, notes, ' +
  'customers(name, address, phone, email), invoice_items(quantity, unit_price, line_total, items(name, sku, unit))'

export interface InvoicePrintFilter {
  ids?: string[]
  start?: string
  end?: string
  // Numeric part of the invoice number (12 -> INV-000012), inclusive.
  fromNumber?: number | null
  toNumber?: number | null
  customerId?: string
  unpaidOnly?: boolean
}

// next_document_number always formats as PREFIX-000123, so a zero-padded
// string range compares correctly.
const invoiceNumber = (n: number) => `INV-${String(n).padStart(6, '0')}`

export function usePrintableInvoices(orgId: string, filter: InvoicePrintFilter, enabled = true) {
  return useQuery({
    queryKey: ['printable_invoices', orgId, filter],
    enabled,
    queryFn: async () => {
      let query = supabase.from('invoices').select(INVOICE_SELECT).eq('org_id', orgId)
      if (filter.ids) {
        query = query.in('id', filter.ids)
      } else {
        // Batch printing skips voided invoices; a single void invoice can
        // still be printed from its own page (it gets a VOID watermark).
        query = query.neq('status', 'void')
      }
      if (filter.start) query = query.gte('issue_date', filter.start)
      if (filter.end) query = query.lte('issue_date', filter.end)
      if (filter.fromNumber != null) query = query.gte('invoice_number', invoiceNumber(filter.fromNumber))
      if (filter.toNumber != null) query = query.lte('invoice_number', invoiceNumber(filter.toNumber))
      if (filter.customerId) query = query.eq('customer_id', filter.customerId)
      if (filter.unpaidOnly) query = query.in('status', ['unpaid', 'partially_paid'])

      const { data, error } = await query.order('invoice_number').limit(BATCH_LIMIT + 1)
      if (error) throw error

      type Row = {
        id: string
        invoice_number: string
        issue_date: string
        due_date: string
        status: string
        subtotal: number
        total: number
        amount_paid: number
        notes: string | null
        customers: PrintableParty | null
        invoice_items: { quantity: number; unit_price: number; line_total: number; items: ItemRef }[]
      }
      const rows = (data ?? []) as unknown as Row[]
      return {
        truncated: rows.length > BATCH_LIMIT,
        docs: rows.slice(0, BATCH_LIMIT).map((inv): PrintableDoc => {
          const status = invoiceStatusTone(inv)
          return {
            kind: 'invoice',
            id: inv.id,
            number: inv.invoice_number,
            issueDate: inv.issue_date,
            dueDate: inv.due_date,
            isVoid: inv.status === 'void',
            statusLabel: status.label,
            statusTone: status.tone,
            party: inv.customers,
            lines: toLines(inv.invoice_items),
            subtotal: inv.subtotal,
            total: inv.total,
            amountPaid: inv.amount_paid,
            balance: inv.total - inv.amount_paid,
            paymentMethod: null,
            notes: inv.notes,
          }
        }),
      }
    },
  })
}

export function usePrintableSalesReceipt(orgId: string, id: string) {
  return useQuery({
    queryKey: ['printable_sales_receipt', orgId, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_receipts')
        .select(
          'id, receipt_number, created_at, status, payment_method, subtotal, total, notes, ' +
            'customers(name, address, phone, email), sales_receipt_items(quantity, unit_price, line_total, items(name, sku, unit))',
        )
        .eq('org_id', orgId)
        .eq('id', id)
        .single()
      if (error) throw error

      const r = data as unknown as {
        id: string
        receipt_number: string
        created_at: string
        status: string
        payment_method: string
        subtotal: number
        total: number
        notes: string | null
        customers: PrintableParty | null
        sales_receipt_items: { quantity: number; unit_price: number; line_total: number; items: ItemRef }[]
      }
      const isVoid = r.status === 'void'
      const doc: PrintableDoc = {
        kind: 'sales_receipt',
        id: r.id,
        number: r.receipt_number,
        issueDate: r.created_at,
        dueDate: null,
        isVoid,
        statusLabel: isVoid ? 'Void' : 'Paid',
        statusTone: isVoid ? 'neutral' : 'success',
        party: r.customers,
        lines: toLines(r.sales_receipt_items),
        subtotal: r.subtotal,
        total: r.total,
        amountPaid: isVoid ? 0 : r.total,
        balance: 0,
        paymentMethod: r.payment_method,
        notes: r.notes,
      }
      return doc
    },
  })
}

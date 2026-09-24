// journal_entries.reference_type -> a readable source label, and (where the
// source document has a detail page) a link to it. Only document-level
// reference_ids are linkable: invoice_payment's reference_id is the payment
// row, deposits/expenses/refunds/fund transfers have no detail page.
const LABELS: Record<string, string> = {
  manual: 'Journal entry',
  fund_transfer: 'Fund transfer',
  sales_receipt: 'Sales receipt',
  sales_receipt_cogs: 'Sales receipt (COGS)',
  invoice: 'Invoice',
  invoice_cogs: 'Invoice (COGS)',
  invoice_void: 'Invoice void',
  invoice_void_cogs: 'Invoice void (COGS)',
  invoice_payment: 'Customer payment',
  deposit: 'Deposit',
  supplier_bill: 'Supplier bill',
  supplier_bill_void: 'Supplier bill void',
  supplier_bill_payment: 'Bill payment',
  credit_memo: 'Credit memo',
  credit_memo_void: 'Credit memo void',
  refund: 'Refund',
  expense: 'Expense',
  expense_void: 'Expense void',
  inventory_adjustment: 'Inventory adjustment',
  inventory_cutover: 'Inventory cutover',
}

export function referenceLabel(referenceType: string | null | undefined) {
  if (!referenceType) return ''
  return LABELS[referenceType] ?? referenceType.replace(/_/g, ' ')
}

const PATHS: Record<string, string> = {
  sales_receipt: '/sales',
  sales_receipt_cogs: '/sales',
  invoice: '/invoices',
  invoice_cogs: '/invoices',
  invoice_void: '/invoices',
  invoice_void_cogs: '/invoices',
  supplier_bill: '/supplier-bills',
  supplier_bill_void: '/supplier-bills',
  credit_memo: '/credit-memos',
  credit_memo_void: '/credit-memos',
  inventory_adjustment: '/inventory-adjustments',
}

export function referencePath(referenceType: string | null | undefined, referenceId: string | null | undefined) {
  if (!referenceType || !referenceId) return null
  const base = PATHS[referenceType]
  return base ? `${base}/${referenceId}` : null
}

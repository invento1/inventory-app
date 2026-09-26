import { matchPath } from 'react-router-dom'
import { REPORT_CATEGORIES } from '../features/reports/catalog'

// Permission keys. The catalog itself (labels, modules, dependencies) lives
// in the app_permissions table and drives the Security Groups screen; this
// list only gives the frontend type-checked keys. Keep it in step with the
// migration that inserts app_permissions rows.
export const PERMISSIONS = [
  'items.view',
  'items.create',
  'items.edit',
  'items.prices',
  'inventory.transfer',
  'inventory.adjust',
  'customers.view',
  'customers.create',
  'customers.edit',
  'suppliers.view',
  'suppliers.create',
  'suppliers.edit',
  'sales.view',
  'sales.create',
  'invoices.view',
  'invoices.create',
  'invoices.void',
  'quotations.view',
  'quotations.create',
  'quotations.void',
  'credit_memos.view',
  'credit_memos.create',
  'credit_memos.void',
  'refunds.view',
  'refunds.create',
  'customer_payments.view',
  'customer_payments.receive',
  'customer_payments.deposit',
  'purchase_orders.view',
  'purchase_orders.create',
  'purchase_orders.receive',
  'supplier_bills.view',
  'supplier_bills.create',
  'supplier_bills.void',
  'supplier_payments.view',
  'supplier_payments.create',
  'expenses.view',
  'expenses.create',
  'expenses.void',
  'accounts.view',
  'accounts.manage',
  'journal.create',
  'banking.transfer',
  'reports.financial',
  'reports.receivables_payables',
  'reports.sales_purchases',
  'reports.inventory',
  'settings.company',
  'settings.master_data',
  'users.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type Can = (permission: Permission) => boolean

// What a page needs. `any`: at least one of the listed permissions.
// `owner`: owner role only (Reset Data). No entry = open to every member.
type Requirement = Permission | { any: Permission[] } | { owner: true }

export const REPORT_PERMISSIONS: Permission[] = [
  'reports.financial',
  'reports.receivables_payables',
  'reports.sales_purchases',
  'reports.inventory',
]

// Every document type's "view" permission (All Transactions lists them all).
export const DOCUMENT_VIEW_PERMISSIONS: Permission[] = [
  'sales.view',
  'invoices.view',
  'supplier_bills.view',
  'purchase_orders.view',
  'expenses.view',
  'quotations.view',
  'credit_memos.view',
  'refunds.view',
]

// all_transactions.doc_type -> the permission needed to see that document.
export const DOC_TYPE_PERMISSION: Record<string, Permission> = {
  sales_receipt: 'sales.view',
  invoice: 'invoices.view',
  supplier_bill: 'supplier_bills.view',
  purchase_order: 'purchase_orders.view',
  expense: 'expenses.view',
  quotation: 'quotations.view',
  credit_memo: 'credit_memos.view',
  refund: 'refunds.view',
}

// First match wins, so specific paths (/invoices/new) come before their
// :id siblings (/invoices/:id would also match "new").
const ROUTE_RULES: [string, Requirement][] = [
  ['/items/list', 'items.view'],
  ['/items/new', 'items.create'],
  ['/items/search', 'items.view'],
  ['/items/price-manager', 'items.prices'],
  ['/stock/*', 'items.view'],
  ['/suppliers', 'suppliers.view'],
  ['/customers', 'customers.view'],

  ['/purchase-orders/new', 'purchase_orders.create'],
  ['/purchase-orders/*', 'purchase_orders.view'],
  ['/sales/new', 'sales.create'],
  ['/sales/*', 'sales.view'],
  ['/invoices/new', 'invoices.create'],
  ['/invoices/*', 'invoices.view'],
  ['/supplier-bills/new', 'supplier_bills.create'],
  ['/supplier-bills/*', 'supplier_bills.view'],
  ['/quotations/new', 'quotations.create'],
  ['/quotations/*', 'quotations.view'],
  ['/credit-memos/new', 'credit_memos.create'],
  ['/credit-memos/*', 'credit_memos.view'],
  ['/refunds/new', 'refunds.create'],
  ['/refunds/*', 'refunds.view'],
  ['/expenses/new', 'expenses.create'],
  ['/expenses/*', 'expenses.view'],
  ['/transactions', { any: DOCUMENT_VIEW_PERMISSIONS }],
  ['/inventory-transfers', 'items.view'],
  ['/inventory-adjustments/new', 'inventory.adjust'],
  ['/inventory-adjustments/*', 'items.view'],

  ['/account/capital-matrix/*', 'accounts.view'],
  ['/account/fiscal-daybook/new', 'journal.create'],
  ['/account/fiscal-daybook', 'accounts.view'],
  ['/account/receive-payment', 'customer_payments.receive'],
  ['/account/view-payments', 'customer_payments.view'],
  ['/account/record-deposit', 'customer_payments.deposit'],
  ['/account/view-deposits', 'customer_payments.view'],
  ['/account/pay-bills', 'supplier_payments.create'],
  ['/account/view-paid-bills', 'supplier_payments.view'],
  ['/account/banking', 'banking.transfer'],

  ...REPORT_CATEGORIES.flatMap((category) =>
    category.reports.map((report): [string, Requirement] => [report.path, report.permission ?? category.permission]),
  ),
  ['/reports', { any: REPORT_PERMISSIONS }],

  ['/settings/company-info', 'settings.company'],
  ['/settings/users', 'users.manage'],
  ['/settings/security-groups', 'users.manage'],
  ['/settings/reset-data', { owner: true }],
  ['/settings/*', 'settings.master_data'],
]

function meets(requirement: Requirement, can: Can, isOwner: boolean): boolean {
  if (typeof requirement === 'string') return can(requirement)
  if ('owner' in requirement) return isOwner
  return requirement.any.some(can)
}

// Can the current user open this path? Used by the sidebar (to hide links),
// the route guard in AppLayout, and anything that links to a page (search
// results, dashboard rows).
export function canAccessPath(pathname: string, can: Can, isOwner: boolean): boolean {
  const rule = ROUTE_RULES.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname))
  return rule ? meets(rule[1], can, isOwner) : true
}

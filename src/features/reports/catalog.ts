// Single source of truth for the Reports section: the All Reports directory
// and the Sidebar's Reports group both render from this list.
//
// status:
//   'ready'   -- built and routed
//   'blocked' -- needs an underlying feature this app doesn't have yet
//                (sales reps, discounts, sales orders, an edit/delete audit
//                log, damaged/expired stock tracking); shown greyed out with
//                the reason, never linked

export interface ReportDef {
  title: string
  description: string
  path: string
  status: 'ready' | 'blocked'
  blockedReason?: string
}

export interface ReportCategory {
  key: string
  title: string
  reports: ReportDef[]
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    key: 'company-financial',
    title: 'Company & Financial',
    reports: [
      {
        title: 'Profit & Loss',
        description: 'Income, cost of goods sold, and expenses for a period',
        path: '/reports/profit-loss',
        status: 'ready',
      },
      {
        title: 'Balance Sheet',
        description: 'Assets, liabilities, and equity as of a date',
        path: '/reports/balance-sheet',
        status: 'ready',
      },
      {
        title: 'Trial Balance',
        description: 'Debit and credit balance of every account as of a date',
        path: '/reports/trial-balance',
        status: 'ready',
      },
      {
        title: 'Income by Customer',
        description: 'Sales less credit memos, refunds, and cost of goods sold, per customer',
        path: '/reports/income-by-customer',
        status: 'ready',
      },
      {
        title: 'Transactions Summary',
        description: 'Count and total of every document type in a period',
        path: '/reports/transactions-summary',
        status: 'ready',
      },
    ],
  },
  {
    key: 'receivables',
    title: 'Receivables',
    reports: [
      {
        title: 'Customer Balance Summary',
        description: 'What each customer owes as of a date',
        path: '/reports/customer-balances',
        status: 'ready',
      },
      {
        title: 'Customer Statement',
        description: 'Invoices, payments, and credits for one customer with a running balance',
        path: '/reports/customer-statement',
        status: 'ready',
      },
      {
        title: 'Payment Collection Summary',
        description: 'Customer payments received in a period, by method and deposit',
        path: '/reports/payment-collection',
        status: 'ready',
      },
    ],
  },
  {
    key: 'payables',
    title: 'Payables',
    reports: [
      {
        title: 'Supplier Balance Summary',
        description: 'What you owe each supplier as of a date',
        path: '/reports/supplier-balances',
        status: 'ready',
      },
      {
        title: 'Supplier Statement',
        description: 'Bills and payments for one supplier with a running balance',
        path: '/reports/supplier-statement',
        status: 'ready',
      },
    ],
  },
  {
    key: 'accounts',
    title: 'Accounts',
    reports: [
      {
        title: 'Journal',
        description: 'Every journal entry and its lines for a period',
        path: '/reports/journal',
        status: 'ready',
      },
      {
        title: 'General Ledger',
        description: 'Activity and running balance for every account',
        path: '/reports/general-ledger',
        status: 'ready',
      },
      {
        title: 'Account Statement',
        description: 'Opening balance, activity, and closing balance for one account',
        path: '/reports/account-statement',
        status: 'ready',
      },
    ],
  },
  {
    key: 'inventory',
    title: 'Inventory',
    reports: [
      {
        title: 'Quantity On Hand',
        description: 'Stock per item by location, with reorder status',
        path: '/reports/quantity-on-hand',
        status: 'ready',
      },
      {
        title: 'Inventory Valuation',
        description: 'Stock value at moving average cost',
        path: '/reports/inventory-valuation',
        status: 'ready',
      },
      {
        title: 'Inventory Movement',
        description: 'Opening, purchased, sold, returned, adjusted, and closing quantities',
        path: '/reports/inventory-movement',
        status: 'ready',
      },
      {
        title: 'Stock by Supplier',
        description: "Current stock grouped by each item's supplier",
        path: '/reports/stock-by-supplier',
        status: 'ready',
      },
      {
        title: 'Physical Inventory Worksheet',
        description: 'Printable count sheet for a stock take',
        path: '/reports/physical-inventory-worksheet',
        status: 'ready',
      },
      {
        title: 'Damaged / Expired Inventory',
        description: 'Stock written off as damaged or past expiry',
        path: '/reports/damaged-expired',
        status: 'blocked',
        blockedReason: 'Needs damaged/expired stock tracking (expiry dates, a write-off reason)',
      },
    ],
  },
  {
    key: 'purchases',
    title: 'Purchases',
    reports: [
      {
        title: 'Purchases by Supplier',
        description: 'Bills, purchase orders, paid, and owed per supplier',
        path: '/reports/purchases-by-supplier',
        status: 'ready',
      },
    ],
  },
  {
    key: 'sales',
    title: 'Sales',
    reports: [
      {
        title: 'Sales by Item',
        description: 'Quantity, sales, cost, and margin per item',
        path: '/reports/sales-by-item',
        status: 'ready',
      },
      {
        title: 'Sales by Category',
        description: 'Quantity, sales, cost, and margin per category',
        path: '/reports/sales-by-category',
        status: 'ready',
      },
      {
        title: 'Sales by Customer',
        description: 'Sales, cost, and margin per customer',
        path: '/reports/sales-by-customer',
        status: 'ready',
      },
      {
        title: 'Invoices Summary',
        description: 'Every invoice and sales receipt with its cost and margin',
        path: '/reports/invoices-summary',
        status: 'ready',
      },
      {
        title: 'Invoice Items Summary',
        description: 'Total quantity per item across a range of invoice numbers',
        path: '/reports/invoice-items-summary',
        status: 'ready',
      },
      {
        title: 'Customer Item Sales',
        description: 'Every item sold, grouped by customer',
        path: '/reports/customer-item-sales',
        status: 'ready',
      },
      {
        title: 'Sales by Representative',
        description: 'Sales per sales representative',
        path: '/reports/sales-by-rep',
        status: 'blocked',
        blockedReason: 'Needs sales representatives on invoices',
      },
      {
        title: 'Return Stock by Representative',
        description: 'Invoiced vs returned stock per representative',
        path: '/reports/return-stock-by-rep',
        status: 'blocked',
        blockedReason: 'Needs sales representatives, and credit memos linked to invoices',
      },
      {
        title: 'Sales by Salesman',
        description: 'Sales and commission per salesman',
        path: '/reports/sales-by-salesman',
        status: 'blocked',
        blockedReason: 'Needs salesmen and commission rates',
      },
      {
        title: 'Financial Recovery & Sales Performance',
        description: 'Sales, recovered credit, and collection efficiency per customer manager',
        path: '/reports/financial-recovery',
        status: 'blocked',
        blockedReason: 'Needs a customer credit manager assigned to each customer',
      },
      {
        title: 'Invoice Batch Print',
        description: 'Print a range of invoices in one go',
        path: '/reports/invoice-batch-print',
        status: 'blocked',
        blockedReason: 'Needs a printable invoice layout',
      },
    ],
  },
  {
    key: 'discounts',
    title: 'Discounts',
    reports: [
      {
        title: 'Customer Discounts Summary',
        description: 'Discounts given per customer',
        path: '/reports/customer-discounts',
        status: 'blocked',
        blockedReason: 'Needs line discounts on invoices and sales receipts',
      },
      {
        title: 'Item Discounts Summary',
        description: 'Discounts given per item',
        path: '/reports/item-discounts',
        status: 'blocked',
        blockedReason: 'Needs line discounts on invoices and sales receipts',
      },
    ],
  },
  {
    key: 'sales-orders',
    title: 'Sales Orders',
    reports: [
      {
        title: 'Sales Orders Summary',
        description: 'Every sales order in a period',
        path: '/reports/sales-orders',
        status: 'blocked',
        blockedReason: 'Needs a Sales Orders document type',
      },
      {
        title: 'Open Orders Summary',
        description: 'Sales orders not yet fulfilled',
        path: '/reports/open-orders',
        status: 'blocked',
        blockedReason: 'Needs a Sales Orders document type',
      },
    ],
  },
  {
    key: 'misc',
    title: 'Misc.',
    reports: [
      {
        title: 'Deleted Transactions',
        description: 'Audit trail of deleted documents',
        path: '/reports/deleted-transactions',
        status: 'blocked',
        blockedReason: 'Needs an audit log (documents are voided, never deleted, today)',
      },
      {
        title: 'Updated Transactions',
        description: 'Audit trail of edited documents',
        path: '/reports/updated-transactions',
        status: 'blocked',
        blockedReason: 'Needs an audit log of document edits',
      },
    ],
  },
]

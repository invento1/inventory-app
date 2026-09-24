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
]

export const READY_REPORTS = REPORT_CATEGORIES.flatMap((c) => c.reports).filter((r) => r.status === 'ready')

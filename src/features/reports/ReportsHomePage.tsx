import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { REPORT_CATEGORIES } from './catalog'
import { useOrg } from '../../auth/OrgProvider'

export function ReportsHomePage() {
  const { can } = useOrg()
  // Hide reports (and whole categories) this user's security group can't open.
  const categories = REPORT_CATEGORIES.map((category) => ({
    ...category,
    reports: category.reports.filter((r) => can(r.permission ?? category.permission)),
  })).filter((category) => category.reports.length > 0)

  return (
    <div>
      <PageHeader title="All Reports" subtitle="Financial, receivables, payables, inventory, and sales reports" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {categories.map((category) => (
          <Card key={category.key}>
            <CardHeader title={category.title} />
            <ul className="divide-y divide-border">
              {category.reports.map((report) =>
                report.status === 'ready' ? (
                  <li key={report.path}>
                    <Link
                      to={report.path}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-accent-700">{report.title}</p>
                        <p className="mt-0.5 text-xs text-text-muted">{report.description}</p>
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-text-muted" />
                    </Link>
                  </li>
                ) : (
                  <li key={report.path} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-muted">{report.title}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{report.blockedReason}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-text-muted">
                      Later
                    </span>
                  </li>
                ),
              )}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}

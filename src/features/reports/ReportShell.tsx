import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'

// Shared frame for every report: page header with back link / Export CSV /
// Print, a filter card, and the printable report document (company name,
// title, period). Everything except the document itself is print:hidden, and
// AppLayout hides the sidebar/top bar in print, so window.print() produces a
// clean report.
export function ReportShell({
  title,
  period,
  controls,
  onExportCsv,
  isLoading,
  error,
  prompt,
  children,
}: {
  title: string
  period?: ReactNode
  controls?: ReactNode
  onExportCsv?: () => void
  isLoading?: boolean
  error?: unknown
  // Shown instead of the report when a required filter (e.g. an account) isn't chosen yet.
  prompt?: string
  children?: ReactNode
}) {
  const { orgName } = useOrg()
  const ready = !isLoading && !error && !prompt

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={title}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/reports"
                className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
              >
                <ArrowLeft size={16} />
                All reports
              </Link>
              <Button variant="secondary" size="sm" onClick={onExportCsv} disabled={!onExportCsv || !ready}>
                <Download size={14} />
                Export CSV
              </Button>
              <Button variant="secondary" size="sm" onClick={() => window.print()} disabled={!ready}>
                <Printer size={14} />
                Print
              </Button>
            </div>
          }
        />
        {controls && (
          <Card className="mb-4">
            <CardBody>
              <div className="flex flex-wrap items-end gap-4">{controls}</div>
            </CardBody>
          </Card>
        )}
      </div>

      <Card className="print:rounded-none print:border-0 print:shadow-none">
        <div className="border-b border-border px-5 py-5 text-center">
          <p className="text-sm text-text-muted">{orgName}</p>
          <h2 className="mt-1 text-lg font-semibold text-text">{title}</h2>
          {period && <p className="mt-0.5 text-sm text-text-muted">{period}</p>}
        </div>
        {error ? (
          <p className="px-5 py-10 text-center text-sm text-danger-600">
            {error instanceof Error ? error.message : 'Could not load this report.'}
          </p>
        ) : prompt ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">{prompt}</p>
        ) : isLoading ? (
          <PageSpinner />
        ) : (
          children
        )}
      </Card>
    </div>
  )
}

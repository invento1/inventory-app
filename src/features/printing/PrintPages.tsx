import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { PageSpinner } from '../../components/ui/Spinner'
import { useOrgDetails } from '../settings/api'
import { useCustomers } from '../customers/api'
import { useDateRange } from '../reports/dates'
import { CheckboxControl, DateRangeControls, FilterSelect } from '../reports/ReportControls'
import { PrintableDocument } from './PrintableDocument'
import { BATCH_LIMIT, usePrintableInvoices, usePrintableSalesReceipt, type PrintableDoc } from './api'

// Toolbar (hidden in print) above one or more printable documents. Printing
// relies on AppLayout/Sidebar's print: classes to drop the app chrome;
// "Save as PDF" in the browser's print dialog gives a PDF for free.
function PrintShell({
  title,
  subtitle,
  back,
  controls,
  docs,
  isLoading,
  error,
  emptyMessage,
  footnote,
}: {
  title: string
  subtitle?: string
  back: { to: string; label: string }
  controls?: ReactNode
  docs: PrintableDoc[] | undefined
  isLoading: boolean
  error: unknown
  emptyMessage: string
  footnote?: ReactNode
}) {
  const { orgId, currencySymbol } = useOrg()
  const { data: org } = useOrgDetails(orgId)
  const count = docs?.length ?? 0

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={title}
          subtitle={subtitle}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={back.to}
                className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
              >
                <ArrowLeft size={16} />
                {back.label}
              </Link>
              <Button size="sm" onClick={() => window.print()} disabled={isLoading || count === 0}>
                <Printer size={14} />
                {count > 1 ? `Print ${count}` : 'Print'}
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
        <p className="mb-4 text-xs text-text-muted">
          Tip: choose “Save as PDF” as the printer to download instead. Turn off “Headers and footers” in the print
          dialog for a clean page.
        </p>
        {footnote}
      </div>

      {error ? (
        <p className="py-10 text-center text-sm text-danger-600">
          {error instanceof Error ? error.message : 'Could not load documents.'}
        </p>
      ) : isLoading ? (
        <PageSpinner />
      ) : count === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-6 print:block">
          {docs!.map((doc) => (
            <PrintableDocument key={doc.id} doc={doc} org={org} symbol={currencySymbol} />
          ))}
        </div>
      )}
    </div>
  )
}

export function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId } = useOrg()
  const { data, isLoading, error } = usePrintableInvoices(orgId, { ids: [id!] })
  const doc = data?.docs[0]
  return (
    <PrintShell
      title={doc ? `Print ${doc.number}` : 'Print invoice'}
      back={{ to: `/invoices/${id}`, label: 'Back to invoice' }}
      docs={data?.docs}
      isLoading={isLoading}
      error={error}
      emptyMessage="Invoice not found."
    />
  )
}

export function SalesReceiptPrintPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId } = useOrg()
  const { data, isLoading, error } = usePrintableSalesReceipt(orgId, id!)
  return (
    <PrintShell
      title={data ? `Print ${data.number}` : 'Print sales receipt'}
      back={{ to: `/sales/${id}`, label: 'Back to receipt' }}
      docs={data ? [data] : undefined}
      isLoading={isLoading}
      error={error}
      emptyMessage="Sales receipt not found."
    />
  )
}

function parseNumber(value: string): number | null {
  const digits = value.match(/(\d+)\s*$/)
  return digits ? Number(digits[1]) : null
}

// Reports -> Invoice Batch Print: every matching invoice, one per page.
export function InvoiceBatchPrintPage() {
  const { orgId } = useOrg()
  const dates = useDateRange('this-month')
  const { data: customers } = useCustomers(orgId)
  const [mode, setMode] = useState<'dates' | 'numbers'>('dates')
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [unpaidOnly, setUnpaidOnly] = useState(false)

  const byNumber = mode === 'numbers'
  const fromNumber = parseNumber(fromText)
  const toNumber = parseNumber(toText)
  const ready = byNumber ? fromNumber !== null || toNumber !== null : dates.valid

  const { data, isLoading, error } = usePrintableInvoices(
    orgId,
    {
      ...(byNumber ? { fromNumber, toNumber } : { start: dates.start, end: dates.end }),
      customerId: customerId || undefined,
      unpaidOnly,
    },
    ready,
  )

  return (
    <PrintShell
      title="Invoice Batch Print"
      subtitle="Print a set of invoices at once, one per page"
      back={{ to: '/reports', label: 'All reports' }}
      controls={
        <>
          <div className="w-full sm:w-44">
            <Select label="Select by" value={mode} onChange={(e) => setMode(e.target.value as 'dates' | 'numbers')}>
              <option value="dates">Invoice date</option>
              <option value="numbers">Invoice number</option>
            </Select>
          </div>
          {byNumber ? (
            <>
              <div className="w-full sm:w-40">
                <Input label="From #" placeholder="e.g. 1" value={fromText} onChange={(e) => setFromText(e.target.value)} />
              </div>
              <div className="w-full sm:w-40">
                <Input label="To #" placeholder="e.g. 25" value={toText} onChange={(e) => setToText(e.target.value)} />
              </div>
            </>
          ) : (
            <DateRangeControls state={dates} />
          )}
          <FilterSelect
            label="Customer"
            value={customerId}
            onChange={setCustomerId}
            allLabel="All customers"
            options={(customers ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <CheckboxControl label="Unpaid only" checked={unpaidOnly} onChange={setUnpaidOnly} />
        </>
      }
      docs={ready ? data?.docs : []}
      isLoading={ready && isLoading}
      error={error}
      emptyMessage={
        ready ? 'No invoices match these filters.' : 'Enter an invoice number range — "12" matches INV-000012.'
      }
      footnote={
        data?.truncated ? (
          <p className="mb-4 text-sm text-warning-600">
            Showing the first {BATCH_LIMIT} invoices only — narrow the filters to print the rest.
          </p>
        ) : null
      }
    />
  )
}

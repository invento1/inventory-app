import { Badge } from '../../components/ui/Badge'
import { formatMoney } from '../../lib/currency'
import type { OrgDetails } from '../settings/api'
import { formatDate } from '../reports/dates'
import { paymentMethodLabel } from '../reports/references'
import type { PrintableDoc } from './api'

const TITLES: Record<PrintableDoc['kind'], string> = {
  invoice: 'Invoice',
  sales_receipt: 'Sales Receipt',
}

// One A4 document (invoice or sales receipt). On screen it sits on a "paper"
// card; in print the card chrome drops away, and consecutive documents start
// on a new page (.print-doc rules in index.css). Company details come from
// Settings -> Company Info.
export function PrintableDocument({
  doc,
  org,
  symbol,
}: {
  doc: PrintableDoc
  org: OrgDetails | undefined
  symbol: string
}) {
  const money = (v: number) => formatMoney(v, symbol)
  const partyLabel = doc.kind === 'invoice' ? 'Bill to' : 'Sold to'
  const contact = [org?.phone, org?.email].filter(Boolean).join(' · ')

  return (
    <article className="print-doc relative mx-auto w-full max-w-[210mm] overflow-hidden rounded-xl border border-border bg-surface p-6 shadow-card sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      {doc.isVoid && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[120px] font-bold tracking-widest text-danger-600/10 select-none"
          style={{ transform: 'rotate(-24deg)' }}
        >
          VOID
        </div>
      )}

      <header className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xl font-semibold tracking-tight text-text">{org?.name}</p>
          {org?.address && <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{org.address}</p>}
          {contact && <p className="mt-1 text-sm text-text-muted">{contact}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-2xl font-semibold uppercase tracking-tight text-text">{TITLES[doc.kind]}</p>
          <p className="mt-1 text-sm font-medium text-text-secondary">{doc.number}</p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{partyLabel}</p>
          {doc.party ? (
            <div className="mt-1.5 text-sm">
              <p className="font-semibold text-text">{doc.party.name}</p>
              {doc.party.address && <p className="whitespace-pre-line text-text-muted">{doc.party.address}</p>}
              {doc.party.phone && <p className="text-text-muted">{doc.party.phone}</p>}
              {doc.party.email && <p className="text-text-muted">{doc.party.email}</p>}
            </div>
          ) : (
            <p className="mt-1.5 text-sm font-semibold text-text">Walk-in customer</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm sm:justify-self-end">
          <dt className="text-text-muted">{doc.kind === 'invoice' ? 'Invoice date' : 'Date'}</dt>
          <dd className="text-right font-medium text-text">{formatDate(doc.issueDate)}</dd>
          {doc.dueDate && (
            <>
              <dt className="text-text-muted">Due date</dt>
              <dd className="text-right font-medium text-text">{formatDate(doc.dueDate)}</dd>
            </>
          )}
          {doc.paymentMethod && (
            <>
              <dt className="text-text-muted">Payment</dt>
              <dd className="text-right font-medium text-text">{paymentMethodLabel(doc.paymentMethod)}</dd>
            </>
          )}
          <dt className="text-text-muted">Status</dt>
          <dd className="text-right">
            <Badge tone={doc.statusTone}>{doc.statusLabel}</Badge>
          </dd>
        </dl>
      </section>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-border bg-surface-muted/80 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <th className="w-10 px-3 py-2.5 font-semibold">#</th>
            <th className="px-3 py-2.5 font-semibold">Item</th>
            <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
            <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
            <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line, i) => (
            <tr key={i} className="border-b border-divider">
              <td className="px-3 py-2.5 align-top text-text-muted">{i + 1}</td>
              <td className="px-3 py-2.5 align-top">
                <span className="font-medium text-text">{line.name}</span>
                {line.sku && <span className="ml-2 text-xs text-text-muted">{line.sku}</span>}
              </td>
              <td className="px-3 py-2.5 text-right align-top tabular-nums whitespace-nowrap">
                {line.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                {line.unit && <span className="ml-1 text-xs text-text-muted">{line.unit}</span>}
              </td>
              <td className="px-3 py-2.5 text-right align-top tabular-nums whitespace-nowrap">{money(line.unitPrice)}</td>
              <td className="px-3 py-2.5 text-right align-top font-medium tabular-nums whitespace-nowrap">
                {money(line.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex justify-end">
        <dl className="w-full max-w-xs text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-text-muted">Subtotal</dt>
            <dd className="tabular-nums text-text">{money(doc.subtotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-border py-2 text-base font-semibold">
            <dt className="text-text">Total</dt>
            <dd className="tabular-nums text-text">{money(doc.total)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-text-muted">{doc.kind === 'invoice' ? 'Amount paid' : 'Paid'}</dt>
            <dd className="tabular-nums text-text">{money(doc.amountPaid)}</dd>
          </div>
          {doc.kind === 'invoice' && !doc.isVoid && (
            <div className="mt-1 flex justify-between rounded-lg bg-surface-muted px-3 py-2 font-semibold print:border print:border-border">
              <dt className="text-text">Balance due</dt>
              <dd className={`tabular-nums ${doc.balance > 0 ? 'text-danger-600' : 'text-text'}`}>{money(doc.balance)}</dd>
            </div>
          )}
        </dl>
      </div>

      {doc.notes && (
        <section className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Notes</p>
          <p className="mt-1 whitespace-pre-line text-sm text-text">{doc.notes}</p>
        </section>
      )}

      <footer className="mt-10 border-t border-border pt-4 text-center text-xs text-text-muted">
        Thank you for your business.
      </footer>
    </article>
  )
}

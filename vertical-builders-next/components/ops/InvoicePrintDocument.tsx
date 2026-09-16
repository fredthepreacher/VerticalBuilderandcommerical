import { PRINT_COMPANY, type PrintCompany } from '@/lib/ops/print/brand'
import { formatCents } from '@/lib/ops/utils/money'
import { formatDate } from '@/lib/ops/utils/dates'

/**
 * ============================================================================
 * INVOICE — customer-facing print layout
 * ----------------------------------------------------------------------------
 * Rendered into the invoice detail page but hidden on screen; it appears only
 * when the page is printed (see the @media print rules for .ops-print-doc).
 *
 * It reuses the SAVED invoice figures verbatim — subtotal, discount, tax, total,
 * paid and balance are passed in as already-computed cents and only formatted
 * here. Nothing is recalculated: the stored invoice row stays authoritative.
 *
 * The visual language matches the estimate PDF (lib/ops/estimating/pdf.ts): a
 * white page, company identity as text, a thin orange rule, a hairline-ruled
 * line table, and a totals block whose TOTAL is emphasised with weight and
 * colour rather than a filled bar. Ink lives in the words, not in banners.
 * ============================================================================
 */

export interface InvoicePrintItem {
  description: string
  quantity: number | string
  unit: string | null
  unitPriceCents: number
  lineTotalCents: number
}

export interface InvoicePrintProps {
  company?: PrintCompany
  invoiceNumber: string
  issueDate: string
  dueDate: string | null
  billToName: string | null
  propertyLines: string[]
  items: InvoicePrintItem[]
  subtotalCents: number
  discountCents: number
  taxPercent: number
  taxCents: number
  totalCents: number
  amountPaidCents: number
  balanceDueCents: number
  customerMessage: string | null
}

export default function InvoicePrintDocument(props: InvoicePrintProps) {
  const company = props.company ?? PRINT_COMPANY
  const showPaid = props.amountPaidCents > 0
  const showBalance = props.amountPaidCents > 0 && props.balanceDueCents !== props.totalCents

  return (
    <div className="ops-print-doc" aria-hidden="true">
      <header className="ppd-head">
        <div className="ppd-company">
          <div className="ppd-name">{company.name}</div>
          <div className="ppd-meta">FL Certified GC {company.licenseGC}  |  FL Certified Roofing {company.licenseRoof}</div>
          <div className="ppd-meta">{company.addressLine1}, {company.addressLine2}</div>
          <div className="ppd-meta">{company.phone}  |  {company.email}</div>
        </div>
        <div className="ppd-ident">
          <div className="ppd-title">INVOICE</div>
          <div className="ppd-number">{props.invoiceNumber}</div>
          <div className="ppd-meta">Issued {formatDate(props.issueDate)}</div>
          {props.dueDate && <div className="ppd-meta">Due {formatDate(props.dueDate)}</div>}
        </div>
      </header>
      <div className="ppd-rule" />

      <section className="ppd-parties">
        <div>
          <div className="ppd-label">Bill To</div>
          <div className="ppd-strong">{props.billToName || 'Customer'}</div>
        </div>
        <div>
          <div className="ppd-label">Project</div>
          {props.propertyLines.length
            ? props.propertyLines.map((line, i) => (
                <div key={i} className={i === 0 ? 'ppd-strong' : 'ppd-meta'}>{line}</div>
              ))
            : <div className="ppd-meta">—</div>}
        </div>
      </section>

      <table className="ppd-lines">
        <thead>
          <tr>
            <th className="ppd-l">Description</th>
            <th className="ppd-r">Qty</th>
            <th className="ppd-l">Unit</th>
            <th className="ppd-r">Rate</th>
            <th className="ppd-r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item, i) => (
            <tr key={i}>
              <td className="ppd-l">{item.description}</td>
              <td className="ppd-r">{item.quantity}</td>
              <td className="ppd-l">{item.unit || '—'}</td>
              <td className="ppd-r">{formatCents(item.unitPriceCents)}</td>
              <td className="ppd-r ppd-strong">{formatCents(item.lineTotalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ppd-totals">
        <div className="ppd-total-row"><span>Subtotal</span><span>{formatCents(props.subtotalCents)}</span></div>
        {props.discountCents > 0 && (
          <div className="ppd-total-row"><span>Discount</span><span>−{formatCents(props.discountCents)}</span></div>
        )}
        {props.taxCents > 0 && (
          <div className="ppd-total-row"><span>Tax ({props.taxPercent}%)</span><span>{formatCents(props.taxCents)}</span></div>
        )}
        <div className="ppd-total-row ppd-grand"><span>Total</span><span>{formatCents(props.totalCents)}</span></div>
        {showPaid && (
          <div className="ppd-total-row"><span>Paid</span><span>−{formatCents(props.amountPaidCents)}</span></div>
        )}
        {showBalance && (
          <div className="ppd-total-row ppd-balance"><span>Balance due</span><span>{formatCents(props.balanceDueCents)}</span></div>
        )}
      </div>

      {props.customerMessage && (
        <section className="ppd-notes">
          <div className="ppd-label">Notes</div>
          <p>{props.customerMessage}</p>
        </section>
      )}

      <footer className="ppd-foot">
        {company.name}  |  {company.phone}  |  {company.licenseGC} / {company.licenseRoof}
      </footer>
    </div>
  )
}

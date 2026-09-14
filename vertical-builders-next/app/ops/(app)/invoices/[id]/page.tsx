import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { getSettings } from '@/lib/ops/services/settings'
import { describePaymentConfig } from '@/lib/ops/finance/payment-provider'
import {
  INVOICE_STATUS_LABELS, type InvoiceItem, type InvoiceStatusValue, type PaymentMethod,
} from '@/lib/ops/types'
import { formatDate, formatDateTime } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import { Badge } from '@/components/ops/StatusBadge'
import InvoiceBuilder from '@/components/ops/InvoiceBuilder'
import PaymentPanel from '@/components/ops/PaymentPanel'
import PrintButton from '@/components/ops/PrintButton'
import InvoicePrintDocument from '@/components/ops/InvoicePrintDocument'

export const dynamic = 'force-dynamic'

const TONE: Record<InvoiceStatusValue, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  draft: 'neutral', sent: 'info', partially_paid: 'warn', paid: 'ok', overdue: 'bad', void: 'neutral',
}

export default async function InvoiceDetailPage({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { payment?: string }
}) {
  const user = await requireUser()
  if (!user.can('invoicesView')) notFound()

  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)

  const { data: invoice } = await supabase
    .from('invoices')
    .select(
      '*, invoice_items(*), payments(*),' +
      'projects(id, project_number, project_name), contacts(id, first_name, last_name, company_name, email)',
    )
    .eq('id', params.id)
    .maybeSingle()

  if (!invoice) notFound()
  // PostgREST widens a multi-embed select to a union that includes its error
  // shape; the row is validated above, so narrow it once to a real type here.
  const row = invoice as unknown as InvoiceRow

  const [{ data: projects }, { data: clients }] = await Promise.all([
    supabase.from('projects').select('id, project_number, project_name, customer_id')
      .is('archived_at', null).order('created_at', { ascending: false }).limit(300),
    supabase.from('contacts').select('id, first_name, last_name, company_name')
      .is('archived_at', null).order('last_name').limit(500),
  ])

  const project = Array.isArray(row.projects) ? row.projects[0] : row.projects
  const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
  const items = [...(row.invoice_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const payments = row.payments ?? []

  const status = row.status
  const paymentConfig = describePaymentConfig(settings.online_payments_enabled)

  const billToName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name
    : null
  const projectLines = project ? [`${project.project_number} · ${project.project_name}`] : []

  return (
    <>
    <div className="ops-screen-only">
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/invoices">Invoices</Link> / {row.invoice_number}
          </div>
          <h1>{row.invoice_number}</h1>
          <p className="ops-sub">
            <Badge tone={TONE[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>
            <span style={{ marginLeft: 8 }}>
              {formatCents(row.total_cents)} ·{' '}
              {billToName ?? 'No client'}
              {project && <> · <Link href={`/ops/projects/${project.id}`} style={{ color: 'var(--ops-accent)' }}>
                {project.project_number}
              </Link></>}
            </span>
          </p>
        </div>
        {status !== 'draft' && (
          <div className="ops-page-actions">
            <PrintButton />
          </div>
        )}
      </div>

      {searchParams.payment === 'submitted' && (
        <div className="ops-banner info" role="status">
          <div>
            <strong>Payment submitted</strong>
            The customer completed the payment page. This invoice updates to paid the moment Stripe
            confirms it — usually seconds for a card, a few business days for ACH.
          </div>
        </div>
      )}
      {searchParams.payment === 'cancelled' && (
        <div className="ops-banner neutral" role="status">
          <div>The payment page was closed without paying. Nothing has changed.</div>
        </div>
      )}
      {status === 'void' && (
        <div className="ops-banner neutral">
          <div>
            <strong>Voided {row.voided_at ? formatDate(row.voided_at) : ''}</strong>
            {row.void_reason}
          </div>
        </div>
      )}

      <div className="ops-detail">
        <div>
          <div className="ops-finance-grid" style={{ marginBottom: 16 }}>
            <div className="ops-finance-cell">
              <dt>Total</dt><dd>{formatCents(row.total_cents)}</dd>
            </div>
            <div className="ops-finance-cell">
              <dt>Paid</dt><dd>{formatCents(row.amount_paid_cents)}</dd>
            </div>
            <div className={`ops-finance-cell${row.balance_due_cents > 0 ? ' is-loss' : ' is-profit'}`}>
              <dt>Balance</dt><dd>{formatCents(row.balance_due_cents)}</dd>
            </div>
            <div className="ops-finance-cell">
              <dt>Due</dt>
              <dd style={{ fontSize: '1rem' }}>{row.due_date ? formatDate(row.due_date) : '—'}</dd>
            </div>
          </div>

          {status === 'draft' ? (
            <InvoiceBuilder
              invoice={{
                id: row.id,
                project_id: row.project_id,
                contact_id: row.contact_id,
                estimate_id: row.estimate_id,
                invoice_type: row.invoice_type,
                issue_date: row.issue_date,
                due_date: row.due_date,
                discount_cents: row.discount_cents,
                tax_percent: row.tax_percent,
                notes: row.notes,
                customer_message: row.customer_message,
                status,
                items: items.map((item, index) => ({
                  key: index + 1,
                  description: item.description,
                  quantity: String(item.quantity),
                  unit: item.unit ?? '',
                  unitPrice: item.unit_price_cents ? String(item.unit_price_cents / 100) : '',
                  estimateLineItemId: item.estimate_line_item_id ?? undefined,
                })),
              }}
              projects={(projects ?? []).map(p => ({
                id: p.id as string,
                label: `${p.project_number} · ${p.project_name}`,
                contactId: p.customer_id as string | null,
              }))}
              clients={(clients ?? []).map(c => ({
                id: c.id as string,
                label: [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string) || 'Unnamed',
              }))}
              taxEnabled={settings.estimate_tax_enabled}
            />
          ) : (
            <section className="ops-card">
              <div className="ops-card-head"><h2>Lines</h2></div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Description</th><th className="num">Qty</th><th>Unit</th>
                      <th className="num">Rate</th><th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td className="num">{item.quantity}</td>
                        <td>{item.unit ?? '—'}</td>
                        <td className="num">{formatCents(item.unit_price_cents)}</td>
                        <td className="num"><strong>{formatCents(item.line_total_cents)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ops-card-body">
                <dl className="ops-totals">
                  <div className="ops-totals-row">
                    <span>Subtotal</span><span>{formatCents(row.subtotal_cents)}</span>
                  </div>
                  {row.discount_cents > 0 && (
                    <div className="ops-totals-row">
                      <span>Discount</span><span>−{formatCents(row.discount_cents)}</span>
                    </div>
                  )}
                  {row.tax_cents > 0 && (
                    <div className="ops-totals-row">
                      <span>Tax ({row.tax_percent}%)</span>
                      <span>{formatCents(row.tax_cents)}</span>
                    </div>
                  )}
                  <div className="ops-totals-row grand">
                    <span>Total</span><span>{formatCents(row.total_cents)}</span>
                  </div>
                </dl>
                {row.customer_message && (
                  <p style={{ marginTop: 16, fontSize: '.85rem', whiteSpace: 'pre-wrap' }}>
                    {row.customer_message}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="ops-stack">
          <PaymentPanel
            invoiceId={params.id}
            invoiceStatus={status}
            balanceDueCents={row.balance_due_cents}
            payments={payments.map(p => ({
              id: p.id,
              amountCents: p.amount_cents,
              refundedCents: p.refunded_amount_cents,
              method: p.method,
              status: p.status,
              provider: p.provider,
              checkNumber: p.check_number,
              receivedDate: p.received_date,
              notes: p.notes,
            }))}
            onlineEnabled={paymentConfig.onlineEnabled}
            onlineMessage={paymentConfig.message}
            allowedMethods={settings.allowed_payment_methods}
            canRecord={user.can('paymentsRecord')}
            canRefund={user.can('paymentsRefund')}
            canVoid={user.can('invoicesVoid')}
          />

          <section className="ops-card">
            <div className="ops-card-head"><h2>Details</h2></div>
            <div className="ops-card-body">
              <dl className="ops-deflist">
                <dt>Type</dt><dd style={{ textTransform: 'capitalize' }}>{row.invoice_type}</dd>
                <dt>Issued</dt><dd>{formatDate(row.issue_date)}</dd>
                <dt>Sent</dt><dd>{row.sent_at ? formatDateTime(row.sent_at) : 'Not yet'}</dd>
                <dt>Paid</dt><dd>{row.paid_at ? formatDateTime(row.paid_at) : 'Not yet'}</dd>
                {row.estimate_id ? (
                  <>
                    <dt>From estimate</dt>
                    <dd>
                      <Link href={`/ops/estimates/${row.estimate_id}`} style={{ color: 'var(--ops-accent)' }}>
                        View estimate
                      </Link>
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>

      <InvoicePrintDocument
        invoiceNumber={row.invoice_number}
        issueDate={row.issue_date}
        dueDate={row.due_date}
        billToName={billToName}
        propertyLines={projectLines}
        items={items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unit_price_cents,
          lineTotalCents: item.line_total_cents,
        }))}
        subtotalCents={row.subtotal_cents}
        discountCents={row.discount_cents}
        taxPercent={row.tax_percent}
        taxCents={row.tax_cents}
        totalCents={row.total_cents}
        amountPaidCents={row.amount_paid_cents}
        balanceDueCents={row.balance_due_cents}
        customerMessage={row.customer_message}
      />
    </>
  )
}

interface InvoiceRow {
  id: string
  invoice_number: string
  project_id: string
  contact_id: string | null
  estimate_id: string | null
  invoice_type: string
  status: InvoiceStatusValue
  issue_date: string
  due_date: string | null
  subtotal_cents: number
  discount_cents: number
  tax_percent: number
  tax_cents: number
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  notes: string | null
  customer_message: string | null
  sent_at: string | null
  paid_at: string | null
  voided_at: string | null
  void_reason: string | null
  invoice_items: InvoiceItem[] | null
  payments: {
    id: string; amount_cents: number; refunded_amount_cents: number; method: PaymentMethod
    status: string; provider: string | null; check_number: string | null
    received_date: string | null; notes: string | null
  }[] | null
  projects: { id: string; project_number: string; project_name: string }
    | { id: string; project_number: string; project_name: string }[] | null
  contacts: { id: string; first_name: string | null; last_name: string | null; company_name: string | null; email: string | null }
    | { id: string; first_name: string | null; last_name: string | null; company_name: string | null; email: string | null }[] | null
}

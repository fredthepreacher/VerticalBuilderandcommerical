import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatusValue } from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import { Badge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const TONE: Record<InvoiceStatusValue, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warn',
  paid: 'ok',
  overdue: 'bad',
  void: 'neutral',
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string }
}) {
  const user = await requireUser()
  if (!user.can('invoicesView')) {
    return <EmptyState title="No access" message="Your role cannot view invoices." />
  }

  const supabase = createSupabaseServerClient()
  const { q, status } = searchParams
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('invoices')
    .select(
      'id, invoice_number, status, invoice_type, issue_date, due_date, total_cents,' +
      'amount_paid_cents, balance_due_cents, project_id,' +
      'projects(project_number, project_name), contacts(first_name, last_name, company_name)',
      { count: 'exact' },
    )
    .order('issue_date', { ascending: false })

  if (status === 'unpaid') query = query.in('status', ['sent', 'partially_paid', 'overdue'])
  else if (status) query = query.eq('status', status)
  if (q) {
    const p = `%${q.replace(/[%_,()]/g, ' ')}%`
    query = query.or(`invoice_number.ilike.${p},notes.ilike.${p}`)
  }

  const from = (page - 1) * PAGE_SIZE
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  const rows = (data ?? []) as unknown as RawInvoiceRow[]

  const outstanding = rows
    .filter(r => r.status !== 'void' && r.status !== 'draft')
    .reduce((sum, r) => sum + r.balance_due_cents, 0)
  const overdueCount = rows.filter(r => r.status === 'overdue').length

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Money</div>
          <h1>Invoices</h1>
          <p className="ops-sub">
            Every invoice is tied to a job, so what was billed and what was paid roll straight into
            that job&apos;s profitability.
          </p>
        </div>
        <div className="ops-page-actions">
          {user.can('invoicesCreate') && (
            <Link href="/ops/invoices/new" className="ops-btn ops-btn-primary">
              <Plus aria-hidden="true" /> New invoice
            </Link>
          )}
        </div>
      </div>

      <div className="ops-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <div className="ops-kpi">
          <div className="ops-kpi-label">Invoices shown</div>
          <div className="ops-kpi-value">{count ?? 0}</div>
        </div>
        <div className={`ops-kpi${outstanding > 0 ? ' is-warn' : ''}`}>
          <div className="ops-kpi-label">Outstanding on this page</div>
          <div className="ops-kpi-value" style={{ fontSize: '1.5rem' }}>{formatCents(outstanding)}</div>
        </div>
        <div className={`ops-kpi${overdueCount > 0 ? ' is-alert' : ''}`}>
          <div className="ops-kpi-label">Overdue</div>
          <div className="ops-kpi-value">{overdueCount}</div>
          <div className="ops-kpi-foot">Past the due date, not paid</div>
        </div>
      </div>

      <div className="ops-card">
        <FilterBar action="/ops/invoices" q={q} placeholder="Invoice number…"
          count={count !== null ? `${count} invoice${count === 1 ? '' : 's'}` : undefined}>
          <FilterSelect name="status" value={status} label="Status"
            options={[
              { value: 'unpaid', label: 'Unpaid (sent, partial or overdue)' },
              ...INVOICE_STATUSES.map(s => ({ value: s, label: INVOICE_STATUS_LABELS[s] })),
            ]} />
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            title={q || status ? 'No invoices match' : 'No invoices yet'}
            message={
              q || status
                ? 'Clear the filters to see everything.'
                : 'Raise one from a job, or straight from an approved estimate — the lines carry across.'
            }
            actionLabel={user.can('invoicesCreate') ? 'Create an invoice' : undefined}
            actionHref={user.can('invoicesCreate') ? '/ops/invoices/new' : undefined}
          />
        ) : (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>Invoice</th><th>Client</th><th>Job</th><th>Issued</th><th>Due</th>
                    <th className="num">Total</th><th className="num">Paid</th>
                    <th className="num">Balance</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects
                    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
                    return (
                      <tr key={row.id}>
                        <td data-label="Invoice" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/invoices/${row.id}`}>
                            {row.invoice_number}
                          </Link>
                          {row.invoice_type !== 'standard' && (
                            <span className="ops-sub2" style={{ textTransform: 'capitalize' }}>{row.invoice_type}</span>
                          )}
                        </td>
                        <td data-label="Client">
                          {contact
                            ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name
                            : '—'}
                        </td>
                        <td data-label="Job">
                          {project
                            ? <Link href={`/ops/projects/${row.project_id}`} style={{ color: 'var(--ops-accent)' }}>
                                {project.project_number}
                              </Link>
                            : '—'}
                        </td>
                        <td data-label="Issued" className="nowrap">{formatDate(row.issue_date)}</td>
                        <td data-label="Due" className="nowrap">{row.due_date ? formatDate(row.due_date) : '—'}</td>
                        <td data-label="Total" className="num">{formatCents(row.total_cents)}</td>
                        <td data-label="Paid" className="num">{formatCents(row.amount_paid_cents)}</td>
                        <td data-label="Balance" className="num">
                          <strong>{formatCents(row.balance_due_cents)}</strong>
                        </td>
                        <td data-label="Status">
                          <Badge tone={TONE[row.status]}>{INVOICE_STATUS_LABELS[row.status]}</Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0}
              basePath="/ops/invoices" params={{ q, status }} />
          </>
        )}
      </div>
    </>
  )
}

interface RawInvoiceRow {
  id: string
  invoice_number: string
  status: InvoiceStatusValue
  invoice_type: string
  issue_date: string
  due_date: string | null
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  project_id: string
  projects: { project_number: string; project_name: string } | { project_number: string; project_name: string }[] | null
  contacts: { first_name: string | null; last_name: string | null; company_name: string | null }
    | { first_name: string | null; last_name: string | null; company_name: string | null }[] | null
}

import Link from 'next/link'
import {
  AlertTriangle, ArrowUpRight, CalendarRange, FileSignature, FileUp, Receipt, ShieldCheck,
} from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { loadDashboard, loadFinancialSnapshot, loadOperationsSnapshot } from '@/lib/ops/services/dashboard'
import { getSettings } from '@/lib/ops/services/settings'
import { canViewCosts } from '@/lib/ops/auth/permissions'
import { formatCents } from '@/lib/ops/utils/money'
import { ACTION_LABELS } from '@/lib/ops/services/activity'
import { COMPLIANCE_LABELS, COVERAGE_LABELS, LEAD_STAGE_LABELS, type CoverageType, type LeadStage } from '@/lib/ops/types'
import { formatDate, formatDateTime, relativeDays } from '@/lib/ops/utils/dates'
import { Badge, ComplianceBadge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import DailyBriefCard from '@/components/ops/DailyBriefCard'
import { isOpsAiConfigured } from '@/lib/ops/ai/provider'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)
  const showMoney = canViewCosts(user.role, settings) || user.can('invoicesView')

  const [data, ops, money] = await Promise.all([
    loadDashboard(supabase),
    loadOperationsSnapshot(supabase),
    showMoney ? loadFinancialSnapshot(supabase) : Promise.resolve(null),
  ])
  const k = data.kpis

  const firstName = (user.profile.full_name || user.email).split(/[\s@]/)[0]

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Vertical Ops</div>
          <h1>Good {partOfDay()}, {firstName}</h1>
          <p className="ops-sub">
            Everything that needs a decision today — new leads, insurance about to lapse, and
            paperwork waiting on a human.
          </p>
        </div>
        <div className="ops-page-actions">
          <Link href="/ops/compliance/upload" className="ops-btn"><FileUp aria-hidden="true" /> Upload COI</Link>
          <Link href="/ops/audits" className="ops-btn ops-btn-dark"><ShieldCheck aria-hidden="true" /> Audit Center</Link>
        </div>
      </div>

      <div className="ops-kpis">
        <Kpi label="New leads this month" value={k.newLeadsThisMonth} href="/ops/leads" foot="Website + manual" />
        <Kpi label="Open opportunities" value={k.openOpportunities} href="/ops/leads" foot="Not yet won or lost" />
        <Kpi label="Active projects" value={k.activeProjects} href="/ops/projects" foot="Permitting through walkthrough" />
        <Kpi label="Active subcontractors" value={k.activeSubcontractors} href="/ops/subcontractors" />
        <Kpi
          label="Expiring within 30 days"
          value={k.coisExpiring30}
          href="/ops/compliance?status=expiring_soon"
          tone={k.coisExpiring30 > 0 ? 'warn' : undefined}
          foot="Policy lines, not certificates"
        />
        <Kpi
          label="Missing or non-compliant"
          value={k.nonCompliantVendors}
          href="/ops/compliance?status=non_compliant"
          tone={k.nonCompliantVendors > 0 ? 'alert' : undefined}
          foot="Should not be scheduled"
        />
        <Kpi label="Incomplete vendor files" value={k.missingDocuments} href="/ops/subcontractors" foot="COI, W-9 or license gap" />

        <div className="ops-kpi is-feature">
          <div className="ops-kpi-label">Documentation Readiness</div>
          <div className="ops-kpi-value">{k.readinessPercentage}%</div>
          <div className="ops-meter" role="img" aria-label={`${k.readinessPercentage} percent documentation readiness`}>
            <i style={{ width: `${k.readinessPercentage}%` }} />
          </div>
          <div className="ops-kpi-foot">
            {data.readiness.readyVendors} of {data.readiness.totalVendors} subs on live projects have complete,
            current, reviewed paperwork.
          </div>
        </div>
      </div>

      {/* --- Vertical AI brief (Phase 3) --------------------------------------- */}
      <div style={{ marginBottom: 20 }}>
        <DailyBriefCard aiConfigured={isOpsAiConfigured()} aiEnabled={settings.ai_dashboard_brief_enabled} />
      </div>

      {/* --- Operations (Phase 2) --------------------------------------------- */}
      <div className="ops-columns" style={{ marginBottom: 20 }}>
        <div className="ops-stack">
          <section className="ops-card">
            <div className="ops-card-head">
              <CalendarRange aria-hidden="true" style={{ width: 17, height: 17, color: 'var(--ops-muted)' }} />
              <h2>This week on the board</h2>
              <div className="ops-card-actions">
                <Link href="/ops/schedule" className="ops-btn ops-btn-sm">Full schedule</Link>
              </div>
            </div>
            <div className="ops-card-body">
              {ops.schedule.startingThisWeek.length === 0 && ops.schedule.finishingThisWeek.length === 0 ? (
                <p className="ops-hint">
                  Nothing starts or finishes in the next seven days.
                  {ops.schedule.unscheduledActive > 0
                    ? ` ${ops.schedule.unscheduledActive} active job${ops.schedule.unscheduledActive === 1 ? ' has' : 's have'} no scheduled dates yet.`
                    : ''}
                </p>
              ) : (
                <div className="ops-grid-2">
                  <div>
                    <p className="ops-label">Starting</p>
                    {ops.schedule.startingThisWeek.length === 0 ? (
                      <p className="ops-hint">Nothing starting.</p>
                    ) : (
                      <ul style={{ display: 'grid', gap: 8 }}>
                        {ops.schedule.startingThisWeek.map(j => (
                          <li key={j.id} style={{ fontSize: '.83rem' }}>
                            <Link href={`/ops/projects/${j.id}`} style={{ color: 'var(--ops-accent)' }}>
                              {j.number} · {j.name}
                            </Link>
                            <span className="ops-hint" style={{ display: 'block' }}>{formatDate(j.date)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="ops-label">Finishing</p>
                    {ops.schedule.finishingThisWeek.length === 0 ? (
                      <p className="ops-hint">Nothing finishing.</p>
                    ) : (
                      <ul style={{ display: 'grid', gap: 8 }}>
                        {ops.schedule.finishingThisWeek.map(j => (
                          <li key={j.id} style={{ fontSize: '.83rem' }}>
                            <Link href={`/ops/projects/${j.id}`} style={{ color: 'var(--ops-accent)' }}>
                              {j.number} · {j.name}
                            </Link>
                            <span className="ops-hint" style={{ display: 'block' }}>{formatDate(j.date)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              {ops.schedule.unscheduledActive > 0 && (
                <p className="ops-hint" style={{ marginTop: 12 }}>
                  <Link href="/ops/schedule" style={{ color: 'var(--ops-accent)' }}>
                    {ops.schedule.unscheduledActive} active job{ops.schedule.unscheduledActive === 1 ? '' : 's'} still
                    {' '}without scheduled dates
                  </Link>{' '}
                  — the Gantt chart estimates their bars until real dates are set.
                </p>
              )}
            </div>
          </section>

          {money && (
            <section className="ops-card">
              <div className="ops-card-head">
                <Receipt aria-hidden="true" style={{ width: 17, height: 17, color: 'var(--ops-muted)' }} />
                <h2>Money</h2>
                <div className="ops-card-actions">
                  <Link href="/ops/invoices" className="ops-btn ops-btn-sm">Invoices</Link>
                </div>
              </div>
              <div className="ops-card-body">
                <div className="ops-grid-3">
                  <MiniStat label="Outstanding" value={formatCents(money.outstandingCents)}
                    foot="Issued invoices with a balance" />
                  <MiniStat label="Overdue" value={formatCents(money.overdueCents)}
                    foot={`${money.overdueCount} invoice${money.overdueCount === 1 ? '' : 's'} past due`}
                    tone={money.overdueCents > 0 ? 'alert' : undefined} />
                  <MiniStat label="Collected this month" value={formatCents(money.paidThisMonthCents)}
                    foot="Confirmed payments only" />
                </div>

                {money.recentInvoices.length > 0 && (
                  <div className="ops-table-wrap" style={{ marginTop: 14 }}>
                    <table className="ops-table ops-table-cards">
                      <thead>
                        <tr><th>Invoice</th><th>Job</th><th>Due</th><th className="num">Balance</th></tr>
                      </thead>
                      <tbody>
                        {money.recentInvoices.map(inv => {
                          const overdue = inv.balanceCents > 0 && inv.dueDate !== null
                            && inv.dueDate < new Date().toISOString().slice(0, 10)
                          return (
                            <tr key={inv.id}>
                              <td data-label="Invoice" className="ops-cell-primary">
                                <Link className="ops-row-link" href={`/ops/invoices/${inv.id}`}>{inv.number}</Link>
                              </td>
                              <td data-label="Job">{inv.projectName ?? '—'}</td>
                              <td data-label="Due" className="nowrap">
                                {inv.dueDate ? formatDate(inv.dueDate) : 'On receipt'}
                                {overdue && <Badge tone="bad">overdue</Badge>}
                              </td>
                              <td data-label="Balance" className="num">
                                {inv.balanceCents === 0 ? 'Paid' : formatCents(inv.balanceCents)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {(money.draftInvoiceCount > 0 || money.unpricedPricebookItems > 0) && (
                  <p className="ops-hint" style={{ marginTop: 12 }}>
                    {money.draftInvoiceCount > 0 && `${money.draftInvoiceCount} draft invoice${money.draftInvoiceCount === 1 ? '' : 's'} not yet sent. `}
                    {money.unpricedPricebookItems > 0 && (
                      <>
                        {money.unpricedPricebookItems} pricebook item{money.unpricedPricebookItems === 1 ? '' : 's'} still
                        cost $0 —{' '}
                        <Link href="/ops/settings?tab=pricebook" style={{ color: 'var(--ops-accent)' }}>price them</Link>.
                      </>
                    )}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="ops-stack">
          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Estimates</h2>
              <div className="ops-card-actions">
                <Link href="/ops/estimates" className="ops-btn ops-btn-sm">All estimates</Link>
              </div>
            </div>
            <div className="ops-card-body">
              <dl className="ops-deflist">
                <dt>Drafts</dt><dd>{ops.estimates.draft}</dd>
                <dt>Waiting on a human review</dt>
                <dd>
                  {ops.estimates.awaitingReview}
                  {ops.estimates.awaitingReview > 0 && (
                    <span className="ops-hint" style={{ display: 'block' }}>
                      An AI draft cannot be sent until someone signs off on it.
                    </span>
                  )}
                </dd>
                <dt>Out with customers</dt>
                <dd>{ops.estimates.sent}{ops.estimates.sentValueCents > 0 && ` · ${formatCents(ops.estimates.sentValueCents)}`}</dd>
                <dt>Approved, not yet a job</dt>
                <dd>
                  {ops.estimates.approvedNotConverted > 0 ? (
                    <Link href="/ops/estimates?status=approved" style={{ color: 'var(--ops-accent)' }}>
                      {ops.estimates.approvedNotConverted} ready to convert
                    </Link>
                  ) : '0'}
                </dd>
                {ops.measurementsPending > 0 && (
                  <>
                    <dt>Measurements in progress</dt>
                    <dd>{ops.measurementsPending}</dd>
                  </>
                )}
              </dl>
            </div>
          </section>

          <section className="ops-card">
            <div className="ops-card-head">
              <FileSignature aria-hidden="true" style={{ width: 17, height: 17, color: 'var(--ops-muted)' }} />
              <h2>Signed agreements</h2>
            </div>
            <div className="ops-card-body">
              {ops.agreements.missing === 0 && ops.agreements.expiringSoon === 0 ? (
                <p className="ops-hint">
                  Every active subcontractor has an agreement on file and none expires in the next
                  60 days.
                </p>
              ) : (
                <ul style={{ display: 'grid', gap: 8, fontSize: '.84rem' }}>
                  {ops.agreements.missing > 0 && (
                    <li>
                      <Link href="/ops/subcontractors" style={{ color: 'var(--ops-accent)' }}>
                        {ops.agreements.missing} subcontractor{ops.agreements.missing === 1 ? '' : 's'} with no
                        signed agreement
                      </Link>
                    </li>
                  )}
                  {ops.agreements.expiringSoon > 0 && (
                    <li>{ops.agreements.expiringSoon} agreement{ops.agreements.expiringSoon === 1 ? '' : 's'} expiring within 60 days</li>
                  )}
                </ul>
              )}
              <p className="ops-hint" style={{ marginTop: 12 }}>
                A signed contract and a current COI are separate obligations. Neither one covers
                the other.
              </p>
            </div>
          </section>
        </div>
      </div>

      <div className="ops-columns">
        <div className="ops-stack">
          {/* --- Expiring coverage ------------------------------------------------ */}
          <section className="ops-card">
            <div className="ops-card-head">
              <AlertTriangle aria-hidden="true" style={{ width: 17, height: 17, color: 'var(--ops-warn)' }} />
              <h2>Coverage expiring or expired</h2>
              <div className="ops-card-actions">
                <Link href="/ops/compliance" className="ops-btn ops-btn-sm">View all</Link>
              </div>
            </div>
            {data.expiringSoon.length === 0 ? (
              <EmptyState
                title="Nothing expiring"
                message={`No policy line expires within the next ${data.warningWindowDays} days. This panel fills up automatically as renewal dates approach.`}
              />
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead>
                    <tr>
                      <th>Subcontractor</th><th>Coverage</th><th>Carrier</th><th>Expires</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.expiringSoon.map(p => (
                      <tr key={p.policy_id}>
                        <td data-label="Subcontractor" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/subcontractors/${p.vendor_id}`}>{p.vendor_name}</Link>
                        </td>
                        <td data-label="Coverage">{COVERAGE_LABELS[p.coverage_type as CoverageType] ?? p.coverage_type}</td>
                        <td data-label="Carrier">{p.carrier ?? '—'}</td>
                        <td data-label="Expires" className="nowrap">
                          <Badge tone={p.days_out < 0 ? 'bad' : p.days_out <= 7 ? 'bad' : 'warn'}>
                            {formatDate(p.expiration_date)} · {relativeDays(p.days_out)}
                          </Badge>
                        </td>
                        <td className="ops-actions">
                          <Link className="ops-btn ops-btn-sm" href={`/ops/subcontractors/${p.vendor_id}?tab=insurance`}>
                            Request renewal
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* --- Vendors needing attention --------------------------------------- */}
          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Subcontractors needing attention</h2>
              <div className="ops-card-actions">
                <Link href="/ops/compliance" className="ops-btn ops-btn-sm">Compliance register</Link>
              </div>
            </div>
            {data.attentionVendors.length === 0 ? (
              <EmptyState
                title="Every subcontractor is clear"
                message="No vendor is currently missing, expired, or waiting on review."
              />
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead>
                    <tr><th>Subcontractor</th><th>Trade</th><th>Status</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {data.attentionVendors.map(row => (
                      <tr key={row.vendor.id}>
                        <td data-label="Subcontractor" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/subcontractors/${row.vendor.id}`}>
                            {row.vendor.legal_name}
                          </Link>
                          {row.projects.length > 0 && (
                            <span className="ops-sub2">On {row.projects.map(p => p.project_number).join(', ')}</span>
                          )}
                        </td>
                        <td data-label="Trade">{row.vendor.primary_trade ?? '—'}</td>
                        <td data-label="Status"><ComplianceBadge status={row.evaluation.status} /></td>
                        <td data-label="Why" style={{ fontSize: '.79rem', color: 'var(--ops-muted)' }}>
                          {row.evaluation.summary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* --- Leads ------------------------------------------------------------ */}
          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Leads needing follow-up</h2>
              <div className="ops-card-actions">
                <Link href="/ops/leads" className="ops-btn ops-btn-sm">Pipeline</Link>
              </div>
            </div>
            {data.leadsNeedingFollowUp.length === 0 ? (
              <EmptyState
                title="Pipeline is clear"
                message="Every open lead has been actioned. New website submissions appear here within seconds."
                actionLabel="Add a lead manually"
                actionHref="/ops/leads/new"
              />
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead>
                    <tr><th>Name</th><th>Service</th><th>Stage</th><th>Received</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.leadsNeedingFollowUp.map(lead => (
                      <tr key={lead.id}>
                        <td data-label="Name" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/leads/${lead.id}`}>
                            {[lead.first_name, lead.last_name].filter(Boolean).join(' ')}
                          </Link>
                          {lead.phone && <span className="ops-sub2">{lead.phone}</span>}
                        </td>
                        <td data-label="Service">{lead.service_type ?? '—'}</td>
                        <td data-label="Stage">
                          <Badge tone={lead.pipeline_stage === 'new' ? 'info' : 'neutral'}>
                            {LEAD_STAGE_LABELS[lead.pipeline_stage as LeadStage] ?? lead.pipeline_stage}
                          </Badge>
                        </td>
                        <td data-label="Received" className="nowrap">{formatDate(lead.created_at)}</td>
                        <td className="ops-actions">
                          {lead.phone && (
                            <a className="ops-btn ops-btn-sm" href={`tel:${lead.phone.replace(/\D/g, '')}`}>Call</a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* --- Right rail ---------------------------------------------------- */}
        <div className="ops-stack">
          <section className="ops-card">
            <div className="ops-card-head"><h2>Readiness breakdown</h2></div>
            <div className="ops-card-body" style={{ display: 'grid', gap: 8 }}>
              {(Object.entries(data.readiness.byStatus) as [keyof typeof COMPLIANCE_LABELS, number][])
                .filter(([, n]) => n > 0)
                .map(([status, n]) => (
                  <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ComplianceBadge status={status} />
                    <strong style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{n}</strong>
                  </div>
                ))}
              {data.readiness.totalVendors === 0 && (
                <p className="ops-hint">
                  No subcontractors are assigned to live projects yet, so there is nothing to score.
                </p>
              )}
              <p className="ops-disclaimer">
                Documentation Readiness measures whether paperwork is complete, current and reviewed
                against the requirements configured in Settings. It is not a legal opinion or an
                insurance guarantee.
              </p>
            </div>
          </section>

          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Upcoming tasks</h2>
              <div className="ops-card-actions"><Link href="/ops/tasks" className="ops-btn ops-btn-sm">All tasks</Link></div>
            </div>
            <div className="ops-card-body">
              {data.upcomingTasks.length === 0 ? (
                <p className="ops-hint">No open tasks.</p>
              ) : (
                <ul style={{ display: 'grid', gap: 10 }}>
                  {data.upcomingTasks.map(t => (
                    <li key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <span style={{ flex: 1, fontSize: '.84rem', color: 'var(--ops-ink)' }}>{t.title}</span>
                      <span className="ops-hint nowrap">{t.due_date ? formatDate(t.due_date) : 'No date'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="ops-card">
            <div className="ops-card-head"><h2>Recent document uploads</h2></div>
            <div className="ops-card-body">
              {data.recentUploads.length === 0 ? (
                <p className="ops-hint">Nothing uploaded yet.</p>
              ) : (
                <ul style={{ display: 'grid', gap: 9 }}>
                  {data.recentUploads.map(d => (
                    <li key={d.id} style={{ fontSize: '.82rem' }}>
                      <strong style={{ display: 'block', color: 'var(--ops-ink)', fontWeight: 550 }}>
                        {d.original_filename}
                      </strong>
                      <span className="ops-hint">{formatDateTime(d.uploaded_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Recent activity</h2>
              <div className="ops-card-actions"><Link href="/ops/activity" className="ops-btn ops-btn-sm">Full log</Link></div>
            </div>
            <div className="ops-card-body">
              {data.recentActivity.length === 0 ? (
                <p className="ops-hint">No activity recorded yet.</p>
              ) : (
                <ul className="ops-timeline">
                  {data.recentActivity.map(a => (
                    <li key={a.id}>
                      <span className={`tl-dot${a.action.startsWith('coi') || a.action.startsWith('audit') ? ' accent' : ''}`} />
                      <span className="tl-body">
                        <strong>{ACTION_LABELS[a.action] ?? a.action}</strong>
                        <span>{formatDateTime(a.created_at)}{a.actor_label ? ` · ${a.actor_label}` : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function Kpi({
  label, value, foot, href, tone,
}: {
  label: string; value: number; foot?: string; href?: string; tone?: 'warn' | 'alert'
}) {
  const body = (
    <div className={`ops-kpi${tone === 'alert' ? ' is-alert' : tone === 'warn' ? ' is-warn' : ''}`}>
      <div className="ops-kpi-label">{label}</div>
      <div className="ops-kpi-value">{value}</div>
      {foot && <div className="ops-kpi-foot">{foot}</div>}
      {href && (
        <ArrowUpRight
          aria-hidden="true"
          style={{ position: 'absolute', top: 12, right: 12, width: 14, height: 14, color: 'var(--ops-faint)' }}
        />
      )}
    </div>
  )
  return href ? <Link href={href} aria-label={`${label}: ${value}`}>{body}</Link> : body
}

function partOfDay(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })
      .format(new Date()),
  )
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function MiniStat({
  label, value, foot, tone,
}: {
  label: string; value: string; foot?: string; tone?: 'alert'
}) {
  return (
    <div className={`ops-ministat${tone === 'alert' ? ' is-alert' : ''}`}>
      <span className="ops-ministat-label">{label}</span>
      <strong className="ops-ministat-value">{value}</strong>
      {foot && <span className="ops-ministat-foot">{foot}</span>}
    </div>
  )
}

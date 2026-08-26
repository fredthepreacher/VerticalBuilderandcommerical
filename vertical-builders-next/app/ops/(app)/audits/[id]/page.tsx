import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { buildAuditRows, getAuditCycle } from '@/lib/ops/services/audits'
import { COMPLIANCE_LABELS, COVERAGE_SHORT, type ComplianceStatus, type CoverageType } from '@/lib/ops/types'
import { formatDate, formatDateTime } from '@/lib/ops/utils/dates'
import { formatBytes } from '@/lib/ops/utils/files'
import { Badge, ComplianceBadge } from '@/components/ops/StatusBadge'
import AuditCycleForm, { type AuditCycleValues } from '@/components/ops/AuditCycleForm'
import GenerateAuditPackage from '@/components/ops/GenerateAuditPackage'

export const dynamic = 'force-dynamic'

const MATRIX: CoverageType[] = ['general_liability', 'workers_compensation', 'commercial_auto', 'umbrella']

export default async function AuditDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()

  const cycle = await getAuditCycle(supabase, params.id)
  if (!cycle) notFound()

  const [rows, { data: exports }] = await Promise.all([
    buildAuditRows(supabase, cycle),
    supabase.from('audit_exports')
      .select('id, generated_at, filename, size_bytes, snapshot_json, profiles:generated_by(full_name, email)')
      .eq('audit_cycle_id', params.id)
      .order('generated_at', { ascending: false }),
  ])

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.statusAtPeriodEnd] = (acc[row.statusAtPeriodEnd] ?? 0) + 1
    return acc
  }, {})

  const projects = Array.from(
    new Map(rows.flatMap(r => r.projects).map(p => [p.id, p])).values(),
  )
  const trades = Array.from(new Set(rows.map(r => r.vendor.primary_trade).filter(Boolean))) as string[]
  const totalPolicies = rows.reduce((n, r) => n + r.policiesInPeriod.length, 0)
  const totalDocuments = rows.reduce((n, r) => n + r.documents.length, 0)

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/audits">Audit Center</Link> / {cycle.name}</div>
          <h1>{cycle.name}</h1>
          <p className="ops-sub">
            Coverage that overlapped {formatDate(cycle.audit_period_start)} –{' '}
            {formatDate(cycle.audit_period_end)}. Status is evaluated as of the end of that window,
            which is the question an auditor is actually asking.
          </p>
        </div>
      </div>

      <div className="ops-kpis">
        <Kpi label="Subcontractors in scope" value={rows.length} />
        <Kpi label="Projects in scope" value={projects.length} />
        <Kpi label="Policy lines" value={totalPolicies} />
        <Kpi label="Documents on file" value={totalDocuments} />
        <Kpi label="Compliant at period end" value={counts.compliant ?? 0} />
        <Kpi label="Non-compliant / expired" value={counts.non_compliant ?? 0} tone="alert" />
        <Kpi label="Missing" value={counts.missing ?? 0} tone="alert" />
        <Kpi label="Needs review" value={counts.needs_review ?? 0} tone="warn" />
      </div>

      <div className="ops-columns">
        <div className="ops-card">
          <div className="ops-card-head">
            <h2>Who is in this audit</h2>
            <div className="ops-card-actions">
              <span className="ops-hint">{rows.length} subcontractor{rows.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="ops-card-body">
              <p className="ops-hint">
                No subcontractor was assigned to a project, or held coverage, during this window.
                Widen the period, or check that project assignment dates are recorded.
              </p>
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>Subcontractor</th><th>Trade</th><th>Projects</th>
                    {MATRIX.map(c => <th key={c}>{COVERAGE_SHORT[c]}</th>)}
                    <th>At period end</th><th>Today</th><th>Docs</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.vendor.id}>
                      <td data-label="Subcontractor" className="ops-cell-primary">
                        <Link className="ops-row-link" href={`/ops/subcontractors/${row.vendor.id}?tab=insurance`}>
                          {row.vendor.legal_name}
                        </Link>
                        {row.gaps.length > 0 && (
                          <span className="ops-sub2" style={{ color: 'var(--ops-bad)' }}>
                            {row.gaps.length} finding{row.gaps.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      <td data-label="Trade">{row.vendor.primary_trade ?? '—'}</td>
                      <td data-label="Projects">
                        {row.projects.length === 0 ? '—' : row.projects.map(p => p.project_number).join(', ')}
                      </td>
                      {MATRIX.map(coverage => {
                        const c = row.coverageSummary[coverage]
                        return (
                          <td key={coverage} data-label={COVERAGE_SHORT[coverage]}>
                            {c
                              ? <Badge tone={c.covered ? 'ok' : 'bad'} title={`${c.carrier ?? 'Carrier not recorded'} · ${c.effective ?? '?'} → ${c.expiration ?? '?'}`}>
                                  {c.covered ? 'Covered' : 'Gap'}
                                </Badge>
                              : <Badge tone="neutral">None</Badge>}
                          </td>
                        )
                      })}
                      <td data-label="At period end">
                        <ComplianceBadge status={row.statusAtPeriodEnd as ComplianceStatus} />
                      </td>
                      <td data-label="Today">
                        <span className="ops-hint">
                          {COMPLIANCE_LABELS[row.statusToday as ComplianceStatus] ?? row.statusToday}
                        </span>
                      </td>
                      <td data-label="Docs" className="num">{row.documents.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="ops-stack">
          {user.can('generateAuditPackage') && (
            <GenerateAuditPackage
              auditCycleId={cycle.id}
              projects={projects.map(p => ({ id: p.id, label: p.project_number }))}
              trades={trades}
            />
          )}

          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Export history</h2>
              <div className="ops-card-actions">
                <span className="ops-hint">Nothing is ever overwritten</span>
              </div>
            </div>
            <div className="ops-card-body">
              {(exports ?? []).length === 0 ? (
                <p className="ops-hint">No package generated yet.</p>
              ) : (
                <ul style={{ display: 'grid', gap: 12 }}>
                  {(exports ?? []).map(e => {
                    const who = (e as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles
                    const snapshot = (e.snapshot_json ?? {}) as { summary?: { vendorsIncluded?: number; documentsIncluded?: number } }
                    return (
                      <li key={e.id} style={{ borderBottom: '1px solid var(--ops-line)', paddingBottom: 10 }}>
                        <strong style={{ display: 'block', fontSize: '.82rem', color: 'var(--ops-ink)', wordBreak: 'break-all' }}>
                          {e.filename ?? 'Audit package'}
                        </strong>
                        <span className="ops-hint">
                          {formatDateTime(e.generated_at)} · {formatBytes(e.size_bytes as number | null)}
                          {who ? ` · ${who.full_name ?? who.email}` : ''}
                          {snapshot.summary?.vendorsIncluded !== undefined &&
                            ` · ${snapshot.summary.vendorsIncluded} subs, ${snapshot.summary.documentsIncluded ?? 0} docs`}
                        </span>
                        <a className="ops-btn ops-btn-sm" style={{ marginTop: 6 }}
                          href={`/api/audits/${e.id}/export`} rel="noopener">
                          <Download aria-hidden="true" /> Download
                        </a>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          {user.can('manageAuditCycles') && <AuditCycleForm cycle={cycle as AuditCycleValues} />}
        </div>
      </div>
    </>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'alert' }) {
  const highlight = value > 0 ? tone : undefined
  return (
    <div className={`ops-kpi${highlight === 'alert' ? ' is-alert' : highlight === 'warn' ? ' is-warn' : ''}`}>
      <div className="ops-kpi-label">{label}</div>
      <div className="ops-kpi-value">{value}</div>
    </div>
  )
}

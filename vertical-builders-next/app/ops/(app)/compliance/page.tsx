import Link from 'next/link'
import { FileUp } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { buildComplianceRegister, calculateReadiness } from '@/lib/ops/services/compliance'
import { getSettings } from '@/lib/ops/services/settings'
import {
  COMPLIANCE_DISCLAIMER, COMPLIANCE_LABELS, COMPLIANCE_STATUSES, COVERAGE_SHORT, TRADES,
  type ComplianceStatus, type CoverageType,
} from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'
import { Badge, ComplianceBadge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { RecalculateButton } from '@/components/ops/VendorActions'

export const dynamic = 'force-dynamic'

const MATRIX_COVERAGES: CoverageType[] = [
  'general_liability', 'workers_compensation', 'commercial_auto', 'umbrella',
]

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; trade?: string }
}) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)

  const rows = await buildComplianceRegister(supabase)
  const readiness = calculateReadiness(rows)

  const q = searchParams.q?.trim().toLowerCase()
  const filtered = rows.filter(row => {
    if (searchParams.status && row.evaluation.status !== searchParams.status) return false
    if (searchParams.trade && row.vendor.primary_trade !== searchParams.trade) return false
    if (q) {
      const haystack = [
        row.vendor.legal_name, row.vendor.dba, row.vendor.primary_trade,
        ...row.projects.map(p => `${p.project_number} ${p.project_name}`),
      ].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const filterHref = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    const merged = { q: searchParams.q, status: searchParams.status, trade: searchParams.trade, ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v)
    const s = sp.toString()
    return `/ops/compliance${s ? `?${s}` : ''}`
  }

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Compliance</div>
          <h1>Compliance register</h1>
          <p className="ops-sub">
            Every subcontractor, every required coverage, evaluated against the requirements
            configured in Settings. This is the screen to check before anyone gets scheduled.
          </p>
        </div>
        <div className="ops-page-actions">
          <RecalculateButton />
          <Link href="/ops/audits" className="ops-btn">Audit Center</Link>
          {user.can('uploadDocuments') && (
            <Link href="/ops/compliance/upload" className="ops-btn ops-btn-primary">
              <FileUp aria-hidden="true" /> Upload COI
            </Link>
          )}
        </div>
      </div>

      {/* Status filter strip — doubles as a summary */}
      <div className="ops-chips" style={{ marginBottom: 16 }}>
        <Link href={filterHref({ status: undefined })} className={`ops-chip ops-chip-link${!searchParams.status ? ' is-on' : ''}`}>
          All · {rows.length}
        </Link>
        {COMPLIANCE_STATUSES.map(status => (
          <Link
            key={status}
            href={filterHref({ status })}
            className={`ops-chip ops-chip-link${searchParams.status === status ? ' is-on' : ''}`}
          >
            {COMPLIANCE_LABELS[status]} · {readiness.byStatus[status]}
          </Link>
        ))}
      </div>

      <div className="ops-card">
        <form className="ops-toolbar" method="get" action="/ops/compliance" role="search">
          <div className="ops-search">
            <input type="search" name="q" defaultValue={searchParams.q ?? ''}
              placeholder="Subcontractor, trade or project…" aria-label="Search the compliance register"
              style={{ paddingLeft: 11 }} />
          </div>
          <select name="trade" defaultValue={searchParams.trade ?? ''} aria-label="Trade">
            <option value="">Trade: all</option>
            {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {searchParams.status && <input type="hidden" name="status" value={searchParams.status} />}
          <button type="submit" className="ops-btn ops-btn-sm">Apply</button>
          <a href="/ops/compliance" className="ops-btn ops-btn-ghost ops-btn-sm">Clear</a>
          <span className="ops-toolbar-count">
            {filtered.length} of {rows.length} · warning window {settings.warning_window_days} days
          </span>
        </form>

        {filtered.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? 'No subcontractors to evaluate yet' : 'Nothing matches those filters'}
            message={
              rows.length === 0
                ? 'Add subcontractors and upload their certificates — this register fills itself in from the policy lines you enter.'
                : 'Clear the filters to see the full register.'
            }
            actionLabel={rows.length === 0 ? 'Add a subcontractor' : undefined}
            actionHref={rows.length === 0 ? '/ops/subcontractors/new' : undefined}
          />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>Subcontractor</th>
                  <th>Trade</th>
                  <th>Project(s)</th>
                  <th>Overall</th>
                  {MATRIX_COVERAGES.map(c => <th key={c} title={c.replace(/_/g, ' ')}>{COVERAGE_SHORT[c]}</th>)}
                  <th>Earliest expiration</th>
                  <th>Last reviewed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.vendor.id}>
                    <td data-label="Subcontractor" className="ops-cell-primary">
                      <Link className="ops-row-link" href={`/ops/subcontractors/${row.vendor.id}?tab=insurance`}>
                        {row.vendor.legal_name}
                      </Link>
                      <span className="ops-sub2">{row.evaluation.summary}</span>
                    </td>
                    <td data-label="Trade">{row.vendor.primary_trade ?? '—'}</td>
                    <td data-label="Projects">
                      {row.projects.length === 0 ? '—' : row.projects.map(p => (
                        <Link key={p.id} href={`/ops/projects/${p.id}`} style={{ display: 'block', fontSize: '.79rem' }}>
                          {p.project_number}
                        </Link>
                      ))}
                    </td>
                    <td data-label="Overall"><ComplianceBadge status={row.evaluation.status} title={row.evaluation.summary} /></td>
                    {MATRIX_COVERAGES.map(coverage => {
                      const check = row.evaluation.checks.find(c => c.coverageType === coverage)
                      return (
                        <td key={coverage} data-label={COVERAGE_SHORT[coverage]}>
                          <CoverageCell status={check?.status} label={COVERAGE_SHORT[coverage]} />
                        </td>
                      )
                    })}
                    <td data-label="Earliest expiration" className="nowrap">
                      {row.evaluation.earliestExpiration ? formatDate(row.evaluation.earliestExpiration) : '—'}
                    </td>
                    <td data-label="Last reviewed" className="nowrap">
                      {row.vendor.last_reviewed_at ? formatDate(row.vendor.last_reviewed_at) : 'Never'}
                    </td>
                    <td className="ops-actions">
                      <Link className="ops-btn ops-btn-sm" href={`/ops/subcontractors/${row.vendor.id}?tab=insurance`}>
                        Review
                      </Link>
                      {user.can('uploadDocuments') && (
                        <Link className="ops-btn ops-btn-sm" href={`/ops/compliance/upload?vendor=${row.vendor.id}`}>
                          Upload
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="ops-disclaimer" style={{ marginTop: 16 }}>{COMPLIANCE_DISCLAIMER}</p>
    </>
  )
}

function CoverageCell({ status, label }: { status?: string; label: string }) {
  if (!status) return <Badge tone="neutral" title={`${label}: not required`}>n/a</Badge>
  switch (status) {
    case 'pass': return <Badge tone="ok" title={`${label}: meets requirements`}>OK</Badge>
    case 'warning': return <Badge tone="warn" title={`${label}: needs attention`}>Watch</Badge>
    case 'fail': return <Badge tone="bad" title={`${label}: fails requirements`}>Fail</Badge>
    case 'missing': return <Badge tone="bad" title={`${label}: nothing on file`}>None</Badge>
    case 'waived': return <Badge tone="neutral" title={`${label}: documented exception`}>Waived</Badge>
    default: return <Badge tone="neutral">{status as ComplianceStatus}</Badge>
  }
}

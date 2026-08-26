import Link from 'next/link'
import { FileArchive } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { defaultAuditPeriod, formatDate } from '@/lib/ops/utils/dates'
import { Badge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import AuditCycleForm from '@/components/ops/AuditCycleForm'
import AuditBriefPanel from '@/components/ops/AuditBriefPanel'
import { isOpsAiConfigured } from '@/lib/ops/ai/provider'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'info' | 'neutral'> = {
  draft: 'neutral', preparing: 'warn', ready: 'info', submitted: 'ok', closed: 'neutral',
}

export default async function AuditsPage() {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()

  const { data: cycles } = await supabase
    .from('audit_cycles')
    .select('*, audit_exports(id, generated_at, filename)')
    .order('audit_period_end', { ascending: false })

  const suggested = defaultAuditPeriod()
  const latest = (cycles ?? [])[0] as { audit_period_start?: string; audit_period_end?: string } | undefined
  const briefPeriod = latest?.audit_period_start && latest?.audit_period_end
    ? { start: latest.audit_period_start, end: latest.audit_period_end }
    : suggested

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Compliance</div>
          <h1>Audit Center</h1>
          <p className="ops-sub">
            Prepare a six-month insurance audit without digging through email or folders. Pick a
            period, review who was on the jobs, and generate one organized ZIP.
          </p>
        </div>
      </div>

      <div className="ops-columns">
        <div className="ops-card">
          <div className="ops-card-head"><h2>Audit cycles</h2></div>
          {(cycles ?? []).length === 0 ? (
            <EmptyState
              title="No audit cycles yet"
              message="Create one for the period you are being audited on. Vertical Ops works out which subcontractors and certificates were relevant to that window."
              icon={<FileArchive aria-hidden="true" />}
            />
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr><th>Audit</th><th>Period</th><th>Due</th><th>Status</th><th>Exports</th><th /></tr>
                </thead>
                <tbody>
                  {(cycles ?? []).map(c => {
                    const exports = (c.audit_exports ?? []) as { id: string; generated_at: string }[]
                    return (
                      <tr key={c.id}>
                        <td data-label="Audit" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/audits/${c.id}`}>{c.name}</Link>
                        </td>
                        <td data-label="Period" className="nowrap">
                          {formatDate(c.audit_period_start)} → {formatDate(c.audit_period_end)}
                        </td>
                        <td data-label="Due" className="nowrap">{c.due_date ? formatDate(c.due_date) : '—'}</td>
                        <td data-label="Status">
                          <Badge tone={STATUS_TONE[c.status as string] ?? 'neutral'}>{cap(c.status as string)}</Badge>
                        </td>
                        <td data-label="Exports">
                          {exports.length === 0 ? 'None yet' : `${exports.length} generated`}
                        </td>
                        <td className="ops-actions">
                          <Link className="ops-btn ops-btn-sm" href={`/ops/audits/${c.id}`}>Open</Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="ops-stack">
          {user.can('manageAuditCycles') ? (
            <AuditCycleForm defaultStart={suggested.start} defaultEnd={suggested.end} />
          ) : (
            <div className="ops-card">
              <div className="ops-card-body">
                <p className="ops-hint">
                  Your role can view audit cycles and download packages, but not create them.
                </p>
              </div>
            </div>
          )}

          {user.can('generateAuditPackage') && (
            <AuditBriefPanel configured={isOpsAiConfigured()} period={briefPeriod} />
          )}

          <section className="ops-card">
            <div className="ops-card-head"><h2>What ends up in the package</h2></div>
            <div className="ops-card-body" style={{ fontSize: '.84rem' }}>
              <pre style={{ fontSize: '.72rem', lineHeight: 1.7, overflowX: 'auto', color: 'var(--ops-body)' }}>{`00_Audit_Summary.pdf
01_Compliance_Register.xlsx
02_Compliance_Register.csv
03_Missing_Expired_Exceptions.csv
04_Activity_Log.csv
05_Subcontractors/
   ABC_Roofing/
      Vendor_Summary.txt
      Certificate_of_Insurance_…pdf
      W-9_…pdf
      Contractor_License_…pdf`}</pre>
              <p className="ops-hint" style={{ marginTop: 12 }}>
                A policy is included when it overlapped the period —{' '}
                <code>effective ≤ period end AND expiration ≥ period start</code> — not merely when
                it is valid today. Compliance is evaluated as of the end of the audit window.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

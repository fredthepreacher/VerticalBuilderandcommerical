import Link from 'next/link'
import { Radar, Upload, Plus, Settings2, ClipboardCheck, Boxes } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { formatDateTime } from '@/lib/ops/utils/dates'
import { EmptyState } from '@/components/ops/EmptyState'
import { Badge } from '@/components/ops/StatusBadge'
import { listCampaigns } from '@/lib/ops/prospecting/campaigns'
import { listBatches } from '@/lib/ops/prospecting/prospects'
import { prospectingOverview } from '@/lib/ops/prospecting/prospects'
import { reviewCounts } from '@/lib/ops/prospecting/review-queue'

export const dynamic = 'force-dynamic'

const BATCH_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  completed: 'ok', completed_with_errors: 'warn', importing: 'info', validating: 'info',
  pending: 'neutral', failed: 'bad', cancelled: 'neutral',
}

export default async function ProspectingPage() {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return (
      <EmptyState title="You do not have access to this"
        message="Roof prospecting is limited to owner/admin and office roles."
        actionLabel="Back to dashboard" actionHref="/ops/dashboard" />
    )
  }

  const supabase = createSupabaseServerClient()
  const [campaigns, batches, overview, counts] = await Promise.all([
    listCampaigns(supabase),
    listBatches(supabase, 8),
    prospectingOverview(supabase),
    reviewCounts(supabase),
  ])

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Sales / Roof Prospecting</div>
          <h1>Roof Prospecting</h1>
          <p className="ops-sub">
            Turn county roofing-permit spreadsheets into screened, measurable, estimate-ready
            prospects. Imported records stay prospects until you qualify them — they never become
            CRM leads on their own.
          </p>
        </div>
        <div className="ops-page-actions">
          <Link className="ops-btn ops-btn-primary" href="/ops/prospecting/review"><ClipboardCheck aria-hidden="true" /> Review queue</Link>
          <Link className="ops-btn" href="/ops/prospecting/production"><Boxes aria-hidden="true" /> Production</Link>
          <Link className="ops-btn" href="/ops/prospecting/import"><Upload aria-hidden="true" /> Import county list</Link>
          <Link className="ops-btn" href="/ops/prospecting/campaigns/new"><Plus aria-hidden="true" /> New campaign</Link>
          <Link className="ops-btn" href="/ops/prospecting/campaigns"><Settings2 aria-hidden="true" /> Campaigns</Link>
        </div>
      </div>

      <div className="ops-kpi-row" style={{ marginBottom: 18 }}>
        <div className="ops-kpi"><div className="ops-kpi-label">Prospects</div><div className="ops-kpi-value">{overview.totalProspects.toLocaleString()}</div></div>
        <Link href="/ops/prospecting/review?status=review_required" className="ops-kpi is-warn"><div className="ops-kpi-label">Needs review</div><div className="ops-kpi-value">{counts.needsReview.toLocaleString()}</div></Link>
        <Link href="/ops/prospecting/review?status=manual_measurement_required" className="ops-kpi is-warn"><div className="ops-kpi-label">Manual measurement</div><div className="ops-kpi-value">{counts.manualMeasurement.toLocaleString()}</div></Link>
        <Link href="/ops/prospecting/review?status=qualified" className="ops-kpi is-ok"><div className="ops-kpi-label">Approved</div><div className="ops-kpi-value">{counts.approved.toLocaleString()}</div></Link>
        <Link href="/ops/prospecting/review?status=rejected" className="ops-kpi"><div className="ops-kpi-label">Rejected</div><div className="ops-kpi-value">{counts.rejected.toLocaleString()}</div></Link>
        <div className="ops-kpi"><div className="ops-kpi-label">CRM leads</div><div className="ops-kpi-value">{counts.crmCreated.toLocaleString()}</div></div>
        <Link href="/ops/prospecting/production" className="ops-kpi is-ok"><div className="ops-kpi-label">Estimates ready</div><div className="ops-kpi-value">{counts.estimateReady.toLocaleString()}</div></Link>
        <Link href="/ops/prospecting/review?status=pricing_configuration_required" className={`ops-kpi${counts.pricingBlocked ? ' is-alert' : ''}`}><div className="ops-kpi-label">Blocked by pricing</div><div className="ops-kpi-value">{counts.pricingBlocked.toLocaleString()}</div></Link>
      </div>

      <div className="ops-card" style={{ marginBottom: 18 }}>
        <div className="ops-card-head"><h2>Active campaigns</h2><Link className="ops-btn ops-btn-sm" href="/ops/prospecting/campaigns">Manage</Link></div>
        {campaigns.length === 0 ? (
          <div className="ops-card-body"><p className="ops-hint">No campaigns yet. Create one to set roof-type filters, waste rules and pricing for a county.</p></div>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead><tr><th>Campaign</th><th>County</th><th>Roof types</th><th>Waste</th><th /></tr></thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td data-label="Campaign" className="ops-cell-primary">{c.name}</td>
                    <td data-label="County">{c.county ?? '—'}</td>
                    <td data-label="Roof types">{c.roof_types.length ? c.roof_types.join(', ') : 'All'}</td>
                    <td data-label="Waste">{describeWaste(c.waste_rule_type, c.waste_rule_value)}</td>
                    <td className="ops-actions"><Link className="ops-btn ops-btn-sm" href={`/ops/prospecting/campaigns/${c.id}`}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ops-card">
        <div className="ops-card-head"><h2>Import batches</h2></div>
        {batches.length === 0 ? (
          <div className="ops-card-body">
            <EmptyState icon={<Radar aria-hidden="true" />} title="No imports yet"
              message="Upload a county permit CSV to create your first batch."
              actionLabel="Import county list" actionHref="/ops/prospecting/import" />
          </div>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>File</th><th>Campaign</th><th>When</th><th className="num">Rows</th>
                  <th className="num">Imported</th><th className="num">Review</th><th className="num">Dupes</th>
                  <th className="num">Rejected</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id}>
                    <td data-label="File" className="ops-cell-primary">{b.original_filename}</td>
                    <td data-label="Campaign">{b.campaign_name ?? (b.county ?? '—')}</td>
                    <td data-label="When" className="nowrap">{formatDateTime(b.created_at)}</td>
                    <td data-label="Rows" className="num">{b.counts.totalRows.toLocaleString()}</td>
                    <td data-label="Imported" className="num">{b.counts.imported.toLocaleString()}</td>
                    <td data-label="Review" className="num">{b.counts.needsReview.toLocaleString()}</td>
                    <td data-label="Dupes" className="num">{b.counts.duplicates.toLocaleString()}</td>
                    <td data-label="Rejected" className="num">{b.counts.rejected.toLocaleString()}</td>
                    <td data-label="Status">
                      <Badge tone={BATCH_TONE[b.status] ?? 'neutral'}>{b.status.replace(/_/g, ' ')}</Badge>
                      {b.status_reason && <span className="ops-sub2">{b.status_reason}</span>}
                    </td>
                    <td className="ops-actions"><Link className="ops-btn ops-btn-sm" href={`/ops/prospecting/batches/${b.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function describeWaste(type: string, value: number | null): string {
  if (type === 'percent') return value != null ? `+${value}%` : '+%'
  if (type === 'fixed_squares') return value != null ? `+${value} sq` : '+ sq'
  if (type === 'minimum') return value != null ? `min ${value} sq` : 'min'
  return 'none'
}

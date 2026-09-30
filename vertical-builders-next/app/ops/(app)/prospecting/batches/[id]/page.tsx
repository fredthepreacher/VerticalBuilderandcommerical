import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { formatDateTime } from '@/lib/ops/utils/dates'
import { EmptyState } from '@/components/ops/EmptyState'
import { Badge } from '@/components/ops/StatusBadge'
import { loadBatch, listProspectsForBatch } from '@/lib/ops/prospecting/prospects'
import { buildEnrichmentPanel } from '@/lib/ops/prospecting/enrich-service'
import EnrichBatchButton from '@/components/ops/EnrichBatchButton'
import { PROSPECT_STATUS_LABELS, type ProspectStatus } from '@/lib/ops/prospecting/constants'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Partial<Record<ProspectStatus, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'>> = {
  imported: 'neutral', review_required: 'warn', qualified: 'ok',
  disqualified_new_roof: 'bad', disqualified_wrong_roof_type: 'bad', disqualified_bad_address: 'bad',
  manual_measurement_required: 'warn', crm_created: 'info', estimate_ready: 'info',
  mailed: 'ok', sold: 'ok', duplicate: 'neutral',
}

export default async function BatchDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return <EmptyState title="You do not have access to this"
      message="Roof prospecting is limited to owner/admin and office roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }
  const supabase = createSupabaseServerClient()
  const batch = await loadBatch(supabase, params.id)
  if (!batch) notFound()
  const [prospects, panel] = await Promise.all([
    listProspectsForBatch(supabase, params.id),
    buildEnrichmentPanel(supabase, params.id),
  ])
  const c = batch.counts

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting">Roof Prospecting</Link> / Batch</div>
          <h1>{batch.original_filename}</h1>
          <p className="ops-sub">
            {batch.campaign_name ? <>Campaign: {batch.campaign_name} · </> : null}
            {batch.county ? <>{batch.county} · </> : null}
            Imported {formatDateTime(batch.created_at)}
          </p>
        </div>
        <div className="ops-page-actions">
          {(batch.failed_rows > 0 || batch.skipped_rows > 0) && (
            <a className="ops-btn" href={`/api/leads/import/${batch.id}?format=csv`}>Error report</a>
          )}
        </div>
      </div>

      <div className="ops-kpi-row" style={{ marginBottom: 18 }}>
        <div className="ops-kpi"><div className="ops-kpi-label">Rows</div><div className="ops-kpi-value">{c.totalRows.toLocaleString()}</div></div>
        <div className="ops-kpi is-ok"><div className="ops-kpi-label">Imported</div><div className="ops-kpi-value">{c.imported.toLocaleString()}</div></div>
        <div className="ops-kpi is-warn"><div className="ops-kpi-label">Needs review</div><div className="ops-kpi-value">{c.needsReview.toLocaleString()}</div></div>
        <div className="ops-kpi"><div className="ops-kpi-label">Duplicates</div><div className="ops-kpi-value">{c.duplicates.toLocaleString()}</div></div>
        <div className={`ops-kpi${c.rejected ? ' is-alert' : ''}`}><div className="ops-kpi-label">Rejected</div><div className="ops-kpi-value">{c.rejected.toLocaleString()}</div></div>
        <div className="ops-kpi is-ok"><div className="ops-kpi-label">Qualified</div><div className="ops-kpi-value">{c.qualified.toLocaleString()}</div></div>
      </div>

      <div className="ops-card" style={{ marginBottom: 18 }}>
        <div className="ops-card-head"><h2>Enrichment &amp; screening</h2></div>
        <div className="ops-card-body">
          <div className="ops-prospect-tiles" style={{ marginBottom: 14 }}>
            <ProviderBadge label="Measurement" name={panel.providers.measurement.displayName} configured={panel.providers.measurement.configured} action={panel.providers.measurement.action} />
            <ProviderBadge label="Geocoder" name={panel.providers.geocoder.displayName} configured={panel.providers.geocoder.configured} action={panel.providers.geocoder.action} />
          </div>
          <div className="ops-banner neutral" role="status" style={{ marginBottom: 14 }}>
            <div>
              <strong>Provider cost</strong>
              {panel.cost.message}
            </div>
          </div>
          <EnrichBatchButton sourceBatchId={params.id} pending={panel.pending} />
        </div>
      </div>

      <div className="ops-card">
        <div className="ops-card-head"><h2>Prospects</h2><span className="ops-sub2">{prospects.length.toLocaleString()} shown</span></div>
        {prospects.length === 0 ? (
          <div className="ops-card-body"><p className="ops-hint">No prospects were written for this batch.</p></div>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>Property</th><th>Owner</th><th>Mailing</th><th>Parcel</th>
                  <th>Permit</th><th>Roof</th><th className="num">Sq</th><th>Confidence</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map(p => (
                  <tr key={p.id}>
                    <td data-label="Property" className="ops-cell-primary">
                      {p.property_address ?? '—'}
                      <span className="ops-sub2">{[p.city, p.state, p.zip].filter(Boolean).join(' ')}</span>
                    </td>
                    <td data-label="Owner">{p.owner_name ?? '—'}</td>
                    <td data-label="Mailing">{p.mailing_address ?? <span className="ops-faint">same</span>}</td>
                    <td data-label="Parcel">{p.parcel_apn ?? '—'}</td>
                    <td data-label="Permit">
                      {p.permit_number ?? '—'}
                      {p.permit_date && <span className="ops-sub2">{p.permit_date}</span>}
                    </td>
                    <td data-label="Roof">{p.roof_type ?? '—'}</td>
                    <td data-label="Sq" className="num">{p.final_squares != null ? p.final_squares : '—'}</td>
                    <td data-label="Confidence">{p.confidence_band ? <Badge tone={p.confidence_band === 'high' ? 'ok' : p.confidence_band === 'medium' ? 'warn' : 'neutral'}>{p.confidence_band}</Badge> : '—'}</td>
                    <td data-label="Status">
                      <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{PROSPECT_STATUS_LABELS[p.status] ?? p.status}</Badge>
                      {p.screening_reason && <span className="ops-sub2">{p.screening_reason}</span>}
                    </td>
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

function ProviderBadge({ label, name, configured, action }: { label: string; name: string; configured: boolean; action: string }) {
  return (
    <div className="ops-ministat" title={action}>
      <div className="ops-kpi-label">{label}</div>
      <div style={{ fontWeight: 650, fontSize: '.9rem' }}>{name}</div>
      <Badge tone={configured ? 'ok' : 'neutral'}>{configured ? 'Configured' : 'Not configured'}</Badge>
    </div>
  )
}

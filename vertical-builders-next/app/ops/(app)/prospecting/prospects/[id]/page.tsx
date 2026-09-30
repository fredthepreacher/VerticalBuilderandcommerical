import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import { Badge } from '@/components/ops/StatusBadge'
import { formatDateTime } from '@/lib/ops/utils/dates'
import RecordResponseButton from '@/components/ops/RecordResponseButton'
import { prospectTimeline } from '@/lib/ops/prospecting/analytics'
import { PROSPECT_STATUS_LABELS, type ProspectStatus } from '@/lib/ops/prospecting/constants'

export const dynamic = 'force-dynamic'

/**
 * A single prospect's acquisition journey — imported → screened → approved →
 * lead → estimate → proposal → mailed → responded → (CRM: appointment → sold).
 * The timeline is reconstructed from the activity log, not a duplicate event
 * table (spec §21).
 */
export default async function ProspectDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('analyticsView')) {
    return <EmptyState title="You do not have access to this"
      message="Prospect detail is limited to staff roles." actionLabel="Back" actionHref="/ops/prospecting" />
  }

  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('roof_prospects')
    .select(`id, status, owner_name, property_address, city, state, zip, mailing_address, final_squares,
             converted_lead_id, estimate_id,
             prospecting_campaigns(name, county)`)
    .eq('id', params.id).maybeSingle()
  if (!data) notFound()

  const p = data as Record<string, unknown>
  const campaign = (Array.isArray(p.prospecting_campaigns) ? p.prospecting_campaigns[0] : p.prospecting_campaigns) as Record<string, unknown> | null
  const timeline = await prospectTimeline(supabase, params.id)
  const isMailed = ['mailed', 'document_ready', 'printed'].includes(p.status as string) || Boolean(p.converted_lead_id)

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/prospecting">Roof Prospecting</Link> / <Link href="/ops/prospecting/analytics">Analytics</Link> / Prospect
          </div>
          <h1>{(p.property_address as string) ?? 'Prospect'}</h1>
          <p className="ops-sub">
            <Badge tone="neutral">{PROSPECT_STATUS_LABELS[p.status as ProspectStatus] ?? (p.status as string)}</Badge>
            {campaign?.name ? ` · ${campaign.name as string}` : ''}{campaign?.county ? ` · ${campaign.county as string}` : ''}
          </p>
        </div>
        {user.can('recordResponse') && isMailed && (
          <div className="ops-page-actions"><RecordResponseButton prospectId={params.id} /></div>
        )}
      </div>

      <div className="ops-analytics-grid">
        <div className="ops-card">
          <div className="ops-card-head"><h2>Property</h2></div>
          <div className="ops-card-body">
            <dl className="ops-metric-list">
              <div><dt>Owner</dt><dd>{(p.owner_name as string) ?? '—'}</dd></div>
              <div><dt>Property</dt><dd>{[(p.property_address as string), [p.city, p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</dd></div>
              <div><dt>Mailing</dt><dd>{(p.mailing_address as string) ?? '—'}</dd></div>
              <div><dt>Final squares</dt><dd>{(p.final_squares as number) ?? '—'}</dd></div>
              <div><dt>CRM lead</dt><dd>{p.converted_lead_id ? <Link href={`/ops/leads/${p.converted_lead_id as string}`}>View lead</Link> : '—'}</dd></div>
              <div><dt>Estimate</dt><dd>{p.estimate_id ? <Link href={`/ops/estimates/${p.estimate_id as string}`}>View estimate</Link> : '—'}</dd></div>
            </dl>
          </div>
        </div>

        <div className="ops-card">
          <div className="ops-card-head"><h2>Timeline</h2></div>
          <div className="ops-card-body">
            {timeline.length === 0 ? <p className="ops-hint">No events yet.</p> : (
              <ol className="ops-timeline">
                {timeline.map((e, i) => (
                  <li key={i}>
                    <span className="ops-timeline-when">{formatDateTime(e.at)}</span>
                    <span className="ops-timeline-label">{e.label}{e.detail ? ` — ${e.detail}` : ''}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

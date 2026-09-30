import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import ReviewConsole from '@/components/ops/ReviewConsole'
import ConvertApprovedButton from '@/components/ops/ConvertApprovedButton'
import { reviewCounts, listReviewQueue } from '@/lib/ops/prospecting/review-queue'
import { PROSPECT_STATUS_LABELS } from '@/lib/ops/prospecting/constants'

export const dynamic = 'force-dynamic'

const TABS: { key: string; label: string; countKey: keyof Awaited<ReturnType<typeof reviewCounts>> }[] = [
  { key: 'review_required', label: 'Needs review', countKey: 'needsReview' },
  { key: 'manual_measurement_required', label: 'Manual measurement', countKey: 'manualMeasurement' },
  { key: 'follow_up', label: 'Follow-up', countKey: 'followUp' },
  { key: 'qualified', label: 'Approved', countKey: 'approved' },
  { key: 'pricing_configuration_required', label: 'Pricing blocked', countKey: 'pricingBlocked' },
  { key: 'rejected', label: 'Rejected', countKey: 'rejected' },
]

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: { status?: string; campaign?: string; batch?: string }
}) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return <EmptyState title="You do not have access to this"
      message="Roof prospect review is limited to owner/admin and office roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }
  const status = searchParams.status ?? 'review_required'
  const scope = { campaignId: searchParams.campaign ?? null, batchId: searchParams.batch ?? null }

  const supabase = createSupabaseServerClient()
  const [counts, queue] = await Promise.all([
    reviewCounts(supabase, scope),
    listReviewQueue(supabase, { ...scope, status, limit: 50 }),
  ])

  const qs = (s: string) => {
    const params = new URLSearchParams()
    params.set('status', s)
    if (scope.campaignId) params.set('campaign', scope.campaignId)
    if (scope.batchId) params.set('batch', scope.batchId)
    return `?${params.toString()}`
  }

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting">Roof Prospecting</Link> / Review</div>
          <h1>Rapid Roof Review</h1>
          <p className="ops-sub">Work the queue with the keyboard — a decision saves and advances to the next property. Approved prospects convert to CRM leads and estimates.</p>
        </div>
      </div>

      <div className="ops-review-tabs" role="tablist">
        {TABS.map(t => (
          <Link key={t.key} href={qs(t.key)} role="tab" aria-selected={status === t.key}
            className={`ops-review-tab${status === t.key ? ' is-active' : ''}`}>
            {t.label} <span className="ops-review-tab-n">{counts[t.countKey]}</span>
          </Link>
        ))}
      </div>

      {status === 'qualified' ? (
        <div className="ops-card">
          <div className="ops-card-head"><h2>Approved — convert to CRM</h2></div>
          <div className="ops-card-body">
            <p className="ops-hint" style={{ marginBottom: 12 }}>
              {counts.approved} approved prospect{counts.approved === 1 ? '' : 's'}. Converting creates a CRM lead and, where a
              measurement and an active price book item exist, a draft estimate using the final billable squares.
              Converting is idempotent — running it again never duplicates a lead or estimate.
            </p>
            <ConvertApprovedButton campaignId={scope.campaignId} batchId={scope.batchId} pending={counts.approved} />
            {queue.length > 0 && (
              <div className="ops-table-wrap" style={{ marginTop: 16 }}>
                <table className="ops-table ops-table-cards">
                  <thead><tr><th>Property</th><th className="num">Final sq</th><th>Confidence</th><th>Lead</th><th>Estimate</th></tr></thead>
                  <tbody>
                    {queue.map(p => (
                      <tr key={p.id}>
                        <td className="ops-cell-primary" data-label="Property">{p.property_address ?? '—'}<span className="ops-sub2">{[p.city, p.state, p.zip].filter(Boolean).join(' ')}</span></td>
                        <td className="num" data-label="Final sq">{p.final_squares ?? '—'}</td>
                        <td data-label="Confidence">{p.confidence_band ?? '—'}</td>
                        <td data-label="Lead">{p.converted_lead_id ? <Link href={`/ops/leads/${p.converted_lead_id}`}>View</Link> : '—'}</td>
                        <td data-label="Estimate">{p.estimate_id ? <Link href={`/ops/estimates/${p.estimate_id}`}>View</Link> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : ['review_required', 'manual_measurement_required', 'follow_up'].includes(status) ? (
        queue.length === 0
          ? <EmptyState title={`Nothing in "${PROSPECT_STATUS_LABELS[status as keyof typeof PROSPECT_STATUS_LABELS] ?? status}"`}
              message="Import and run screening on a batch to fill this queue, or pick another tab." actionLabel="Back" actionHref="/ops/prospecting" />
          : <ReviewConsole prospects={queue} canMeasure={user.can('measurementsCreate')} />
      ) : (
        <div className="ops-card">
          <div className="ops-card-head"><h2>{TABS.find(t => t.key === status)?.label ?? status}</h2></div>
          {queue.length === 0 ? <div className="ops-card-body"><p className="ops-hint">Nothing here.</p></div> : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead><tr><th>Property</th><th>Status</th><th>Reason</th></tr></thead>
                <tbody>
                  {queue.map(p => (
                    <tr key={p.id}>
                      <td className="ops-cell-primary" data-label="Property">{p.property_address ?? '—'}<span className="ops-sub2">{[p.city, p.state, p.zip].filter(Boolean).join(' ')}</span></td>
                      <td data-label="Status">{PROSPECT_STATUS_LABELS[p.status] ?? p.status}</td>
                      <td data-label="Reason">{p.screening_reason ?? p.review_note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

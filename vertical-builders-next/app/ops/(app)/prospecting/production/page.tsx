import Link from 'next/link'
import { Boxes } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import { Badge } from '@/components/ops/StatusBadge'
import { formatDateTime } from '@/lib/ops/utils/dates'
import ProductionQueue, { type QueueRow } from '@/components/ops/ProductionQueue'
import { productionCounts, listProductionQueue } from '@/lib/ops/prospecting/production'
import { listMailBatches } from '@/lib/ops/prospecting/mail-batch-read'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  draft: 'neutral', generating: 'info', ready: 'ok', partial: 'warn',
  exported: 'info', printed: 'info', mailed: 'ok', cancelled: 'neutral', error: 'bad',
}

export default async function ProductionPage({
  searchParams,
}: { searchParams: { campaign?: string; readiness?: string } }) {
  const user = await requireUser()
  if (!user.can('productionView')) {
    return <EmptyState title="You do not have access to this"
      message="The mail production center is limited to staff roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }

  const campaignId = searchParams.campaign ?? null
  const supabase = createSupabaseServerClient()

  const [counts, queue, batches, campaign] = await Promise.all([
    productionCounts(supabase, { campaignId }),
    listProductionQueue(supabase, { campaignId, readiness: 'all', limit: 150 }),
    listMailBatches(supabase, { campaignId, limit: 50 }),
    campaignId
      ? supabase.from('prospecting_campaigns').select('default_batch_size').eq('id', campaignId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const defaultBatchSize = ((campaign as { data: { default_batch_size?: number } | null }).data?.default_batch_size) ?? 60

  const rows: QueueRow[] = queue.rows.map(r => ({
    prospectId: r.prospectId,
    recipientName: r.recipientName,
    propertyAddress: r.propertyAddress,
    cityStateZip: [r.city, r.state, r.zip].filter(Boolean).join(' '),
    mailingAddress: r.eligibility.mailingAddressUsed,
    mailingFallback: r.eligibility.mailingFallback,
    finalSquares: r.finalSquares,
    estimateTotal: r.estimateTotalCents != null ? (r.estimateTotalCents / 100).toFixed(2) : '',
    code: r.eligibility.code,
    reason: r.eligibility.reason,
    ready: r.eligibility.ready,
  }))

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting">Roof Prospecting</Link> / Production</div>
          <h1>Mail Production Center</h1>
          <p className="ops-sub">
            Turn reviewed, priced, estimate-ready prospects into controlled outbound mail batches —
            proposals generated, packaged, and tracked from printed to mailed. A $0-priced estimate is
            never mailed.
          </p>
        </div>
      </div>

      <div className="ops-kpi-row" style={{ marginBottom: 18 }}>
        <div className="ops-kpi is-ok"><div className="ops-kpi-label">Ready for production</div><div className="ops-kpi-value">{counts.readyForProduction.toLocaleString()}</div></div>
        <Link href="/ops/prospecting/review?status=pricing_configuration_required" className={`ops-kpi${counts.blockedByPricing ? ' is-alert' : ''}`}><div className="ops-kpi-label">Blocked by pricing</div><div className="ops-kpi-value">{counts.blockedByPricing.toLocaleString()}</div></Link>
        <Link href="/ops/prospecting/review?status=manual_measurement_required" className={`ops-kpi${counts.blockedByMeasurement ? ' is-warn' : ''}`}><div className="ops-kpi-label">Blocked by measurement</div><div className="ops-kpi-value">{counts.blockedByMeasurement.toLocaleString()}</div></Link>
        <div className="ops-kpi"><div className="ops-kpi-label">Proposal ready</div><div className="ops-kpi-value">{counts.proposalReady.toLocaleString()}</div></div>
        <div className="ops-kpi"><div className="ops-kpi-label">In a batch</div><div className="ops-kpi-value">{counts.inPrintBatch.toLocaleString()}</div></div>
        <div className="ops-kpi"><div className="ops-kpi-label">Printed</div><div className="ops-kpi-value">{counts.printed.toLocaleString()}</div></div>
        <div className="ops-kpi is-ok"><div className="ops-kpi-label">Mailed</div><div className="ops-kpi-value">{counts.mailed.toLocaleString()}</div></div>
        <div className={`ops-kpi${counts.failed ? ' is-alert' : ''}`}><div className="ops-kpi-label">Failed items</div><div className="ops-kpi-value">{counts.failed.toLocaleString()}</div></div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <ProductionQueue rows={rows} campaignId={campaignId} defaultBatchSize={defaultBatchSize} canCreate={user.can('mailBatchCreate')} />
      </div>

      <div className="ops-card">
        <div className="ops-card-head"><h2>Mail batches</h2></div>
        {batches.length === 0 ? (
          <div className="ops-card-body">
            <EmptyState icon={<Boxes aria-hidden="true" />} title="No mail batches yet"
              message="Select ready prospects above and create your first batch." />
          </div>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>Batch</th><th>Campaign</th><th>When</th><th className="num">Records</th>
                  <th className="num">Generated</th><th className="num">Blocked</th><th className="num">Failed</th>
                  <th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id}>
                    <td className="ops-cell-primary" data-label="Batch">{b.name}{b.mailTag && <span className="ops-sub2">{b.mailTag}</span>}</td>
                    <td data-label="Campaign">{b.campaignName ?? '—'}</td>
                    <td data-label="When" className="nowrap">{formatDateTime(b.createdAt)}</td>
                    <td data-label="Records" className="num">{b.recordCount}</td>
                    <td data-label="Generated" className="num">{b.generatedCount}</td>
                    <td data-label="Blocked" className="num">{b.blockedCount}</td>
                    <td data-label="Failed" className="num">{b.failedCount}</td>
                    <td data-label="Status"><Badge tone={STATUS_TONE[b.status] ?? 'neutral'}>{b.status}</Badge></td>
                    <td className="ops-actions"><Link className="ops-btn ops-btn-sm" href={`/ops/prospecting/production/${b.id}`}>Open</Link></td>
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

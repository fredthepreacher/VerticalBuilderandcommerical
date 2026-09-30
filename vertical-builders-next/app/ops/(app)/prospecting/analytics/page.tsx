import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import FunnelBars from '@/components/ops/FunnelBars'
import AddCampaignCostForm from '@/components/ops/AddCampaignCostForm'
import { formatCents } from '@/lib/ops/utils/money'
import {
  campaignFunnels, batchFunnels, campaignCosts, responseAnalytics, type CampaignFunnelRow,
} from '@/lib/ops/prospecting/analytics'
import {
  computeRates, summarizeRevenue, computeCostMetrics, funnelStages, formatRate, addCounts, ZERO_COUNTS,
  type FunnelCounts,
} from '@/lib/ops/prospecting/analytics-metrics'

export const dynamic = 'force-dynamic'

const RANGES: { key: string; label: string }[] = [
  { key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' },
  { key: 'ytd', label: 'Year to date' }, { key: 'all', label: 'All time' },
]

function resolveRange(key: string): { from: string | null; to: string | null } {
  const now = new Date()
  if (key === 'all') return { from: null, to: null }
  if (key === 'ytd') return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to: null }
  const days = Number(key)
  if (Number.isFinite(days) && days > 0) {
    return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: null }
  }
  return { from: null, to: null }
}

const REASON_LABELS: Record<string, string> = {
  rejNewRoof: 'Recent / new roof', rejWrongType: 'Wrong roof type', rejBadAddress: 'Bad address',
  rejNotOpportunity: 'Not a roofing opportunity', rejDuplicate: 'Duplicate', rejOther: 'Other',
}

export default async function AnalyticsPage({
  searchParams,
}: { searchParams: { campaign?: string; range?: string } }) {
  const user = await requireUser()
  if (!user.can('analyticsView')) {
    return <EmptyState title="You do not have access to this"
      message="Campaign analytics is limited to staff roles." actionLabel="Back" actionHref="/ops/prospecting" />
  }

  const rangeKey = searchParams.range && [...RANGES].some(r => r.key === searchParams.range) ? searchParams.range : '90'
  const range = resolveRange(rangeKey)
  const selectedCampaign = searchParams.campaign ?? null
  const canRevenue = user.can('analyticsRevenueView')
  const canCosts = user.can('campaignCostsManage')

  const supabase = createSupabaseServerClient()
  const [rows, channels] = await Promise.all([
    campaignFunnels(supabase, range),
    responseAnalytics(supabase, selectedCampaign, range),
  ])

  const selectedRow: CampaignFunnelRow | null = selectedCampaign
    ? rows.find(r => r.campaignId === selectedCampaign) ?? null
    : null

  // Counts for the headline: one campaign, or all campaigns summed.
  const counts: FunnelCounts = selectedRow
    ? selectedRow
    : rows.reduce<FunnelCounts>((acc, r) => addCounts(acc, r), { ...ZERO_COUNTS })

  const rates = computeRates(counts)
  const revenue = summarizeRevenue(counts)
  const [costs, batches] = await Promise.all([
    selectedCampaign ? campaignCosts(supabase, selectedCampaign) : Promise.resolve({ totalCents: null, items: [] }),
    selectedCampaign ? batchFunnels(supabase, selectedCampaign, range) : Promise.resolve([]),
  ])
  const costMetrics = computeCostMetrics(costs.totalCents, counts)

  const qs = (over: { campaign?: string | null; range?: string }) => {
    const p = new URLSearchParams()
    const c = over.campaign === undefined ? selectedCampaign : over.campaign
    if (c) p.set('campaign', c)
    p.set('range', over.range ?? rangeKey)
    return `?${p.toString()}`
  }

  const hasData = counts.imported > 0 || counts.mailed > 0

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting">Roof Prospecting</Link> / Analytics</div>
          <h1>Campaign Analytics</h1>
          <p className="ops-sub">
            The whole funnel, from county import to sold revenue. Response, appointment and sold
            figures come from the CRM’s own sales state — nothing is double-counted, and estimate
            totals are never shown as revenue.
          </p>
        </div>
        {user.can('analyticsExport') && (
          <div className="ops-page-actions">
            <a className="ops-btn" href={`/api/ops/prospecting/analytics/export${qs({})}`}>Export CSV</a>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="ops-analytics-filters">
        <div className="ops-review-tabs" role="tablist" aria-label="Date range (by mailed date)">
          {RANGES.map(r => (
            <Link key={r.key} href={qs({ range: r.key })} role="tab" aria-selected={rangeKey === r.key}
              className={`ops-review-tab${rangeKey === r.key ? ' is-active' : ''}`}>{r.label}</Link>
          ))}
        </div>
        <div className="ops-review-tabs" role="tablist" aria-label="Campaign">
          <Link href={qs({ campaign: null })} role="tab" aria-selected={!selectedCampaign}
            className={`ops-review-tab${!selectedCampaign ? ' is-active' : ''}`}>All campaigns</Link>
          {rows.map(r => (
            <Link key={r.campaignId} href={qs({ campaign: r.campaignId })} role="tab" aria-selected={selectedCampaign === r.campaignId}
              className={`ops-review-tab${selectedCampaign === r.campaignId ? ' is-active' : ''}`}>
              {r.campaignName ?? 'Campaign'}
            </Link>
          ))}
        </div>
        <p className="ops-hint">Response, appointment and sold rates are cohorted by <strong>mailed date</strong>{rangeKey !== 'all' ? ' within the selected window' : ''}. Acquisition and screening counts are campaign totals.</p>
      </div>

      {!hasData ? (
        <EmptyState title="No data yet for this view"
          message="Once prospects are imported, mailed, and responses come in, the funnel and rates appear here. Try widening the date range or choosing All campaigns."
          actionLabel="Back to Roof Prospecting" actionHref="/ops/prospecting" />
      ) : (
        <>
          {/* Overview cards */}
          <div className="ops-kpi-row" style={{ marginBottom: 18 }}>
            <div className="ops-kpi"><div className="ops-kpi-label">Imported</div><div className="ops-kpi-value">{counts.imported.toLocaleString()}</div></div>
            <div className="ops-kpi"><div className="ops-kpi-label">Approved</div><div className="ops-kpi-value">{counts.approved.toLocaleString()}</div></div>
            <div className="ops-kpi"><div className="ops-kpi-label">Mailed</div><div className="ops-kpi-value">{counts.mailed.toLocaleString()}</div></div>
            <div className="ops-kpi"><div className="ops-kpi-label">Responses</div><div className="ops-kpi-value">{counts.responded.toLocaleString()}</div></div>
            <div className="ops-kpi"><div className="ops-kpi-label">Appointments</div><div className="ops-kpi-value">{counts.appointments.toLocaleString()}</div></div>
            <div className="ops-kpi is-ok"><div className="ops-kpi-label">Sold</div><div className="ops-kpi-value">{counts.sold.toLocaleString()}</div></div>
            {canRevenue && (
              <div className="ops-kpi is-ok"><div className="ops-kpi-label">Sold revenue</div><div className="ops-kpi-value">{revenue.soldWithRevenue > 0 ? formatCents(revenue.soldRevenueCents) : '—'}</div></div>
            )}
          </div>

          <div className="ops-analytics-grid">
            {/* Funnel */}
            <div className="ops-card">
              <div className="ops-card-head"><h2>Funnel</h2></div>
              <div className="ops-card-body"><FunnelBars stages={funnelStages(counts)} /></div>
            </div>

            {/* Conversion rates — multiple denominators, no hidden choices */}
            <div className="ops-card">
              <div className="ops-card-head"><h2>Conversion rates</h2></div>
              <div className="ops-card-body">
                <dl className="ops-metric-list">
                  <div><dt>Mailed → Response</dt><dd>{formatRate(rates.responseRate)}</dd></div>
                  <div><dt>Mailed → Appointment</dt><dd>{formatRate(rates.appointmentRateMailed)}</dd></div>
                  <div><dt>Response → Appointment</dt><dd>{formatRate(rates.appointmentRateResponded)}</dd></div>
                  <div><dt>Appointment → Sold</dt><dd>{formatRate(rates.appointmentToSold)}</dd></div>
                  <div><dt>Mailed → Sold (close)</dt><dd>{formatRate(rates.closeRateMailed)}</dd></div>
                  <div><dt>Approval rate (of valid)</dt><dd>{formatRate(rates.approvalRate)}</dd></div>
                </dl>
                <p className="ops-hint">“—” means no denominator yet (e.g. nothing mailed in this window) — not 0%.</p>
              </div>
            </div>
          </div>

          <div className="ops-analytics-grid">
            {/* Disqualification breakdown */}
            <div className="ops-card">
              <div className="ops-card-head"><h2>Disqualification reasons</h2><span className="ops-sub2">{counts.rejected.toLocaleString()} rejected</span></div>
              <div className="ops-card-body">
                {counts.rejected === 0 ? <p className="ops-hint">No rejections recorded.</p> : (
                  <table className="ops-table">
                    <tbody>
                      {selectedRow ? reasonRows(selectedRow, counts.rejected) : reasonRowsAgg(rows, counts.rejected)}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Response channels */}
            <div className="ops-card">
              <div className="ops-card-head"><h2>Response channels</h2></div>
              <div className="ops-card-body">
                {channels.channels.length === 0 ? <p className="ops-hint">No responses recorded yet. Unknown channels are shown as “unknown”, never guessed.</p> : (
                  <table className="ops-table">
                    <thead><tr><th>Channel</th><th className="num">Responses</th><th className="num">Appts</th><th className="num">Sold</th></tr></thead>
                    <tbody>
                      {channels.channels.map(c => (
                        <tr key={c.channel}><td>{c.channel.replace('_', ' ')}</td><td className="num">{c.responses}</td><td className="num">{c.appointments}</td><td className="num">{c.sold}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="ops-hint" style={{ marginTop: 8 }}>
                  Time to first response: {channels.medianDays == null ? '—' : `${channels.medianDays}d median`}{channels.avgDays != null ? ` · ${channels.avgDays}d avg` : ''} {channels.observations > 0 ? `(${channels.observations} obs.)` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Revenue + cost — permissioned */}
          {canRevenue && (
            <div className="ops-analytics-grid">
              <div className="ops-card">
                <div className="ops-card-head"><h2>Revenue (actual)</h2></div>
                <div className="ops-card-body">
                  <dl className="ops-metric-list">
                    <div><dt>Sold revenue</dt><dd>{revenue.soldWithRevenue > 0 ? formatCents(revenue.soldRevenueCents) : 'Not available'}</dd></div>
                    <div><dt>Average sold job</dt><dd>{revenue.avgSoldJobCents == null ? '—' : formatCents(revenue.avgSoldJobCents)}</dd></div>
                    <div><dt>Revenue per mailed</dt><dd>{revenue.revenuePerMailedCents == null ? '—' : formatCents(revenue.revenuePerMailedCents)}</dd></div>
                  </dl>
                  {revenue.hasUnknownRevenue && (
                    <p className="ops-hint">{revenue.soldMissingRevenue} sold job{revenue.soldMissingRevenue === 1 ? '' : 's'} {revenue.soldMissingRevenue === 1 ? 'has' : 'have'} no recorded contract amount — excluded from revenue (not counted as $0).</p>
                  )}
                  <p className="ops-hint">Revenue is the linked job’s actual contract amount, never the proposal/estimate total.</p>
                </div>
              </div>

              <div className="ops-card">
                <div className="ops-card-head"><h2>Cost &amp; ROI</h2></div>
                <div className="ops-card-body">
                  {!costMetrics.configured ? (
                    <p className="ops-hint">
                      {selectedCampaign ? 'No campaign costs entered — cost-per-response, cost-per-sold and ROI are ' : 'Select a single campaign to enter costs. Cost metrics are '}
                      <strong>Not configured</strong> (never shown as $0).
                    </p>
                  ) : (
                    <dl className="ops-metric-list">
                      <div><dt>Total cost</dt><dd>{formatCents(costMetrics.totalCostCents!)}</dd></div>
                      <div><dt>Cost per response</dt><dd>{costMetrics.costPerResponseCents == null ? '—' : formatCents(costMetrics.costPerResponseCents)}</dd></div>
                      <div><dt>Cost per appointment</dt><dd>{costMetrics.costPerAppointmentCents == null ? '—' : formatCents(costMetrics.costPerAppointmentCents)}</dd></div>
                      <div><dt>Cost per sold job</dt><dd>{costMetrics.costPerSoldCents == null ? '—' : formatCents(costMetrics.costPerSoldCents)}</dd></div>
                      <div><dt>ROI</dt><dd>{costMetrics.roi == null ? 'Revenue not available' : formatRate(costMetrics.roi, 0)}</dd></div>
                    </dl>
                  )}
                  {selectedCampaign && canCosts && (
                    <>
                      <AddCampaignCostForm campaignId={selectedCampaign} />
                      {costs.items.length > 0 && (
                        <table className="ops-table" style={{ marginTop: 8 }}>
                          <thead><tr><th>Category</th><th className="num">Amount</th><th>Note</th></tr></thead>
                          <tbody>{costs.items.map(i => <tr key={i.id}><td>{i.category.replace('_', ' ')}</td><td className="num">{formatCents(i.amountCents)}</td><td>{i.note ?? '—'}</td></tr>)}</tbody>
                        </table>
                      )}
                    </>
                  )}
                  <p className="ops-hint" style={{ marginTop: 8 }}>Provider costs (measurement, geocoder, postage automation) will slot in here once pricing exists.</p>
                </div>
              </div>
            </div>
          )}

          {/* Per-batch breakdown when a campaign is selected */}
          {selectedCampaign && batches.length > 0 && (
            <div className="ops-card" style={{ marginBottom: 18 }}>
              <div className="ops-card-head"><h2>By mail batch</h2></div>
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead><tr><th>Batch</th><th className="num">Mailed</th><th className="num">Responded</th><th className="num">Appts</th><th className="num">Sold</th>{canRevenue && <th className="num">Revenue</th>}</tr></thead>
                  <tbody>
                    {batches.map(b => (
                      <tr key={b.mailBatchId}>
                        <td className="ops-cell-primary" data-label="Batch">{b.batchName ?? '—'}</td>
                        <td className="num" data-label="Mailed">{b.mailed}</td>
                        <td className="num" data-label="Responded">{b.responded}</td>
                        <td className="num" data-label="Appts">{b.appointments}</td>
                        <td className="num" data-label="Sold">{b.sold}</td>
                        {canRevenue && <td className="num" data-label="Revenue">{b.soldWithRevenue > 0 ? formatCents(b.soldRevenueCents) : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Campaign comparison — always show underlying metrics, no single "score" */}
          <div className="ops-card">
            <div className="ops-card-head"><h2>Campaign comparison</h2><span className="ops-sub2">{rows.length} campaign{rows.length === 1 ? '' : 's'}</span></div>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>Campaign</th><th>County</th><th className="num">Imported</th><th className="num">Approval</th>
                    <th className="num">Mailed</th><th className="num">Resp rate</th><th className="num">Appt rate</th>
                    <th className="num">Sold</th><th className="num">Close</th>{canRevenue && <th className="num">Revenue</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const rr = computeRates(r)
                    return (
                      <tr key={r.campaignId}>
                        <td className="ops-cell-primary" data-label="Campaign"><Link href={qs({ campaign: r.campaignId })}>{r.campaignName ?? 'Campaign'}</Link></td>
                        <td data-label="County">{r.county ?? '—'}</td>
                        <td className="num" data-label="Imported">{r.imported.toLocaleString()}</td>
                        <td className="num" data-label="Approval">{formatRate(rr.approvalRate)}</td>
                        <td className="num" data-label="Mailed">{r.mailed.toLocaleString()}</td>
                        <td className="num" data-label="Resp rate">{formatRate(rr.responseRate)}</td>
                        <td className="num" data-label="Appt rate">{formatRate(rr.appointmentRateMailed)}</td>
                        <td className="num" data-label="Sold">{r.sold.toLocaleString()}</td>
                        <td className="num" data-label="Close">{formatRate(rr.closeRateMailed)}</td>
                        {canRevenue && <td className="num" data-label="Revenue">{r.soldWithRevenue > 0 ? formatCents(r.soldRevenueCents) : '—'}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function reasonRows(r: CampaignFunnelRow, total: number) {
  const entries: [string, number][] = [
    ['rejNewRoof', r.rejNewRoof], ['rejWrongType', r.rejWrongType], ['rejBadAddress', r.rejBadAddress],
    ['rejNotOpportunity', r.rejNotOpportunity], ['rejDuplicate', r.rejDuplicate], ['rejOther', r.rejOther],
  ]
  return entries.filter(([, n]) => n > 0).map(([k, n]) => (
    <tr key={k}><td>{REASON_LABELS[k]}</td><td className="num">{n.toLocaleString()}</td><td className="num">{total > 0 ? `${((n / total) * 100).toFixed(0)}%` : '—'}</td></tr>
  ))
}

function reasonRowsAgg(rows: CampaignFunnelRow[], total: number) {
  const agg = { rejNewRoof: 0, rejWrongType: 0, rejBadAddress: 0, rejNotOpportunity: 0, rejDuplicate: 0, rejOther: 0 }
  for (const r of rows) {
    agg.rejNewRoof += r.rejNewRoof; agg.rejWrongType += r.rejWrongType; agg.rejBadAddress += r.rejBadAddress
    agg.rejNotOpportunity += r.rejNotOpportunity; agg.rejDuplicate += r.rejDuplicate; agg.rejOther += r.rejOther
  }
  return Object.entries(agg).filter(([, n]) => n > 0).map(([k, n]) => (
    <tr key={k}><td>{REASON_LABELS[k]}</td><td className="num">{n.toLocaleString()}</td><td className="num">{total > 0 ? `${((n / total) * 100).toFixed(0)}%` : '—'}</td></tr>
  ))
}

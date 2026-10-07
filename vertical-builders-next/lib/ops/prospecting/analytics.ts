import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '../services/activity'
import type { FunnelCounts } from './analytics-metrics'

/**
 * ============================================================================
 * CAMPAIGN ANALYTICS — DB layer (Phase 4)
 * ----------------------------------------------------------------------------
 * Reads aggregates from the database functions/view added in migration 0019
 * (campaign_funnel / batch_funnel / v_prospect_outcomes) so metrics are computed
 * server-side over indexed relationships — never by pulling raw prospect rows into
 * the app (spec §26). The pure rate/revenue/cost math lives in analytics-metrics.
 * ============================================================================
 */

export interface CampaignFunnelRow extends FunnelCounts {
  campaignId: string
  campaignName: string | null
  county: string | null
  rejNewRoof: number
  rejWrongType: number
  rejBadAddress: number
  rejNotOpportunity: number
  rejDuplicate: number
  rejOther: number
}

export interface DateRange { from?: string | null; to?: string | null }

function mapFunnelRow(r: Record<string, unknown>): CampaignFunnelRow {
  const n = (k: string) => Number(r[k] ?? 0)
  return {
    campaignId: r.campaign_id as string,
    campaignName: (r.campaign_name as string | null) ?? null,
    county: (r.county as string | null) ?? null,
    imported: n('imported'), duplicates: n('duplicates'), invalid: n('invalid'), valid: n('valid'),
    enriched: n('enriched'), manualMeasurement: n('manual_measurement'), reviewRequired: n('review_required'),
    approved: n('approved'), rejected: n('rejected'),
    rejNewRoof: n('rej_new_roof'), rejWrongType: n('rej_wrong_type'), rejBadAddress: n('rej_bad_address'),
    rejNotOpportunity: n('rej_not_opportunity'), rejDuplicate: n('rej_duplicate'), rejOther: n('rej_other'),
    crmLeads: n('crm_leads'), estimates: n('estimates'), pricingBlocked: n('pricing_blocked'), proposals: n('proposals'),
    mailed: n('mailed'), responded: n('responded'), appointments: n('appointments'), sold: n('sold'), lost: n('lost'),
    soldWithRevenue: n('sold_with_revenue'), soldRevenueCents: n('sold_revenue_cents'),
  }
}

/** Per-campaign funnels. Mail-cohort metrics are anchored on mailed date in range. */
export async function campaignFunnels(supabase: SupabaseClient, range: DateRange = {}): Promise<CampaignFunnelRow[]> {
  const { data, error } = await supabase.rpc('campaign_funnel', { p_from: range.from ?? null, p_to: range.to ?? null })
  if (error) { console.error('[analytics] campaign_funnel', error.message); return [] }
  return ((data ?? []) as Record<string, unknown>[]).map(mapFunnelRow)
}

export async function campaignFunnel(
  supabase: SupabaseClient, campaignId: string, range: DateRange = {},
): Promise<CampaignFunnelRow | null> {
  const all = await campaignFunnels(supabase, range)
  return all.find(r => r.campaignId === campaignId) ?? null
}

export interface BatchFunnelRow {
  mailBatchId: string
  batchName: string | null
  mailed: number
  responded: number
  appointments: number
  sold: number
  soldWithRevenue: number
  soldRevenueCents: number
}

export async function batchFunnels(
  supabase: SupabaseClient, campaignId: string, range: DateRange = {},
): Promise<BatchFunnelRow[]> {
  const { data, error } = await supabase.rpc('batch_funnel', {
    p_campaign: campaignId, p_from: range.from ?? null, p_to: range.to ?? null,
  })
  if (error) { console.error('[analytics] batch_funnel', error.message); return [] }
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    mailBatchId: r.mail_batch_id as string,
    batchName: (r.batch_name as string | null) ?? null,
    mailed: Number(r.mailed ?? 0), responded: Number(r.responded ?? 0),
    appointments: Number(r.appointments ?? 0), sold: Number(r.sold ?? 0),
    soldWithRevenue: Number(r.sold_with_revenue ?? 0), soldRevenueCents: Number(r.sold_revenue_cents ?? 0),
  }))
}

// ---------------------------------------------------------------------------
// Manual campaign costs
// ---------------------------------------------------------------------------

export interface CampaignCost {
  id: string
  category: string
  amountCents: number
  note: string | null
  incurredOn: string | null
  createdAt: string
}

export interface CampaignCostSummary {
  /** null when no manual costs exist → "Not configured", never $0 (§18). */
  totalCents: number | null
  items: CampaignCost[]
}

export async function campaignCosts(supabase: SupabaseClient, campaignId: string): Promise<CampaignCostSummary> {
  const { data } = await supabase
    .from('campaign_costs')
    .select('id, category, amount_cents, note, incurred_on, created_at')
    .eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(500)
  const items = ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: r.id as string, category: r.category as string, amountCents: Number(r.amount_cents ?? 0),
    note: (r.note as string | null) ?? null, incurredOn: (r.incurred_on as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
  return { totalCents: items.length > 0 ? items.reduce((s, i) => s + i.amountCents, 0) : null, items }
}

export async function addCampaignCost(
  supabase: SupabaseClient,
  input: { campaignId: string; category: string; amountCents: number; note?: string | null; incurredOn?: string | null },
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(input.amountCents) || input.amountCents < 0) return { ok: false, error: 'Enter a valid amount.' }
  const { error } = await supabase.from('campaign_costs').insert({
    campaign_id: input.campaignId, category: input.category, amount_cents: Math.round(input.amountCents),
    note: input.note ?? null, incurred_on: input.incurredOn ?? null, entered_by: userId,
  })
  if (error) return { ok: false, error: 'The cost could not be saved.' }
  await logActivity(supabase, {
    action: 'prospecting.campaign_cost_added', entityType: 'prospecting_campaign', entityId: input.campaignId,
    actorUserId: userId, metadata: { category: input.category, amount_cents: Math.round(input.amountCents) },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Response recording (first response per prospect — dedup by construction)
// ---------------------------------------------------------------------------

export const RESPONSE_CHANNELS = ['phone', 'website', 'email', 'walk_in', 'referral', 'other', 'unknown'] as const
export type ResponseChannel = (typeof RESPONSE_CHANNELS)[number]

export async function recordResponse(
  supabase: SupabaseClient,
  input: { prospectId: string; channel: ResponseChannel; note?: string | null; respondedAt?: string | null },
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Derive the links from the prospect so the caller only needs the prospect id.
  const { data: p } = await supabase
    .from('roof_prospects').select('id, campaign_id, converted_lead_id').eq('id', input.prospectId).maybeSingle()
  if (!p) return { ok: false, error: 'Prospect not found.' }

  // Earliest mailed batch, for attribution.
  const { data: item } = await supabase
    .from('mail_batch_items').select('batch_id, mailed_at')
    .eq('roof_prospect_id', input.prospectId).not('mailed_at', 'is', null)
    .order('mailed_at', { ascending: true }).limit(1).maybeSingle()

  // Upsert the single first-response row for this prospect (unique constraint).
  const { error } = await supabase.from('mail_responses').upsert({
    roof_prospect_id: input.prospectId,
    lead_id: (p as { converted_lead_id: string | null }).converted_lead_id,
    campaign_id: (p as { campaign_id: string | null }).campaign_id,
    mail_batch_id: (item as { batch_id: string } | null)?.batch_id ?? null,
    channel: input.channel,
    responded_at: input.respondedAt ?? new Date().toISOString(),
    note: input.note ?? null,
    source: 'manual',
    recorded_by: userId,
  }, { onConflict: 'roof_prospect_id' })
  if (error) return { ok: false, error: 'The response could not be recorded.' }

  await logActivity(supabase, {
    action: 'prospecting.response_recorded', entityType: 'roof_prospect', entityId: input.prospectId,
    actorUserId: userId, metadata: { channel: input.channel },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Response-channel + time-to-response (from the outcomes view, bounded)
// ---------------------------------------------------------------------------

export interface ChannelStat { channel: string; responses: number; appointments: number; sold: number }
export interface ResponseAnalytics {
  channels: ChannelStat[]
  /** Median / average mailed→first-response, in whole days. Null when no data. */
  medianDays: number | null
  avgDays: number | null
  observations: number
}

export async function responseAnalytics(
  supabase: SupabaseClient, campaignId: string | null, range: DateRange = {},
): Promise<ResponseAnalytics> {
  let q = supabase
    .from('v_prospect_outcomes')
    .select('first_response_channel, first_response_at, mailed_at, reached_appointment, is_sold, responded, is_mailed')
    .eq('responded', true)
  if (campaignId) q = q.eq('campaign_id', campaignId)
  const { data } = await q.limit(20000)
  const rows = (data ?? []) as Record<string, unknown>[]

  const inRange = (v: unknown) => {
    if (!range.from && !range.to) return true
    const t = v ? new Date(v as string).getTime() : NaN
    if (Number.isNaN(t)) return false
    if (range.from && t < new Date(range.from).getTime()) return false
    if (range.to && t > new Date(range.to).getTime()) return false
    return true
  }

  const byChannel = new Map<string, ChannelStat>()
  const days: number[] = []
  for (const r of rows) {
    if (!(r.is_mailed as boolean) || !inRange(r.mailed_at)) continue
    const ch = (r.first_response_channel as string | null) ?? 'unknown'
    const s = byChannel.get(ch) ?? { channel: ch, responses: 0, appointments: 0, sold: 0 }
    s.responses += 1
    if (r.reached_appointment) s.appointments += 1
    if (r.is_sold) s.sold += 1
    byChannel.set(ch, s)
    // Time-to-response only when we have both an explicit response time and a mail date.
    if (r.first_response_at && r.mailed_at) {
      const d = (new Date(r.first_response_at as string).getTime() - new Date(r.mailed_at as string).getTime()) / 86_400_000
      if (Number.isFinite(d) && d >= 0) days.push(d)
    }
  }

  days.sort((a, b) => a - b)
  const median = days.length > 0
    ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2)
    : null
  const avg = days.length > 0 ? days.reduce((s, d) => s + d, 0) / days.length : null

  return {
    channels: [...byChannel.values()].sort((a, b) => b.responses - a.responses),
    medianDays: median == null ? null : Math.round(median),
    avgDays: avg == null ? null : Math.round(avg),
    observations: days.length,
  }
}

// ---------------------------------------------------------------------------
// Prospect timeline (from activity_log — no duplicate event table, §21)
// ---------------------------------------------------------------------------

export interface TimelineEvent { at: string; label: string; detail?: string | null }

export async function prospectTimeline(supabase: SupabaseClient, prospectId: string): Promise<TimelineEvent[]> {
  const { data: p } = await supabase
    .from('roof_prospects')
    .select('id, created_at, converted_lead_id, estimate_id')
    .eq('id', prospectId).maybeSingle()
  if (!p) return []

  const prospect = p as Record<string, unknown>
  const relatedIds = [prospectId, prospect.converted_lead_id, prospect.estimate_id].filter(Boolean) as string[]

  const { data: acts } = await supabase
    .from('activity_log')
    .select('action, entity_type, entity_id, metadata_json, created_at')
    .in('entity_id', relatedIds)
    .order('created_at', { ascending: true })
    .limit(200)

  const events: TimelineEvent[] = []
  events.push({ at: prospect.created_at as string, label: 'Imported', detail: null })

  const { ACTION_LABELS } = await import('../services/activity')
  for (const a of (acts ?? []) as Record<string, unknown>[]) {
    const action = a.action as string
    if (action === 'record.created') continue // avoids a duplicate "imported"-like row
    events.push({
      at: a.created_at as string,
      label: ACTION_LABELS[action] ?? action.replace(/[._]/g, ' '),
      detail: summarizeMeta(a.metadata_json as Record<string, unknown> | null),
    })
  }

  // The first response, if recorded.
  const { data: resp } = await supabase
    .from('mail_responses').select('responded_at, channel').eq('roof_prospect_id', prospectId).maybeSingle()
  if (resp) {
    events.push({ at: (resp as { responded_at: string }).responded_at, label: 'Responded', detail: `${(resp as { channel: string }).channel}` })
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

function summarizeMeta(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  if (typeof meta.channel === 'string') return meta.channel
  if (typeof meta.name === 'string') return meta.name
  return null
}

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * ============================================================================
 * MAIL-BATCH PRODUCTION — eligibility + queue (Phase 3B)
 * ----------------------------------------------------------------------------
 * Decides whether an already-reviewed, converted prospect may enter an outbound
 * mail batch, and never "silently fixes" a missing prerequisite — a blocked row
 * carries the reason it is blocked (spec §3/§7).
 *
 * The load-bearing safety rule mirrors conversion: NEVER put a misleading $0
 * proposal in front of a customer. An estimate whose total is $0 (its price-book
 * item was retired to needs-price after the estimate was built, say) is blocked
 * as PRICING_CONFIGURATION_REQUIRED here, at production time, not mailed.
 *
 * `evaluateProductionEligibility` is PURE and exhaustively unit-tested. The DB
 * functions below only gather rows and hand them to it.
 * ============================================================================
 */

export type EligibilityCode =
  | 'READY'
  | 'ESTIMATE_REQUIRED'
  | 'MEASUREMENT_REQUIRED'
  | 'PRICING_CONFIGURATION_REQUIRED'
  | 'TEMPLATE_REQUIRED'
  | 'BAD_ADDRESS'
  | 'ALREADY_BATCHED'
  | 'ERROR'

export interface EligibilityInput {
  estimateId: string | null
  estimateTotalCents: number | null
  finalSquares: number | null
  propertyAddress: string | null
  mailingAddress: string | null
  /** Whether a campaign is attached at all — a template can only be required if so. */
  campaignPresent: boolean
  proposalTemplateId: string | null
  alreadyInActiveBatch: boolean
}

export interface EligibilityResult {
  code: EligibilityCode
  ready: boolean
  reason: string
  /** The address a mail piece would actually be sent to (may be the fallback). */
  mailingAddressUsed: string | null
  /** True when the property address stood in because no mailing address existed. */
  mailingFallback: boolean
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim()
  return t.length > 0 ? t : null
}

/**
 * Pure eligibility decision for one prospect. Order matters: the deepest missing
 * prerequisite is reported first so the operator sees the actionable cause, not a
 * symptom. `allowRebatch` lets an operator deliberately include a prospect that
 * is already in an active batch (a reprint into a new batch).
 */
export function evaluateProductionEligibility(
  input: EligibilityInput,
  opts: { allowRebatch?: boolean } = {},
): EligibilityResult {
  const property = clean(input.propertyAddress)
  const mailing = clean(input.mailingAddress)

  // Resolve the delivery address once; several branches report it.
  let mailingAddressUsed: string | null = null
  let mailingFallback = false
  if (mailing) {
    mailingAddressUsed = mailing
  } else if (property) {
    mailingAddressUsed = property
    mailingFallback = true
  }

  const blocked = (code: EligibilityCode, reason: string): EligibilityResult => ({
    code, ready: false, reason, mailingAddressUsed, mailingFallback,
  })

  if (input.alreadyInActiveBatch && !opts.allowRebatch) {
    return blocked('ALREADY_BATCHED', 'Already included in an active mail batch.')
  }
  if (input.finalSquares == null || input.finalSquares <= 0) {
    return blocked('MEASUREMENT_REQUIRED', 'No usable roof measurement (final squares).')
  }
  if (!input.estimateId) {
    return blocked('ESTIMATE_REQUIRED', 'No estimate has been generated for this prospect.')
  }
  if (input.estimateTotalCents == null || input.estimateTotalCents <= 0) {
    return blocked(
      'PRICING_CONFIGURATION_REQUIRED',
      'The estimate total is $0 — pricing is not configured. A $0 proposal is never mailed.',
    )
  }
  if (input.campaignPresent && !input.proposalTemplateId) {
    return blocked('TEMPLATE_REQUIRED', 'No proposal template is configured on the campaign.')
  }
  if (!mailingAddressUsed) {
    return blocked('BAD_ADDRESS', 'No mailing address and no property address to fall back to.')
  }

  return {
    code: 'READY',
    ready: true,
    reason: mailingFallback
      ? 'Ready. No mailing address on file — property address used as the delivery fallback.'
      : 'Ready for production.',
    mailingAddressUsed,
    mailingFallback,
  }
}

const RECIPIENT_FALLBACK = 'Current Resident'

/** Recipient name for a mail piece — owner if known, otherwise a safe generic. */
export function recipientNameFor(ownerName: string | null | undefined): string {
  return clean(ownerName ?? null) ?? RECIPIENT_FALLBACK
}

// ---------------------------------------------------------------------------
// DB layer
// ---------------------------------------------------------------------------

/** Statuses a prospect can be in and still be a production candidate. */
export const PRODUCTION_CANDIDATE_STATUSES = [
  'estimate_ready', 'document_ready', 'printed', 'mailed',
] as const

export interface ProductionRow {
  prospectId: string
  status: string
  ownerName: string | null
  recipientName: string
  propertyAddress: string | null
  city: string | null
  state: string | null
  zip: string | null
  mailingAddress: string | null
  county: string | null
  campaignId: string | null
  campaignName: string | null
  estimateId: string | null
  estimateNumber: string | null
  estimateTotalCents: number | null
  finalSquares: number | null
  eligibility: EligibilityResult
}

/** Prospect ids currently in a non-cancelled mail batch. */
export async function activeBatchedProspectIds(
  supabase: SupabaseClient,
  campaignId?: string | null,
): Promise<Set<string>> {
  // Two-step (PostgREST has no join in a count): active batch ids, then their items.
  let bq = supabase.from('mail_batches').select('id').neq('status', 'cancelled')
  if (campaignId) bq = bq.eq('campaign_id', campaignId)
  const { data: batches } = await bq.limit(2000)
  const batchIds = (batches ?? []).map(b => (b as { id: string }).id)
  if (batchIds.length === 0) return new Set()

  const ids = new Set<string>()
  // Chunk the IN list so a large active set never builds an oversized query.
  for (let i = 0; i < batchIds.length; i += 200) {
    const slice = batchIds.slice(i, i + 200)
    const { data: items } = await supabase
      .from('mail_batch_items')
      .select('roof_prospect_id')
      .in('batch_id', slice)
      .not('roof_prospect_id', 'is', null)
      .limit(100000)
    for (const it of items ?? []) {
      const pid = (it as { roof_prospect_id: string | null }).roof_prospect_id
      if (pid) ids.add(pid)
    }
  }
  return ids
}

interface QueueFilters {
  campaignId?: string | null
  county?: string | null
  /** ready = eligible & unbatched; blocked = any blocking reason; batched = in a batch; all = everything. */
  readiness?: 'ready' | 'blocked' | 'batched' | 'all'
  limit?: number
  offset?: number
}

/**
 * The production queue: candidate prospects annotated with eligibility. Paginated
 * — the browser never holds thousands of rows (spec §18).
 */
export async function listProductionQueue(
  supabase: SupabaseClient,
  filters: QueueFilters = {},
): Promise<{ rows: ProductionRow[]; total: number }> {
  const limit = Math.min(filters.limit ?? 100, 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  const batched = await activeBatchedProspectIds(supabase, filters.campaignId)

  let q = supabase
    .from('roof_prospects')
    .select(
      `id, status, owner_name, property_address, city, state, zip, mailing_address, final_squares,
       campaign_id, estimate_id,
       prospecting_campaigns(name, county, proposal_template_id),
       estimates(estimate_number, total_cents)`,
      { count: 'exact' },
    )
    .in('status', PRODUCTION_CANDIDATE_STATUSES as unknown as string[])
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId)

  const { data, count } = await q
  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  const annotated: ProductionRow[] = rows.map(r => {
    const campaign = firstOf(r.prospecting_campaigns) as Record<string, unknown> | null
    const estimate = firstOf(r.estimates) as Record<string, unknown> | null
    const prospectId = r.id as string
    const eligibility = evaluateProductionEligibility({
      estimateId: (r.estimate_id as string | null) ?? null,
      estimateTotalCents: (estimate?.total_cents as number | null) ?? null,
      finalSquares: (r.final_squares as number | null) ?? null,
      propertyAddress: (r.property_address as string | null) ?? null,
      mailingAddress: (r.mailing_address as string | null) ?? null,
      campaignPresent: Boolean(r.campaign_id),
      proposalTemplateId: (campaign?.proposal_template_id as string | null) ?? null,
      alreadyInActiveBatch: batched.has(prospectId),
    })
    return {
      prospectId,
      status: r.status as string,
      ownerName: (r.owner_name as string | null) ?? null,
      recipientName: recipientNameFor(r.owner_name as string | null),
      propertyAddress: (r.property_address as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      state: (r.state as string | null) ?? null,
      zip: (r.zip as string | null) ?? null,
      mailingAddress: (r.mailing_address as string | null) ?? null,
      county: (campaign?.county as string | null) ?? null,
      campaignId: (r.campaign_id as string | null) ?? null,
      campaignName: (campaign?.name as string | null) ?? null,
      estimateId: (r.estimate_id as string | null) ?? null,
      estimateNumber: (estimate?.estimate_number as string | null) ?? null,
      estimateTotalCents: (estimate?.total_cents as number | null) ?? null,
      finalSquares: (r.final_squares as number | null) ?? null,
      eligibility,
    }
  })

  const filtered = annotated.filter(row => {
    if (filters.county && row.county !== filters.county) return false
    switch (filters.readiness) {
      case 'ready': return row.eligibility.ready
      case 'blocked': return !row.eligibility.ready && row.eligibility.code !== 'ALREADY_BATCHED'
      case 'batched': return batched.has(row.prospectId)
      default: return true
    }
  })

  return { rows: filtered, total: count ?? filtered.length }
}

export interface ProductionCounts {
  readyForProduction: number
  blockedByPricing: number
  blockedByMeasurement: number
  proposalReady: number
  inPrintBatch: number
  printed: number
  mailed: number
  failed: number
}

/** Operational counts for the production dashboard (spec §4). Head-count driven. */
export async function productionCounts(
  supabase: SupabaseClient,
  filters: { campaignId?: string | null } = {},
): Promise<ProductionCounts> {
  const batched = await activeBatchedProspectIds(supabase, filters.campaignId)
  const batchedList = [...batched]

  const headProspect = (status: string) => {
    let q = supabase.from('roof_prospects').select('id', { count: 'exact', head: true }).eq('status', status)
    if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId)
    return q
  }

  // Ready = estimate_ready and not already in an active batch.
  let readyQ = supabase.from('roof_prospects').select('id', { count: 'exact', head: true }).eq('status', 'estimate_ready')
  if (filters.campaignId) readyQ = readyQ.eq('campaign_id', filters.campaignId)
  if (batchedList.length > 0 && batchedList.length <= 1000) {
    readyQ = readyQ.not('id', 'in', `(${batchedList.join(',')})`)
  }

  const [
    ready, pricing, measurement, docReady, printed, mailed, failedItems,
  ] = await Promise.all([
    readyQ,
    headProspect('pricing_configuration_required'),
    headProspect('manual_measurement_required'),
    headProspect('document_ready'),
    headProspect('printed'),
    headProspect('mailed'),
    supabase.from('mail_batch_items').select('id', { count: 'exact', head: true }).eq('generation_status', 'failed'),
  ])

  return {
    readyForProduction: ready.count ?? 0,
    blockedByPricing: pricing.count ?? 0,
    blockedByMeasurement: measurement.count ?? 0,
    proposalReady: docReady.count ?? 0,
    inPrintBatch: batched.size,
    printed: printed.count ?? 0,
    mailed: mailed.count ?? 0,
    failed: failedItems.count ?? 0,
  }
}

function firstOf(v: unknown): unknown {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

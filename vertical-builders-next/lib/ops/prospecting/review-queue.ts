import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProspectStatus } from './constants'

/**
 * Data for the Rapid Roof Review console: bucket counts and an evidence-rich,
 * paginated queue. Kept server-side and bounded — the console loads a page and
 * navigates within it, never the whole dataset.
 */

export interface ReviewCounts {
  needsReview: number
  followUp: number
  manualMeasurement: number
  approved: number
  rejected: number
  crmCreated: number
  estimateReady: number
  pricingBlocked: number
}

export interface ReviewScope {
  campaignId?: string | null
  batchId?: string | null
}

const REJECTED = ['disqualified_new_roof', 'disqualified_wrong_roof_type', 'disqualified_bad_address', 'disqualified_not_opportunity', 'duplicate']

export async function reviewCounts(supabase: SupabaseClient, scope: ReviewScope = {}): Promise<ReviewCounts> {
  const base = () => {
    let q = supabase.from('roof_prospects').select('id', { count: 'exact', head: true })
    if (scope.campaignId) q = q.eq('campaign_id', scope.campaignId)
    if (scope.batchId) q = q.eq('import_job_id', scope.batchId)
    return q
  }
  const [needsReview, followUp, manual, approved, rejected, crm, estimate, pricing] = await Promise.all([
    base().eq('status', 'review_required'),
    base().eq('status', 'follow_up'),
    base().eq('status', 'manual_measurement_required'),
    base().eq('status', 'qualified'),
    base().in('status', REJECTED),
    base().eq('status', 'crm_created'),
    base().eq('status', 'estimate_ready'),
    base().eq('status', 'pricing_configuration_required'),
  ])
  return {
    needsReview: needsReview.count ?? 0,
    followUp: followUp.count ?? 0,
    manualMeasurement: manual.count ?? 0,
    approved: approved.count ?? 0,
    rejected: rejected.count ?? 0,
    crmCreated: crm.count ?? 0,
    estimateReady: estimate.count ?? 0,
    pricingBlocked: pricing.count ?? 0,
  }
}

export interface ReviewProspect {
  id: string
  status: ProspectStatus
  review_version: number
  owner_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  mailing_address: string | null
  parcel_apn: string | null
  county: string | null
  campaign_id: string | null
  campaign_name: string | null
  import_job_id: string | null
  permit_number: string | null
  permit_type: string | null
  permit_description: string | null
  permit_date: string | null
  permit_class: string | null
  roof_type: string | null
  measured_squares: number | null
  waste_squares: number | null
  final_squares: number | null
  waste_rule_applied: string | null
  confidence_band: string | null
  confidence_reasons: string[]
  screening_decision: string | null
  screening_reason: string | null
  review_note: string | null
  reviewed_at: string | null
  converted_lead_id: string | null
  estimate_id: string | null
  measurement: {
    provider: string | null
    measurement_type: string | null
    roof_area_sqft: number | null
    roof_area_squares: number | null
    confidence_band: string | null
  } | null
}

const SELECT =
  'id, status, review_version, owner_name, property_address, city, state, zip, mailing_address, parcel_apn, ' +
  'campaign_id, import_job_id, permit_number, permit_type, permit_description, permit_date, permit_class, roof_type, ' +
  'measured_squares, waste_squares, final_squares, waste_rule_applied, confidence_band, confidence_reasons, ' +
  'screening_decision, screening_reason, review_note, reviewed_at, converted_lead_id, estimate_id, ' +
  'measurement_id, prospecting_campaigns(name, county)'

export async function listReviewQueue(
  supabase: SupabaseClient,
  filter: ReviewScope & { status?: string; limit?: number; offset?: number },
): Promise<ReviewProspect[]> {
  let q = supabase.from('roof_prospects').select(SELECT).order('created_at', { ascending: true })
  if (filter.status) {
    if (filter.status === 'rejected') q = q.in('status', REJECTED)
    else q = q.eq('status', filter.status)
  } else {
    q = q.eq('status', 'review_required')
  }
  if (filter.campaignId) q = q.eq('campaign_id', filter.campaignId)
  if (filter.batchId) q = q.eq('import_job_id', filter.batchId)
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0
  q = q.range(offset, offset + limit - 1)

  const { data, error } = await q
  if (error) { console.error('[review-queue] list failed', error); return [] }
  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  // Fetch linked measurements in one query rather than an ambiguous embed
  // (two FKs exist between roof_prospects and roof_measurements).
  const measurementIds = rows.map(r => r.measurement_id as string | null).filter((x): x is string => Boolean(x))
  const measurementById = new Map<string, Record<string, unknown>>()
  if (measurementIds.length > 0) {
    const { data: ms } = await supabase
      .from('roof_measurements')
      .select('id, provider, measurement_type, roof_area_sqft, roof_area_squares, confidence_band')
      .in('id', measurementIds)
    for (const m of ms ?? []) measurementById.set(m.id as string, m)
  }

  return rows.map(r => {
    const campaign = Array.isArray(r.prospecting_campaigns) ? r.prospecting_campaigns[0] : r.prospecting_campaigns
    const m = r.measurement_id ? measurementById.get(r.measurement_id as string) ?? null : null
    return {
      id: r.id as string,
      status: r.status as ProspectStatus,
      review_version: (r.review_version as number) ?? 0,
      owner_name: (r.owner_name as string | null) ?? null,
      property_address: (r.property_address as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      state: (r.state as string | null) ?? null,
      zip: (r.zip as string | null) ?? null,
      mailing_address: (r.mailing_address as string | null) ?? null,
      parcel_apn: (r.parcel_apn as string | null) ?? null,
      county: (campaign?.county as string | undefined) ?? null,
      campaign_id: (r.campaign_id as string | null) ?? null,
      campaign_name: (campaign?.name as string | undefined) ?? null,
      import_job_id: (r.import_job_id as string | null) ?? null,
      permit_number: (r.permit_number as string | null) ?? null,
      permit_type: (r.permit_type as string | null) ?? null,
      permit_description: (r.permit_description as string | null) ?? null,
      permit_date: (r.permit_date as string | null) ?? null,
      permit_class: (r.permit_class as string | null) ?? null,
      roof_type: (r.roof_type as string | null) ?? null,
      measured_squares: (r.measured_squares as number | null) ?? null,
      waste_squares: (r.waste_squares as number | null) ?? null,
      final_squares: (r.final_squares as number | null) ?? null,
      waste_rule_applied: (r.waste_rule_applied as string | null) ?? null,
      confidence_band: (r.confidence_band as string | null) ?? null,
      confidence_reasons: (r.confidence_reasons as string[] | null) ?? [],
      screening_decision: (r.screening_decision as string | null) ?? null,
      screening_reason: (r.screening_reason as string | null) ?? null,
      review_note: (r.review_note as string | null) ?? null,
      reviewed_at: (r.reviewed_at as string | null) ?? null,
      converted_lead_id: (r.converted_lead_id as string | null) ?? null,
      estimate_id: (r.estimate_id as string | null) ?? null,
      measurement: m ? {
        provider: (m.provider as string | null) ?? null,
        measurement_type: (m.measurement_type as string | null) ?? null,
        roof_area_sqft: (m.roof_area_sqft as number | null) ?? null,
        roof_area_squares: (m.roof_area_squares as number | null) ?? null,
        confidence_band: (m.confidence_band as string | null) ?? null,
      } : null,
    }
  })
}

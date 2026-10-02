import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enrichProspect } from './enrichment'
import { assessMeasurementType, describeEnrichmentProviders, type MeasurementRow } from './measurement'
import type { WasteRule } from './constants'

/**
 * ============================================================================
 * ENRICHMENT ORCHESTRATION — server side, chunked, resumable, idempotent
 * ----------------------------------------------------------------------------
 * Runs the FREE enrichment stages (address, permit classification, screening)
 * over a source prospect batch, one bounded chunk per call so it is resumable
 * and cancellable. It NEVER calls a paid provider: the measurement stage either
 * uses a measurement that already exists, defers (when a provider is configured
 * but the paid lookup is not yet authorized), or finalizes as manual-measurement.
 * Idempotent: only prospects still at enrichment_stage='not_started' are touched,
 * so a retry re-does nothing that already completed.
 * ============================================================================
 */

export const ENRICH_CHUNK = 200

function campaignWasteRule(c: Record<string, unknown> | null): WasteRule {
  return {
    type: ((c?.waste_rule_type as string) ?? 'percent') as WasteRule['type'],
    value: (c?.waste_rule_value as number | null) ?? null,
    minSquares: (c?.waste_min_squares as number | null) ?? null,
  }
}

export interface EnrichChunkResult {
  processed: number
  remaining: number
  finalized: number
  deferred: number
  disqualified: number
  review: number
  manual: number
}

export async function countPendingEnrichment(supabase: SupabaseClient, sourceBatchId: string): Promise<number> {
  const { count } = await supabase
    .from('roof_prospects')
    .select('id', { count: 'exact', head: true })
    .eq('import_job_id', sourceBatchId)
    .eq('enrichment_stage', 'not_started')
  return count ?? 0
}

export async function enrichChunk(
  supabase: SupabaseClient,
  sourceBatchId: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<EnrichChunkResult> {
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? ENRICH_CHUNK

  // Source batch → campaign config + provider readiness.
  const { data: batch } = await supabase
    .from('lead_import_jobs').select('campaign_id').eq('id', sourceBatchId).maybeSingle()
  const campaignId = (batch?.campaign_id as string | null) ?? null
  const campaign = campaignId
    ? (await supabase.from('prospecting_campaigns').select('*').eq('id', campaignId).maybeSingle()).data
    : null

  const providers = describeEnrichmentProviders(campaign?.measurement_provider as string | null)
  const screeningConfig = {
    roofTypes: (campaign?.roof_types as string[] | null) ?? [],
    minRoofAgeYears: (campaign?.min_roof_age_years as number | null) ?? null,
    autoQualifyEnabled: Boolean(campaign?.auto_qualify_enabled),
    wasteRule: campaignWasteRule(campaign),
  }

  const { data: prospects } = await supabase
    .from('roof_prospects')
    .select('id, status, address_key, parcel_apn, roof_type, permit_type, permit_description, permit_date, measurement_id')
    .eq('import_job_id', sourceBatchId)
    .eq('enrichment_stage', 'not_started')
    .order('created_at', { ascending: true })
    .limit(limit)

  const rows = prospects ?? []
  const result: EnrichChunkResult = { processed: 0, remaining: 0, finalized: 0, deferred: 0, disqualified: 0, review: 0, manual: 0 }

  for (const p of rows) {
    // Reuse an existing measurement for this prospect if one is already recorded —
    // never trigger a provider lookup here.
    let measurement: MeasurementRow | null = null
    if (p.measurement_id) {
      const { data: m } = await supabase
        .from('roof_measurements')
        .select('provider, roof_area_squares, roof_area_sqft, building_footprint_sqft, completed_at')
        .eq('id', p.measurement_id).maybeSingle()
      measurement = (m as MeasurementRow | null) ?? null
    }
    const measurementType = assessMeasurementType(measurement)

    const r = enrichProspect(
      {
        isDuplicate: p.status === 'duplicate',
        addressKey: (p.address_key as string | null) ?? null,
        parcelApn: (p.parcel_apn as string | null) ?? null,
        roofType: (p.roof_type as string | null) ?? null,
        permitType: (p.permit_type as string | null) ?? null,
        permitDescription: (p.permit_description as string | null) ?? null,
        permitDateIso: (p.permit_date as string | null) ?? null,
        existingMeasurementType: measurementType,
        existingMeasuredSquares: (measurement?.roof_area_squares as number | null) ?? null,
      },
      screeningConfig,
      { providerReady: providers.paidMeasurementReady, now },
    )

    const update: Record<string, unknown> = {
      enrichment_stage: r.stage,
      enriched_at: now.toISOString(),
      permit_class: r.permitClass,
      permit_class_source: r.permitClassSource.slice(0, 500),
      roof_type: p.roof_type ?? null,
      confidence_band: r.screening.confidenceBand,
      confidence_reasons: r.screening.reasons.slice(0, 20),
      screening_decision: r.screening.screeningDecision,
      screening_reason: r.screening.reasons[0]?.slice(0, 500) ?? null,
    }
    // Deferred prospects keep their pre-enrichment status (awaiting a paid lookup);
    // finalized prospects take the screening status.
    if (!r.deferredForMeasurement) update.status = r.screening.status
    if (r.billable) {
      update.measured_squares = r.billable.baseSquares
      update.waste_squares = r.billable.wasteSquares
      update.final_squares = r.billable.finalSquares
      update.waste_rule_applied = r.billable.ruleUsed
    }

    await supabase.from('roof_prospects').update(update).eq('id', p.id)

    result.processed += 1
    if (r.deferredForMeasurement) result.deferred += 1
    else result.finalized += 1
    if (r.screening.outcome === 'DISQUALIFY') result.disqualified += 1
    else if (r.screening.outcome === 'REVIEW_REQUIRED') result.review += 1
    else if (r.screening.outcome === 'MANUAL_MEASUREMENT_REQUIRED') result.manual += 1
  }

  result.remaining = await countPendingEnrichment(supabase, sourceBatchId)
  return result
}

// ---------------------------------------------------------------------------
// Enrichment panel data (provider states + cost preview) for the batch page
// ---------------------------------------------------------------------------
import { computeCostPreview, configuredUnitCostCents, type CostPreview } from './cost'
import type { EnrichmentProviderStates } from './measurement'

export interface EnrichmentPanel {
  providers: EnrichmentProviderStates
  cost: CostPreview
  pending: number
  total: number
  finalized: number
}

const DISQUALIFIED_OR_DUP = '("disqualified_new_roof","disqualified_wrong_roof_type","disqualified_bad_address","duplicate")'

export async function buildEnrichmentPanel(supabase: SupabaseClient, sourceBatchId: string): Promise<EnrichmentPanel> {
  const { data: batch } = await supabase
    .from('lead_import_jobs').select('campaign_id').eq('id', sourceBatchId).maybeSingle()
  const campaignId = (batch?.campaign_id as string | null) ?? null
  const campaign = campaignId
    ? (await supabase.from('prospecting_campaigns').select('measurement_provider, per_batch_measurement_cap').eq('id', campaignId).maybeSingle()).data
    : null

  const providers = describeEnrichmentProviders(campaign?.measurement_provider as string | null)
  const scope = () => supabase.from('roof_prospects').select('id', { count: 'exact', head: true }).eq('import_job_id', sourceBatchId)

  const [total, pending, finalized, cached, manualRecords, measurementsRequired] = await Promise.all([
    scope(),
    scope().eq('enrichment_stage', 'not_started'),
    scope().eq('enrichment_stage', 'finalized'),
    scope().not('measurement_id', 'is', null),
    scope().eq('status', 'manual_measurement_required'),
    scope().is('measurement_id', null).not('status', 'in', DISQUALIFIED_OR_DUP),
  ])

  const cost = computeCostPreview(
    {
      totalProspects: total.count ?? 0,
      alreadyEnriched: finalized.count ?? 0,
      cachedMeasurements: cached.count ?? 0,
      manualMeasurementRecords: manualRecords.count ?? 0,
      measurementsRequired: measurementsRequired.count ?? 0,
      unitCostCents: configuredUnitCostCents(),
      perBatchCap: (campaign?.per_batch_measurement_cap as number | null) ?? null,
      manualMode: providers.manualMode,
    },
    providers.paidMeasurementReady,
  )

  return { providers, cost, pending: pending.count ?? 0, total: total.count ?? 0, finalized: finalized.count ?? 0 }
}

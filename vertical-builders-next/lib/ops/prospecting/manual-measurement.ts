import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '../services/activity'
import { classifyPermit } from './permit-classifier'
import { classifyRoofType } from './import'
import { evaluateProspect } from './screening'
import { computeBillableSquares, type WasteRule } from './constants'

/**
 * ============================================================================
 * MANUAL ROOF MEASUREMENT — enter a verified figure, then re-screen
 * ----------------------------------------------------------------------------
 * Accepts either roof squares or roof square footage, normalises into the
 * existing roof_measurements model with manual provenance, links it to the
 * prospect, then RE-RUNS the screening engine (never bypassing it) so the
 * prospect moves on from manual_measurement_required to its real decision, with
 * billable squares derived through the campaign waste rule. The measured value
 * is preserved; only the derived billable figure carries the waste.
 * ============================================================================
 */

export interface ManualMeasurementInput {
  prospectId: string
  /** Provide one of these. squares wins if both are given. */
  squares?: number | null
  sqft?: number | null
  note?: string | null
  userId: string
}

export interface ManualMeasurementResult {
  ok: boolean
  error?: string
  measurementId?: string
  finalSquares?: number | null
  status?: string
}

function round1(n: number): number { return Math.round(n * 10) / 10 }

export async function enterManualMeasurement(
  supabase: SupabaseClient,
  input: ManualMeasurementInput,
): Promise<ManualMeasurementResult> {
  const squares = input.squares != null && Number.isFinite(input.squares) && input.squares >= 0
    ? round1(input.squares)
    : input.sqft != null && Number.isFinite(input.sqft) && input.sqft >= 0
      ? round1(input.sqft / 100)
      : null
  if (squares == null) return { ok: false, error: 'Enter roof squares or square footage.' }
  const sqft = input.sqft != null && input.sqft >= 0 ? Math.round(input.sqft) : Math.round(squares * 100)

  const { data: prospect } = await supabase
    .from('roof_prospects')
    .select('id, campaign_id, roof_type, parcel_apn, address_key, permit_type, permit_description, permit_date, property_address, status')
    .eq('id', input.prospectId).maybeSingle()
  if (!prospect) return { ok: false, error: 'Prospect not found.' }

  // 1. Record the measurement (manual provenance, authoritative but not a survey).
  const { data: measurement, error: mErr } = await supabase
    .from('roof_measurements')
    .insert({
      roof_prospect_id: prospect.id,
      address: (prospect.property_address as string | null) ?? 'Unknown',
      provider: 'manual',
      measurement_type: 'manual',
      confidence_band: 'medium',
      confidence_reasons: ['Measurement entered by a person'],
      status: 'complete',
      roof_area_squares: squares,
      roof_area_sqft: sqft,
      notes: input.note?.slice(0, 500) ?? null,
      requested_by: input.userId,
      requested_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id').single()
  if (mErr || !measurement) {
    console.error('[manual-measurement] insert failed', mErr)
    return { ok: false, error: 'The measurement could not be saved.' }
  }

  // 2. Load campaign config for re-screening + waste.
  const campaign = prospect.campaign_id
    ? (await supabase.from('prospecting_campaigns').select('*').eq('id', prospect.campaign_id).maybeSingle()).data
    : null
  const wasteRule: WasteRule = {
    type: ((campaign?.waste_rule_type as string) ?? 'percent') as WasteRule['type'],
    value: (campaign?.waste_rule_value as number | null) ?? null,
    minSquares: (campaign?.waste_min_squares as number | null) ?? null,
  }
  const roofFamily = classifyRoofType(prospect.roof_type as string | null)
    ?? classifyPermit({ permitType: prospect.permit_type as string | null, permitDescription: prospect.permit_description as string | null }).material
    ?? null

  // 3. Re-run screening WITH the new measurement (never bypass the engine).
  const screening = evaluateProspect(
    {
      addressMatch: prospect.address_key ? 'exact' : 'none',
      addressUsable: Boolean(prospect.address_key),
      parcelPresent: Boolean(prospect.parcel_apn),
      roofFamily,
      permit: classifyPermit({ permitType: prospect.permit_type as string | null, permitDescription: prospect.permit_description as string | null }),
      permitDateIso: prospect.permit_date as string | null,
      measurementType: 'manual',
    },
    {
      roofTypes: (campaign?.roof_types as string[] | null) ?? [],
      minRoofAgeYears: (campaign?.min_roof_age_years as number | null) ?? null,
      autoQualifyEnabled: Boolean(campaign?.auto_qualify_enabled),
    },
  )

  const billable = computeBillableSquares(squares, wasteRule)

  await supabase.from('roof_prospects').update({
    measurement_id: measurement.id,
    measured_squares: billable.baseSquares,
    waste_squares: billable.wasteSquares,
    final_squares: billable.finalSquares,
    waste_rule_applied: billable.ruleUsed,
    status: screening.status,
    screening_decision: screening.screeningDecision,
    confidence_band: screening.confidenceBand,
    confidence_reasons: screening.reasons.slice(0, 20),
    enrichment_stage: 'finalized',
  }).eq('id', prospect.id)

  await logActivity(supabase, {
    action: 'prospecting.manual_measurement', entityType: 'roof_prospect', entityId: prospect.id,
    actorUserId: input.userId, metadata: { squares, sqft, final_squares: billable.finalSquares },
  })

  return { ok: true, measurementId: measurement.id as string, finalSquares: billable.finalSquares, status: screening.status }
}

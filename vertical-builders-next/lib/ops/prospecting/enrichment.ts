import { classifyPermit } from './permit-classifier'
import { classifyRoofType } from './import'
import { evaluateProspect, type ScreeningResult, type CampaignScreeningConfig } from './screening'
import { computeBillableSquares, type WasteRule } from './constants'
import type { MeasurementType } from './confidence'

/**
 * ============================================================================
 * ENRICHMENT STAGE ENGINE — pure
 * ----------------------------------------------------------------------------
 * Runs one prospect through the free stages (address resolution, permit
 * classification, screening) and computes billable squares when a trustworthy
 * measurement already exists. It never calls a provider and never fabricates a
 * measurement. The MEASUREMENT stage is a BOUNDARY: if no trustworthy
 * measurement exists,
 *   · a measurement-independent disqualification (duplicate, bad address, wrong
 *     roof type, recent full replacement) still finalizes the prospect;
 *   · otherwise, if a paid provider is configured, the prospect is DEFERRED at
 *     the measurement stage (awaiting a paid lookup the caller must authorize);
 *   · if no provider is configured, it finalizes as MANUAL_MEASUREMENT_REQUIRED.
 * ============================================================================
 */

export type EnrichmentStage =
  | 'not_started' | 'address_resolution' | 'permit_classification'
  | 'measurement' | 'screening' | 'finalized'

export interface EnrichProspectInput {
  isDuplicate?: boolean
  addressKey: string | null
  parcelApn: string | null
  roofType: string | null
  permitType: string | null
  permitDescription: string | null
  permitDateIso: string | null
  /** Trust type of an EXISTING measurement for this property, or null if none. */
  existingMeasurementType: MeasurementType
  existingMeasuredSquares: number | null
  measurementAgeDays?: number | null
  conflict?: boolean
}

export interface EnrichProspectResult {
  stage: EnrichmentStage
  permitClass: string
  permitClassSource: string
  roofFamily: string | null
  screening: ScreeningResult
  billable: ReturnType<typeof computeBillableSquares> | null
  /** True when the prospect is parked awaiting an authorized paid measurement. */
  deferredForMeasurement: boolean
}

export function enrichProspect(
  input: EnrichProspectInput,
  campaign: CampaignScreeningConfig & { wasteRule: WasteRule },
  opts: { providerReady: boolean; now?: Date },
): EnrichProspectResult {
  const now = opts.now ?? new Date()

  // Stage: PERMIT_CLASSIFICATION (free).
  const permit = classifyPermit({ permitType: input.permitType, permitDescription: input.permitDescription })

  // Roof family from the imported roof_type, falling back to the permit's material.
  const roofFamily = classifyRoofType(input.roofType) ?? permit.material ?? null

  // Stage: SCREENING (measurement-independent rules run here regardless).
  const screening = evaluateProspect(
    {
      isDuplicate: input.isDuplicate,
      addressMatch: input.addressKey ? 'exact' : 'none',
      addressUsable: Boolean(input.addressKey),
      parcelPresent: Boolean(input.parcelApn),
      roofFamily,
      permit,
      permitDateIso: input.permitDateIso,
      measurementType: input.existingMeasurementType,
      measurementAgeDays: input.measurementAgeDays,
      conflict: input.conflict,
    },
    campaign,
    now,
  )

  const permitClassSource = permit.reasons.join('; ')

  // A finalized disqualification does not care about measurement.
  if (screening.outcome === 'DISQUALIFY') {
    return { stage: 'finalized', permitClass: permit.permitClass, permitClassSource, roofFamily, screening, billable: null, deferredForMeasurement: false }
  }

  const hasTrustworthyMeasurement =
    input.existingMeasurementType != null && input.existingMeasurementType !== 'building_footprint'

  // MEASUREMENT boundary.
  if (!hasTrustworthyMeasurement) {
    if (opts.providerReady) {
      // Defer — a paid lookup could supply the measurement, but it must be
      // authorized separately. We do NOT call a provider here.
      return {
        stage: 'measurement', permitClass: permit.permitClass, permitClassSource, roofFamily,
        screening, billable: null, deferredForMeasurement: true,
      }
    }
    // No provider — finalize honestly as manual-measurement-required (screening
    // already produced exactly that outcome). Nothing is fabricated.
    return { stage: 'finalized', permitClass: permit.permitClass, permitClassSource, roofFamily, screening, billable: null, deferredForMeasurement: false }
  }

  // We have a trustworthy measurement → compute billable squares (source preserved).
  const billable = computeBillableSquares(input.existingMeasuredSquares, campaign.wasteRule)
  return { stage: 'finalized', permitClass: permit.permitClass, permitClassSource, roofFamily, screening, billable, deferredForMeasurement: false }
}

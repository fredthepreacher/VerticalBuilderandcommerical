/**
 * ============================================================================
 * CONFIDENCE ENGINE — explainable, deterministic, no black-box score
 * ----------------------------------------------------------------------------
 * Turns named evidence signals into a HIGH / MEDIUM / LOW band plus the reasons
 * that produced it. Every band is traceable to evidence — the review console
 * shows exactly why something is HIGH, or why it needs review, or which source
 * conflicted. No opaque numeric AI score.
 * ============================================================================
 */

export type ConfidenceBand = 'high' | 'medium' | 'low'

export type MeasurementType =
  | 'verified_roof_surface'
  | 'provider_estimate'
  | 'building_footprint'
  | 'manual'
  | null

export interface ConfidenceSignals {
  addressMatch: 'exact' | 'partial' | 'none'
  parcelPresent: boolean
  measurementType: MeasurementType
  /** Age of the measurement/imagery in days, if known. */
  measurementAgeDays?: number | null
  permitQuality: 'structured' | 'free_text' | 'none'
  /** A source conflict (e.g. county says tile, provider says metal; multiple parcels). */
  conflict?: boolean
}

export interface ConfidenceResult {
  band: ConfidenceBand
  reasons: string[]
}

const STALE_MEASUREMENT_DAYS = 365 * 3 // imagery/report older than ~3 years is a soft gap

/**
 * HIGH = no gaps. A single hard gap (no/footprint-only measurement, unresolved
 * address, or a conflict) forces LOW. Otherwise any soft gap is MEDIUM.
 */
export function computeConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const reasons: string[] = []
  const hardGaps: string[] = []
  const softGaps: string[] = []

  // Address
  if (signals.addressMatch === 'exact') reasons.push('Exact normalized address match')
  else if (signals.addressMatch === 'partial') softGaps.push('Address matched only partially')
  else hardGaps.push('Property address could not be resolved')

  // Parcel
  if (signals.parcelPresent) reasons.push('Parcel / APN present')
  else softGaps.push('No parcel identifier')

  // Measurement
  switch (signals.measurementType) {
    case 'verified_roof_surface':
      reasons.push('Verified roof-surface measurement')
      break
    case 'provider_estimate':
      reasons.push('Provider roof-surface estimate')
      softGaps.push('Measurement is a provider estimate, not a verified survey')
      break
    case 'manual':
      reasons.push('Measurement entered/uploaded by a person')
      break
    case 'building_footprint':
      hardGaps.push('Measurement is a building footprint, not a roof surface')
      break
    default:
      hardGaps.push('Measurement source unavailable')
  }

  // Measurement recency
  if (signals.measurementAgeDays != null && signals.measurementAgeDays > STALE_MEASUREMENT_DAYS) {
    softGaps.push('Measurement/imagery is more than three years old')
  }

  // Permit quality
  if (signals.permitQuality === 'structured') reasons.push('Structured permit record')
  else if (signals.permitQuality === 'free_text') softGaps.push('Permit is free-text only')
  else softGaps.push('No permit record')

  // Conflict is always a hard gap.
  if (signals.conflict) hardGaps.push('Conflicting sources')

  const band: ConfidenceBand = hardGaps.length > 0 ? 'low' : softGaps.length > 0 ? 'medium' : 'high'

  return { band, reasons: [...reasons, ...softGaps, ...hardGaps] }
}

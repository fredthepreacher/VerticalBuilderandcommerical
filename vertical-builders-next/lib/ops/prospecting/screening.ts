import type { PermitClassification } from './permit-classifier'
import { computeConfidence, type ConfidenceBand, type MeasurementType } from './confidence'
import type { ProspectStatus, ScreeningDecision } from './constants'

/**
 * ============================================================================
 * SCREENING ENGINE — pure, testable, review-first
 * ----------------------------------------------------------------------------
 * Turns the normalized evidence for one prospect into a decision. Two rules
 * from the client shape everything:
 *
 *   1. AUTO-QUALIFY IS OFF at launch. The engine may auto-DISQUALIFY on a
 *      high-confidence deterministic rule, but a promising prospect becomes
 *      REVIEW_REQUIRED — a human approves it before it can be mailed. A campaign
 *      can turn auto-qualify on later; until then the QUALIFY branch never fires.
 *
 *   2. Nothing is fabricated. No measurement → MANUAL_MEASUREMENT_REQUIRED, not
 *      a guessed number.
 * ============================================================================
 */

export type ScreeningOutcome =
  | 'DISQUALIFY'
  | 'REVIEW_REQUIRED'
  | 'MANUAL_MEASUREMENT_REQUIRED'
  | 'QUALIFIED_FOR_MAILING'

export interface ProspectEvidence {
  isDuplicate?: boolean
  addressMatch: 'exact' | 'partial' | 'none'
  addressUsable: boolean
  parcelPresent: boolean
  /** Canonical roof family from classifyRoofType(roof_type), or null if unknown. */
  roofFamily: string | null
  permit: PermitClassification | null
  permitDateIso?: string | null
  measurementType: MeasurementType
  measurementAgeDays?: number | null
  conflict?: boolean
}

export interface CampaignScreeningConfig {
  roofTypes: string[]
  minRoofAgeYears: number | null
  autoQualifyEnabled: boolean
}

export interface ScreeningResult {
  outcome: ScreeningOutcome
  status: ProspectStatus
  screeningDecision: ScreeningDecision | null
  confidenceBand: ConfidenceBand
  reasons: string[]
  reviewRequired: boolean
}

/** Whole years between an ISO date and `now` (default: current time). */
export function yearsSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const ms = now.getTime() - then.getTime()
  if (ms < 0) return 0
  return ms / (365.25 * 24 * 3600 * 1000)
}

export function evaluateProspect(
  evidence: ProspectEvidence,
  campaign: CampaignScreeningConfig,
  now: Date = new Date(),
): ScreeningResult {
  const permitQuality: 'structured' | 'free_text' | 'none' =
    evidence.permit && evidence.permit.permitClass !== 'not_roof'
      ? (evidence.permit.sourceText.includes(' — ') ? 'structured' : 'free_text')
      : 'none'

  const confidence = computeConfidence({
    addressMatch: evidence.addressMatch,
    parcelPresent: evidence.parcelPresent,
    measurementType: evidence.measurementType,
    measurementAgeDays: evidence.measurementAgeDays,
    permitQuality,
    conflict: evidence.conflict,
  })

  const reasons: string[] = [...confidence.reasons]
  const disqualify = (screeningDecision: ScreeningDecision, status: ProspectStatus, why: string): ScreeningResult => ({
    outcome: 'DISQUALIFY', status, screeningDecision,
    confidenceBand: confidence.band, reasons: [why, ...reasons], reviewRequired: false,
  })

  // 1. Confirmed duplicate — a deterministic, high-confidence rejection.
  if (evidence.isDuplicate) {
    return disqualify('reject_duplicate', 'duplicate', 'Confirmed duplicate of an existing prospect or lead')
  }

  // 2. Unusable address — high-confidence rejection only when truly unresolvable.
  if (!evidence.addressUsable || evidence.addressMatch === 'none') {
    return disqualify('reject_bad_address', 'disqualified_bad_address', 'Property address could not be resolved')
  }

  // 3. Wrong roof type — only when the type is KNOWN and outside the campaign
  //    filter. Unknown type is never an auto-reject; it goes to review.
  const filter = campaign.roofTypes.filter(Boolean)
  if (filter.length > 0 && evidence.roofFamily && !filter.includes(evidence.roofFamily)) {
    return disqualify('reject_wrong_roof_type', 'disqualified_wrong_roof_type',
      `Roof type "${evidence.roofFamily}" is outside the campaign filter (${filter.join(', ')})`)
  }

  // 4. Recent full replacement — the core "don't mail a new roof" rule.
  //    Requires an actual full-replacement permit with a date inside the window.
  if (evidence.permit?.isFullReplacement && evidence.permitDateIso) {
    const age = yearsSince(evidence.permitDateIso, now)
    const threshold = campaign.minRoofAgeYears
    if (age != null && threshold != null && age < threshold) {
      return disqualify('reject_new_roof', 'disqualified_new_roof',
        `Full roof replacement permit dated ${evidence.permitDateIso} (${age.toFixed(1)} yrs ago, under the ${threshold}-yr threshold)`)
    }
  }

  // 5. No trustworthy measurement → manual measurement required (never a fake number).
  if (evidence.measurementType == null || evidence.measurementType === 'building_footprint') {
    reasons.unshift(evidence.measurementType === 'building_footprint'
      ? 'Only a building footprint is available — a roof-surface measurement is required'
      : 'No roof measurement available')
    return {
      outcome: 'MANUAL_MEASUREMENT_REQUIRED', status: 'manual_measurement_required',
      screeningDecision: 'manual_measurement', confidenceBand: confidence.band, reasons, reviewRequired: true,
    }
  }

  // 6. Promising. Auto-qualify only if a campaign has explicitly enabled it AND
  //    confidence is HIGH with no gaps. Otherwise — the launch default — REVIEW.
  const roofTypeOk = filter.length === 0 || (evidence.roofFamily != null && filter.includes(evidence.roofFamily))
  const canAutoQualify =
    campaign.autoQualifyEnabled &&
    confidence.band === 'high' &&
    roofTypeOk &&
    evidence.roofFamily != null &&
    !evidence.conflict

  if (canAutoQualify) {
    return {
      outcome: 'QUALIFIED_FOR_MAILING', status: 'qualified', screeningDecision: 'qualify',
      confidenceBand: confidence.band, reasons: ['Auto-qualified: high confidence, no gaps', ...reasons], reviewRequired: false,
    }
  }

  if (!evidence.roofFamily) reasons.unshift('Roof type is unknown — confirm before qualifying')
  return {
    outcome: 'REVIEW_REQUIRED', status: 'review_required', screeningDecision: null,
    confidenceBand: confidence.band, reasons, reviewRequired: true,
  }
}

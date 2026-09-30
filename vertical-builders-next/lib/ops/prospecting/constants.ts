/**
 * ============================================================================
 * ROOF PROSPECTING — shared vocabulary
 * ----------------------------------------------------------------------------
 * Statuses, screening decisions and the waste-rule model, in one place so the
 * database CHECK constraints (migration 0015), the services, and the UI cannot
 * drift from each other. Pure data — no server-only, safe to import anywhere.
 * ============================================================================
 */

/** Prospect lifecycle (§13 of the spec). Mirrors the CHECK on roof_prospects. */
export const PROSPECT_STATUSES = [
  'imported', 'normalizing', 'duplicate', 'enrichment_pending', 'enriched',
  'review_required', 'qualified',
  'disqualified_new_roof', 'disqualified_wrong_roof_type', 'disqualified_bad_address',
  'manual_measurement_required', 'crm_created', 'estimate_ready', 'document_ready',
  'printed', 'mailed', 'responded', 'appointment', 'sold', 'no_response', 'error',
] as const
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number]

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  imported: 'Imported',
  normalizing: 'Normalizing',
  duplicate: 'Duplicate',
  enrichment_pending: 'Awaiting enrichment',
  enriched: 'Enriched',
  review_required: 'Needs review',
  qualified: 'Qualified',
  disqualified_new_roof: 'Rejected — new roof',
  disqualified_wrong_roof_type: 'Rejected — wrong roof type',
  disqualified_bad_address: 'Rejected — bad address',
  manual_measurement_required: 'Manual measurement',
  crm_created: 'CRM lead created',
  estimate_ready: 'Estimate ready',
  document_ready: 'Document ready',
  printed: 'Printed',
  mailed: 'Mailed',
  responded: 'Responded',
  appointment: 'Appointment',
  sold: 'Sold',
  no_response: 'No response',
  error: 'Error',
}

/** One-click screening decisions from the human review console (§7). */
export const SCREENING_DECISIONS = [
  'qualify', 'reject_new_roof', 'reject_wrong_roof_type', 'reject_bad_address',
  'reject_duplicate', 'needs_follow_up', 'manual_measurement',
] as const
export type ScreeningDecision = (typeof SCREENING_DECISIONS)[number]

/** Waste rule (§6/D). Never a hard-coded +2. */
export const WASTE_RULE_TYPES = ['percent', 'fixed_squares', 'minimum', 'none'] as const
export type WasteRuleType = (typeof WASTE_RULE_TYPES)[number]

export const WASTE_RULE_LABELS: Record<WasteRuleType, string> = {
  percent: 'Percentage of measured squares',
  fixed_squares: 'Fixed squares added',
  minimum: 'Minimum squares (floor)',
  none: 'No waste added',
}

export interface WasteRule {
  type: WasteRuleType
  /** Percent (e.g. 10) for 'percent'; squares to add for 'fixed_squares'; floor for 'minimum'. */
  value: number | null
  /** Optional minimum-squares floor applied alongside 'percent'/'fixed_squares'. */
  minSquares: number | null
}

/**
 * Applies a campaign's waste rule to a measured square count. Pure and rounded
 * to 2 decimals. Returns both the waste added and the final billable squares so
 * a proposal can show the math. Never invents a measurement — callers pass a
 * real measured value or skip this entirely.
 */
export function applyWasteRule(measuredSquares: number, rule: WasteRule): { waste: number; final: number } {
  if (!Number.isFinite(measuredSquares) || measuredSquares < 0) return { waste: 0, final: 0 }
  const round = (n: number) => Math.round(n * 100) / 100

  let final = measuredSquares
  if (rule.type === 'percent' && rule.value != null) {
    final = measuredSquares * (1 + rule.value / 100)
  } else if (rule.type === 'fixed_squares' && rule.value != null) {
    final = measuredSquares + rule.value
  } else if (rule.type === 'minimum' && rule.value != null) {
    final = Math.max(measuredSquares, rule.value)
  }

  if (rule.minSquares != null) final = Math.max(final, rule.minSquares)
  final = round(final)
  return { waste: round(Math.max(0, final - measuredSquares)), final }
}

/** Batch counters shown on the Import Batches dashboard (§4.1). */
export interface BatchCounts {
  totalRows: number
  validRows: number
  duplicates: number
  rejected: number
  needsReview: number
  imported: number
  qualified: number
  disqualified: number
  crmCreated: number
  estimatesGenerated: number
  mailed: number
  errors: number
}

/**
 * Billable-squares computation for a prospect. Keeps the SOURCE measurement, the
 * base squares, the waste added, the rule used and any manual override all
 * separate — the provider measurement is never mutated into the billable number.
 */
export interface BillableSquares {
  sourceSquares: number | null   // exactly as measured — never overwritten
  baseSquares: number | null
  wasteSquares: number
  finalSquares: number | null
  ruleUsed: string
  manualOverride: boolean
}

export function computeBillableSquares(
  measuredSquares: number | null,
  rule: WasteRule,
  manualOverrideSquares?: number | null,
): BillableSquares {
  // A manual override is an authorized final figure and always wins, but the
  // measured value is preserved untouched for provenance.
  if (manualOverrideSquares != null && Number.isFinite(manualOverrideSquares) && manualOverrideSquares >= 0) {
    const round = (n: number) => Math.round(n * 100) / 100
    const final = round(manualOverrideSquares)
    const base = measuredSquares
    return {
      sourceSquares: measuredSquares,
      baseSquares: base,
      wasteSquares: base != null ? round(Math.max(0, final - base)) : 0,
      finalSquares: final,
      ruleUsed: 'manual_override',
      manualOverride: true,
    }
  }

  if (measuredSquares == null || !Number.isFinite(measuredSquares)) {
    return { sourceSquares: measuredSquares ?? null, baseSquares: null, wasteSquares: 0, finalSquares: null, ruleUsed: rule.type, manualOverride: false }
  }

  const { waste, final } = applyWasteRule(measuredSquares, rule)
  return {
    sourceSquares: measuredSquares,
    baseSquares: measuredSquares,
    wasteSquares: waste,
    finalSquares: final,
    ruleUsed: rule.type,
    manualOverride: false,
  }
}

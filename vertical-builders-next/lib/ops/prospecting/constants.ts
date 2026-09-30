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

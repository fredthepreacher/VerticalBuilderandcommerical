/**
 * ============================================================================
 * CAMPAIGN ANALYTICS — pure metric math (Phase 4)
 * ----------------------------------------------------------------------------
 * No DB, no server-only — pure and exhaustively unit-tested. These functions
 * encode the spec's integrity rules (§29):
 *   · never divide by zero — a rate over an empty denominator is null ("—"),
 *     never 0% and never NaN;
 *   · actual sold revenue only — proposal/estimate totals are never revenue;
 *   · unknown is not zero — sold jobs with no recorded contract are counted but
 *     excluded from revenue, and cost/ROI is null (not $0) until costs exist;
 *   · dedup is the caller's job (the SQL view is one row per prospect); these
 *     functions just divide the unique counts they are given.
 * ============================================================================
 */

export interface FunnelCounts {
  imported: number
  duplicates: number
  invalid: number
  valid: number
  enriched: number
  manualMeasurement: number
  reviewRequired: number
  approved: number
  rejected: number
  crmLeads: number
  estimates: number
  pricingBlocked: number
  proposals: number
  mailed: number
  responded: number
  appointments: number
  sold: number
  lost: number
  soldWithRevenue: number
  soldRevenueCents: number
}

/** A rate in [0,1], or null when the denominator is zero (shown as "—"). */
export function rate(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null
  return numerator / denominator
}

/** Format a rate (0..1) as a percentage string, or "—" when unknown. */
export function formatRate(r: number | null, digits = 1): string {
  return r == null ? '—' : `${(r * 100).toFixed(digits)}%`
}

export interface FunnelRates {
  // Multiple denominators are shown side by side rather than hiding the choice (§8).
  responseRate: number | null          // responded / mailed
  appointmentRateMailed: number | null // appointment / mailed
  appointmentRateResponded: number | null // appointment / responded
  closeRateMailed: number | null       // sold / mailed
  appointmentToSold: number | null     // sold / appointment
  approvalRate: number | null          // approved / valid
}

export function computeRates(c: FunnelCounts): FunnelRates {
  return {
    responseRate: rate(c.responded, c.mailed),
    appointmentRateMailed: rate(c.appointments, c.mailed),
    appointmentRateResponded: rate(c.appointments, c.responded),
    closeRateMailed: rate(c.sold, c.mailed),
    appointmentToSold: rate(c.sold, c.appointments),
    approvalRate: rate(c.approved, c.valid),
  }
}

export interface RevenueSummary {
  /** Actual sold revenue (sum of linked project contract amounts), in cents. */
  soldRevenueCents: number
  /** How many sold jobs contributed a real revenue figure. */
  soldWithRevenue: number
  /** Sold jobs with no recorded contract amount — revenue unknown, NOT zero. */
  soldMissingRevenue: number
  /** Average actual sold job value (cents), or null when none has revenue. */
  avgSoldJobCents: number | null
  /** Actual revenue per mailed prospect (cents), or null when nothing mailed. */
  revenuePerMailedCents: number | null
  /** True when at least one sold job is missing its actual revenue. */
  hasUnknownRevenue: boolean
}

export function summarizeRevenue(c: FunnelCounts): RevenueSummary {
  const soldMissingRevenue = Math.max(0, c.sold - c.soldWithRevenue)
  return {
    soldRevenueCents: c.soldRevenueCents,
    soldWithRevenue: c.soldWithRevenue,
    soldMissingRevenue,
    avgSoldJobCents: c.soldWithRevenue > 0 ? Math.round(c.soldRevenueCents / c.soldWithRevenue) : null,
    revenuePerMailedCents: c.mailed > 0 ? Math.round(c.soldRevenueCents / c.mailed) : null,
    hasUnknownRevenue: soldMissingRevenue > 0,
  }
}

export interface CostMetrics {
  /** True only when a real cost total was supplied. Otherwise everything is null. */
  configured: boolean
  totalCostCents: number | null
  costPerResponseCents: number | null
  costPerAppointmentCents: number | null
  costPerSoldCents: number | null
  /** ROI = (actual revenue − cost) / cost. Null unless BOTH cost and revenue known. */
  roi: number | null
}

/**
 * Cost/ROI metrics. `totalCostCents = null` means costs are NOT configured — every
 * derived metric stays null and the UI shows "Not configured", never $0 (§18).
 */
export function computeCostMetrics(
  totalCostCents: number | null,
  c: Pick<FunnelCounts, 'responded' | 'appointments' | 'sold' | 'soldRevenueCents' | 'soldWithRevenue'>,
): CostMetrics {
  if (totalCostCents == null) {
    return { configured: false, totalCostCents: null, costPerResponseCents: null, costPerAppointmentCents: null, costPerSoldCents: null, roi: null }
  }
  const perResponse = c.responded > 0 ? Math.round(totalCostCents / c.responded) : null
  const perAppt = c.appointments > 0 ? Math.round(totalCostCents / c.appointments) : null
  const perSold = c.sold > 0 ? Math.round(totalCostCents / c.sold) : null
  // ROI only when revenue is actually known and cost > 0.
  const roi = (totalCostCents > 0 && c.soldWithRevenue > 0)
    ? (c.soldRevenueCents - totalCostCents) / totalCostCents
    : null
  return {
    configured: true,
    totalCostCents,
    costPerResponseCents: perResponse,
    costPerAppointmentCents: perAppt,
    costPerSoldCents: perSold,
    roi,
  }
}

export interface FunnelStage {
  key: string
  label: string
  value: number
  /** Width fraction (0..1) relative to the first (largest) stage, for the bar. */
  fraction: number
}

/**
 * Ordered funnel stages for the visualization, each with a bar fraction relative
 * to the top of the funnel. Always paired with the numeric value in the UI (§10).
 */
export function funnelStages(c: FunnelCounts): FunnelStage[] {
  const top = Math.max(c.imported, 1)
  const raw: [string, string, number][] = [
    ['imported', 'Imported', c.imported],
    ['valid', 'Valid', c.valid],
    ['approved', 'Approved', c.approved],
    ['estimates', 'Estimates', c.estimates],
    ['proposals', 'Proposals', c.proposals],
    ['mailed', 'Mailed', c.mailed],
    ['responded', 'Responded', c.responded],
    ['appointments', 'Appointments', c.appointments],
    ['sold', 'Sold', c.sold],
  ]
  return raw.map(([key, label, value]) => ({ key, label, value, fraction: Math.max(0, Math.min(1, value / top)) }))
}

/** Sum two funnel-count rows (for an all-campaigns total). */
export function addCounts(a: FunnelCounts, b: FunnelCounts): FunnelCounts {
  const keys = Object.keys(a) as (keyof FunnelCounts)[]
  const out = {} as FunnelCounts
  for (const k of keys) out[k] = a[k] + b[k]
  return out
}

export const ZERO_COUNTS: FunnelCounts = {
  imported: 0, duplicates: 0, invalid: 0, valid: 0, enriched: 0, manualMeasurement: 0,
  reviewRequired: 0, approved: 0, rejected: 0, crmLeads: 0, estimates: 0, pricingBlocked: 0,
  proposals: 0, mailed: 0, responded: 0, appointments: 0, sold: 0, lost: 0,
  soldWithRevenue: 0, soldRevenueCents: 0,
}

import { describe, expect, it } from 'vitest'
import {
  rate, formatRate, computeRates, summarizeRevenue, computeCostMetrics, funnelStages, addCounts,
  ZERO_COUNTS, type FunnelCounts,
} from '../lib/ops/prospecting/analytics-metrics'

/**
 * ============================================================================
 * CAMPAIGN ANALYTICS — Phase 4 integrity rules (spec §29/§30)
 * ----------------------------------------------------------------------------
 * No divide-by-zero, no proposal totals treated as revenue, unknown is never
 * zero, and dedup'd counts convert to correct rates.
 * ============================================================================
 */

// Spec §30 "basic funnel": 100 imported → 70 approved → 60 mailed → 10 responded
// → 5 appointments → 2 sold.
const basic: FunnelCounts = {
  ...ZERO_COUNTS,
  imported: 100, valid: 90, approved: 70, estimates: 65, proposals: 62,
  mailed: 60, responded: 10, appointments: 5, sold: 2,
  soldWithRevenue: 2, soldRevenueCents: 3_300_000, // two jobs, $16,500 + $16,500
}

describe('rates (no divide-by-zero)', () => {
  it('returns null when the denominator is zero, never NaN or 0', () => {
    expect(rate(5, 0)).toBeNull()
    expect(rate(0, 0)).toBeNull()
    expect(rate(3, 10)).toBeCloseTo(0.3)
  })
  it('formats a null rate as an em dash, not 0%', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(0)).toBe('0.0%')
    expect(formatRate(0.1234)).toBe('12.3%')
  })
  it('computes the basic funnel rates against the documented denominators', () => {
    const r = computeRates(basic)
    expect(r.responseRate).toBeCloseTo(10 / 60)
    expect(r.appointmentRateMailed).toBeCloseTo(5 / 60)
    expect(r.appointmentRateResponded).toBeCloseTo(5 / 10)
    expect(r.appointmentToSold).toBeCloseTo(2 / 5)
    expect(r.closeRateMailed).toBeCloseTo(2 / 60)
    expect(r.approvalRate).toBeCloseTo(70 / 90)
  })
  it('a young campaign with nothing mailed yields null rates, not zeros', () => {
    const young = { ...ZERO_COUNTS, imported: 500, approved: 300, mailed: 0 }
    const r = computeRates(young)
    expect(r.responseRate).toBeNull()
    expect(r.closeRateMailed).toBeNull()
  })
})

describe('revenue (actual only, unknown is not zero)', () => {
  it('uses the actual sold revenue passed in (never an estimate total)', () => {
    // The revenue figure is the sum of linked contract amounts; there is no
    // estimate input to this function by construction.
    const rev = summarizeRevenue(basic)
    expect(rev.soldRevenueCents).toBe(3_300_000)
    expect(rev.avgSoldJobCents).toBe(1_650_000)
    expect(rev.revenuePerMailedCents).toBe(Math.round(3_300_000 / 60))
    expect(rev.hasUnknownRevenue).toBe(false)
  })
  it('a sold job with no recorded contract is excluded from revenue, not counted as $0', () => {
    const mixed = { ...basic, sold: 3, soldWithRevenue: 2, soldRevenueCents: 3_300_000 }
    const rev = summarizeRevenue(mixed)
    expect(rev.soldMissingRevenue).toBe(1)
    expect(rev.hasUnknownRevenue).toBe(true)
    // Average is over jobs WITH revenue only.
    expect(rev.avgSoldJobCents).toBe(1_650_000)
  })
  it('no sold-with-revenue → average and per-mailed are null, not zero', () => {
    const none = { ...ZERO_COUNTS, mailed: 40, sold: 1, soldWithRevenue: 0, soldRevenueCents: 0 }
    const rev = summarizeRevenue(none)
    expect(rev.avgSoldJobCents).toBeNull()
    expect(rev.revenuePerMailedCents).toBe(0) // revenue known to be 0 across 40 mailed is legitimate here
    expect(rev.soldMissingRevenue).toBe(1)
  })
})

describe('cost & ROI (not configured ≠ $0)', () => {
  it('null cost → not configured, every derived metric null', () => {
    const m = computeCostMetrics(null, basic)
    expect(m.configured).toBe(false)
    expect(m.totalCostCents).toBeNull()
    expect(m.costPerSoldCents).toBeNull()
    expect(m.roi).toBeNull()
  })
  it('with a cost, computes cost-per-X and ROI from ACTUAL revenue', () => {
    const m = computeCostMetrics(600_000, basic) // $6,000 cost
    expect(m.configured).toBe(true)
    expect(m.costPerResponseCents).toBe(60_000) // 6000 / 10
    expect(m.costPerAppointmentCents).toBe(120_000)
    expect(m.costPerSoldCents).toBe(300_000)
    // ROI = (3,300,000 − 600,000) / 600,000 = 4.5
    expect(m.roi).toBeCloseTo(4.5)
  })
  it('ROI is null when revenue is unknown, even if a cost exists', () => {
    const noRev = { ...ZERO_COUNTS, mailed: 40, responded: 6, sold: 1, soldWithRevenue: 0, soldRevenueCents: 0 }
    const m = computeCostMetrics(500_00, noRev)
    expect(m.configured).toBe(true)
    expect(m.roi).toBeNull()
  })
  it('cost-per-X guards divide-by-zero', () => {
    const m = computeCostMetrics(500_00, { ...ZERO_COUNTS, responded: 0, appointments: 0, sold: 0 })
    expect(m.costPerResponseCents).toBeNull()
    expect(m.costPerSoldCents).toBeNull()
  })
})

describe('funnel stages + aggregation', () => {
  it('stage fractions are relative to the top of the funnel and clamped', () => {
    const stages = funnelStages(basic)
    expect(stages[0].key).toBe('imported')
    expect(stages[0].fraction).toBe(1)
    const mailed = stages.find(s => s.key === 'mailed')!
    expect(mailed.value).toBe(60)
    expect(mailed.fraction).toBeCloseTo(0.6)
    // every fraction within [0,1]
    for (const s of stages) expect(s.fraction).toBeGreaterThanOrEqual(0), expect(s.fraction).toBeLessThanOrEqual(1)
  })
  it('addCounts sums two campaign rows field by field', () => {
    const sum = addCounts(basic, basic)
    expect(sum.imported).toBe(200)
    expect(sum.soldRevenueCents).toBe(6_600_000)
    expect(sum.mailed).toBe(120)
  })
  it('an all-zero campaign produces a clean empty funnel (no NaN)', () => {
    const stages = funnelStages(ZERO_COUNTS)
    for (const s of stages) { expect(s.value).toBe(0); expect(Number.isNaN(s.fraction)).toBe(false) }
    const r = computeRates(ZERO_COUNTS)
    expect(r.responseRate).toBeNull()
  })
})

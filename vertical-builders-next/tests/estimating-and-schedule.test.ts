import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sanitizeResult, PROMPT_VERSION, type EstimateGenerationInput } from '../lib/ops/estimating/ai'
import {
  deriveQuantities, describeProviderConfig, getProvider, manualProvider, mapReport,
} from '../lib/ops/measurements/provider'
import { barGeometry, buildTimeline, resolveDates, type ScheduleBar } from '../lib/ops/services/schedule'

// ---------------------------------------------------------------------------
// AI estimate sanitisation — the price safety boundary
// ---------------------------------------------------------------------------

const pricebook = [
  {
    id: 'pb-shingle', name: 'Architectural shingle roof', unit: 'SQ',
    default_unit_price_cents: 45_000, category: 'Roofing', service_type: 'Roofing',
    description: null, default_material_cost_cents: null, default_labor_cost_cents: null,
    active: true, tags: [],
  },
  {
    id: 'pb-unpriced', name: 'Permit fee', unit: 'EA',
    default_unit_price_cents: 0, category: 'General', service_type: null,
    description: null, default_material_cost_cents: null, default_labor_cost_cents: null,
    active: true, tags: ['needs-price'],
  },
] as unknown as Parameters<typeof sanitizeResult>[1]

const input: EstimateGenerationInput = {
  serviceType: 'Roofing',
  property: { address: '1 Test St', city: 'Nokomis', state: 'FL', zip: '34275' },
  customerRequest: 'Full tear-off and re-roof',
  pricebook,
}

const provider = { provider: 'openai', model: 'test-model' }

describe('sanitizeResult — AI can never set a price', () => {
  it('takes the unit price from the pricebook, discarding whatever the model produced', () => {
    const result = sanitizeResult({
      scopeSummary: 'Re-roof',
      lineItems: [{
        pricebookItemId: 'pb-shingle', description: 'Install shingles',
        quantity: 32, unit: 'EA', suggestedUnitPriceCents: 999_999, unitPrice: 1234,
      }],
    }, pricebook, input, provider)

    expect(result.lineItems[0].suggestedUnitPriceCents).toBe(45_000)
    expect(result.lineItems[0].needsReview).toBe(false)
  })

  it('leaves the price unset and flags review when the line has no pricebook backing', () => {
    const result = sanitizeResult({
      lineItems: [{ description: 'Some invented scope', quantity: 1, suggestedUnitPriceCents: 500_00 }],
    }, pricebook, input, provider)

    expect(result.lineItems[0].suggestedUnitPriceCents).toBeUndefined()
    expect(result.lineItems[0].needsReview).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/not in the pricebook/i)
  })

  it('flags review when the pricebook item exists but has never been priced', () => {
    const result = sanitizeResult({
      lineItems: [{ pricebookItemId: 'pb-unpriced', description: 'Permit', quantity: 1 }],
    }, pricebook, input, provider)

    expect(result.lineItems[0].needsReview).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/no price set/i)
  })

  it('warns and drops the reference when the model invents a pricebook id', () => {
    const result = sanitizeResult({
      lineItems: [{ pricebookItemId: 'pb-does-not-exist', description: 'Ghost line', quantity: 1 }],
    }, pricebook, input, provider)

    expect(result.lineItems[0].pricebookItemId).toBeUndefined()
    expect(result.lineItems[0].needsReview).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/does not exist/i)
  })

  it('takes the unit from the pricebook, not from the model', () => {
    const result = sanitizeResult({
      lineItems: [{ pricebookItemId: 'pb-shingle', description: 'Shingles', quantity: 10, unit: 'GALLONS' }],
    }, pricebook, input, provider)
    expect(result.lineItems[0].unit).toBe('SQ')
  })

  it('defaults an unusable quantity to 1 and says so', () => {
    const result = sanitizeResult({
      lineItems: [{ pricebookItemId: 'pb-shingle', description: 'Shingles', quantity: 'lots' }],
    }, pricebook, input, provider)
    expect(result.lineItems[0].quantity).toBe(1)
    expect(result.warnings.join(' ')).toMatch(/defaulted to 1/i)
  })

  it('drops lines with no description rather than emitting a blank row', () => {
    const result = sanitizeResult({
      lineItems: [{ description: '   ', quantity: 5 }, { description: 'Real line', quantity: 1 }],
    }, pricebook, input, provider)
    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].description).toBe('Real line')
  })

  it('caps the number of lines so a runaway response cannot flood an estimate', () => {
    const lineItems = Array.from({ length: 200 }, (_, i) => ({ description: `Line ${i}`, quantity: 1 }))
    expect(sanitizeResult({ lineItems }, pricebook, input, provider).lineItems).toHaveLength(60)
  })

  it('warns when a roofing estimate has no measurement attached', () => {
    const result = sanitizeResult({
      lineItems: [{ pricebookItemId: 'pb-shingle', description: 'Shingles', quantity: 30 }],
    }, pricebook, input, provider)
    expect(result.warnings.join(' ')).toMatch(/no roof measurement/i)
  })

  it('says plainly when nothing usable came back', () => {
    const result = sanitizeResult({}, pricebook, input, provider)
    expect(result.lineItems).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/did not produce any usable line items/i)
  })

  it('records provenance — provider, model and prompt version — on every draft', () => {
    const result = sanitizeResult({ lineItems: [] }, pricebook, input, provider)
    expect(result.metadata.provider).toBe('openai')
    expect(result.metadata.model).toBe('test-model')
    expect(result.metadata.promptVersion).toBe(PROMPT_VERSION)
    expect(result.metadata.pricebookItemsOffered).toBe(2)
  })

  it('survives a completely malformed response without throwing', () => {
    for (const junk of [null, undefined, 'a string', 42, { lineItems: 'not an array' }]) {
      expect(() => sanitizeResult(junk, pricebook, input, provider)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// Roof measurements
// ---------------------------------------------------------------------------

describe('deriveQuantities', () => {
  it('converts square feet to squares to one decimal', () => {
    expect(deriveQuantities({ roof_area_sqft: 3_247 }).squares).toBe(32.5)
  })

  it('prefers an explicit squares figure over deriving one', () => {
    expect(deriveQuantities({ roof_area_sqft: 3_247, roof_area_squares: 33 }).squares).toBe(33)
  })

  it('applies the waste factor from the report, falling back to the default', () => {
    expect(deriveQuantities({ roof_area_squares: 30, waste_factor_percent: 15 }).squaresWithWaste).toBe(34.5)
    expect(deriveQuantities({ roof_area_squares: 30 }).squaresWithWaste).toBe(33)
    expect(deriveQuantities({ roof_area_squares: 30 }, 20).squaresWithWaste).toBe(36)
  })

  it('adds ridge and hip, and eave and rake, into the numbers an estimator actually orders', () => {
    const q = deriveQuantities({ ridge_lf: 42.4, hip_lf: 18.2, eave_lf: 120, rake_lf: 60 })
    expect(q.ridgeAndHipLf).toBe(61)
    expect(q.perimeterLf).toBe(180)
    expect(q.starterLf).toBe(120)
  })

  it('returns nulls rather than zeros when the geometry is simply unknown', () => {
    expect(deriveQuantities({})).toEqual({
      squares: null, squaresWithWaste: null, ridgeAndHipLf: null, perimeterLf: null, starterLf: null,
    })
  })
})

describe('mapReport', () => {
  it('reads EagleView-style keys', () => {
    const result = mapReport({
      TotalRoofArea: 3_400, PredominantPitch: '6/12', NumberOfFacets: 9,
      RidgeLength: 60, HipLength: 20, ValleyLength: 15, EaveLength: 140, RakeLength: 70,
      SuggestedWaste: 12, CapturedDate: '2026-07-01',
    }, 'ev-123')

    expect(result.roofAreaSqft).toBe(3_400)
    expect(result.roofAreaSquares).toBe(34)
    expect(result.primaryPitch).toBe('6/12')
    expect(result.facetCount).toBe(9)
    expect(result.wasteFactorPercent).toBe(12)
    expect(result.externalReportId).toBe('ev-123')
  })

  it('reads nested Nearmap-style keys', () => {
    const result = mapReport({ roof: { squares: 22.5, pitch: '4/12', ridgeLf: 30 } }, 'nm-1')
    expect(result.roofAreaSquares).toBe(22.5)
    expect(result.roofAreaSqft).toBe(2_250)
    expect(result.ridgeLf).toBe(30)
  })

  it('coerces numeric strings but leaves genuinely absent values null', () => {
    const result = mapReport({ TotalSquares: '28.4', RidgeLength: '' }, 'x')
    expect(result.roofAreaSquares).toBe(28.4)
    expect(result.ridgeLf).toBeNull()
    expect(result.valleyLf).toBeNull()
  })

  it('does not invent geometry from an empty payload', () => {
    const result = mapReport({}, 'x')
    expect(result.roofAreaSqft).toBeNull()
    expect(result.roofAreaSquares).toBeNull()
    expect(result.primaryPitch).toBeNull()
  })

  it('keeps the raw payload so a disputed number can be traced to its source', () => {
    const payload = { TotalSquares: 30, vendorField: 'abc' }
    expect(mapReport(payload, 'x').raw).toEqual(payload)
  })
})

describe('provider selection', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => { delete process.env.ROOF_MEASUREMENT_PROVIDER })
  afterEach(() => { process.env = { ...ORIGINAL } })

  it('falls back to manual entry for an unknown provider name', () => {
    expect(getProvider('does-not-exist')).toBe(manualProvider)
    expect(getProvider(null)).toBe(manualProvider)
  })

  it('reports an unconfigured provider instead of failing at order time', () => {
    const state = describeProviderConfig('eagleview')
    expect(state.configured).toBe(false)
    expect(state.action).toMatch(/credentials are not set/i)
    // Nothing is blocked: manual entry is always offered as the way through.
    expect(state.action).toMatch(/manual entry/i)
  })

  it('always reports manual entry as available', () => {
    expect(describeProviderConfig('manual').configured).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

describe('resolveDates', () => {
  it('uses the scheduled dates when both are set, and does not call them estimated', () => {
    const result = resolveDates({ scheduled_start_date: '2026-09-01', scheduled_end_date: '2026-09-20' })
    expect(result).toEqual({ start: '2026-09-01', end: '2026-09-20', isEstimated: false })
  })

  it('falls back to the project dates, marking the bar as estimated', () => {
    const result = resolveDates({ start_date: '2026-09-01', estimated_completion_date: '2026-09-10' })
    expect(result).toMatchObject({ start: '2026-09-01', end: '2026-09-10', isEstimated: true })
  })

  it('falls back to created_at plus a visible two-week placeholder', () => {
    const result = resolveDates({ created_at: '2026-09-01T10:00:00Z' })
    expect(result).toMatchObject({ start: '2026-09-01', end: '2026-09-15', isEstimated: true })
  })

  it('shows a one-day bar rather than nothing when the dates are backwards', () => {
    const result = resolveDates({ scheduled_start_date: '2026-09-20', scheduled_end_date: '2026-09-01' })
    expect(result).toMatchObject({ start: '2026-09-20', end: '2026-09-20' })
  })

  it('returns null when there is no date to work from at all', () => {
    expect(resolveDates({})).toBeNull()
  })
})

describe('buildTimeline and barGeometry', () => {
  const today = new Date('2026-09-10T00:00:00Z')
  const bars: ScheduleBar[] = [
    { start: '2026-09-01', end: '2026-09-30' } as ScheduleBar,
    { start: '2026-10-15', end: '2026-11-05' } as ScheduleBar,
  ]

  it('spans every bar plus padding', () => {
    const window = buildTimeline(bars, 'week', today)
    expect(window.start <= '2026-09-01').toBe(true)
    expect(window.end >= '2026-11-05').toBe(true)
    expect(window.totalDays).toBeGreaterThan(60)
  })

  it('renders a sensible axis for an empty schedule instead of collapsing', () => {
    const window = buildTimeline([], 'week', today)
    expect(window.totalDays).toBeGreaterThan(1)
    expect(window.ticks.length).toBeGreaterThan(1)
  })

  it('places a today marker inside the window', () => {
    const window = buildTimeline(bars, 'week', today)
    expect(window.todayOffsetPercent).not.toBeNull()
    expect(window.todayOffsetPercent!).toBeGreaterThanOrEqual(0)
    expect(window.todayOffsetPercent!).toBeLessThanOrEqual(100)
  })

  it('keeps every bar inside 0–100% of the window', () => {
    const window = buildTimeline(bars, 'week', today)
    for (const bar of bars) {
      const geo = barGeometry(bar, window)
      expect(geo.leftPercent).toBeGreaterThanOrEqual(0)
      expect(geo.leftPercent + geo.widthPercent).toBeLessThanOrEqual(100.001)
    }
  })

  it('gives a single-day job a visible bar rather than a hairline', () => {
    const window = buildTimeline([], 'month', today)
    const geo = barGeometry({ start: '2026-09-12', end: '2026-09-12' } as ScheduleBar, window)
    expect(geo.widthPercent).toBeGreaterThanOrEqual(0.6)
  })
})

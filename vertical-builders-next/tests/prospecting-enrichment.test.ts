import { describe, expect, it } from 'vitest'
import { classifyPermit } from '../lib/ops/prospecting/permit-classifier'
import { computeConfidence } from '../lib/ops/prospecting/confidence'
import { evaluateProspect, yearsSince } from '../lib/ops/prospecting/screening'
import { enrichProspect } from '../lib/ops/prospecting/enrichment'
import { computeBillableSquares } from '../lib/ops/prospecting/constants'
import { computeCostPreview } from '../lib/ops/prospecting/cost'
import { assessMeasurementType } from '../lib/ops/prospecting/measurement'

const NOW = new Date('2026-09-30T00:00:00Z')
const SHINGLE_CAMPAIGN = { roofTypes: ['shingle'], minRoofAgeYears: 15, autoQualifyEnabled: false, wasteRule: { type: 'percent' as const, value: 10, minSquares: null } }

// ---------------------------------------------------------------------------
// Permit classifier — messy realistic descriptions
// ---------------------------------------------------------------------------
describe('permit classifier', () => {
  const cases: [string, string, string][] = [
    ['Reroof', 'REROOF SHINGLE', 'full_replacement'],
    ['Re-roof hyphen', 're-roof, tear off to deck', 'full_replacement'],
    ['Replacement', 'ROOF REPLACEMENT - remove and replace', 'full_replacement'],
    ['Reshingle', 'reshingle entire home', 'full_replacement'],
    ['Tear off + repair decking', 'tear off and repair rotten decking', 'full_replacement'],
    ['Repair', 'roof repair - fix leak over garage', 'repair'],
    ['Patch', 'patch roof, replace 10 shingles', 'repair'],
    ['Recover', 'roof recover / overlay single layer', 'recover'],
    ['Inspection', 'roof inspection only', 'inspection'],
    ['Certification', 'roof certification for insurance', 'inspection'],
    ['Solar', 'solar PV panel install roof mount', 'solar_roof'],
    ['Ambiguous', 'roofing work', 'unknown_roof'],
    ['Not roof', 'kitchen remodel and electrical', 'not_roof'],
  ]
  for (const [name, desc, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      const r = classifyPermit({ permitDescription: desc })
      expect(r.permitClass).toBe(expected)
      expect(r.sourceText).toBe(desc)          // original preserved
      expect(r.reasons.length).toBeGreaterThan(0)
    })
  }
  it('only full_replacement is a replacement', () => {
    expect(classifyPermit({ permitDescription: 'roof repair' }).isFullReplacement).toBe(false)
    expect(classifyPermit({ permitDescription: 'solar roof mount' }).isFullReplacement).toBe(false)
    expect(classifyPermit({ permitDescription: 'reroof' }).isFullReplacement).toBe(true)
  })
  it('detects material family', () => {
    expect(classifyPermit({ permitDescription: 'reroof with metal standing seam' }).material).toBe('metal')
    expect(classifyPermit({ permitDescription: 'tile reroof' }).material).toBe('tile')
  })
})

// ---------------------------------------------------------------------------
// Confidence — explainable bands
// ---------------------------------------------------------------------------
describe('confidence', () => {
  it('HIGH when everything lines up', () => {
    const r = computeConfidence({ addressMatch: 'exact', parcelPresent: true, measurementType: 'verified_roof_surface', permitQuality: 'structured' })
    expect(r.band).toBe('high')
  })
  it('LOW with no measurement', () => {
    expect(computeConfidence({ addressMatch: 'exact', parcelPresent: true, measurementType: null, permitQuality: 'structured' }).band).toBe('low')
  })
  it('LOW when only a footprint', () => {
    expect(computeConfidence({ addressMatch: 'exact', parcelPresent: true, measurementType: 'building_footprint', permitQuality: 'structured' }).band).toBe('low')
  })
  it('LOW on conflict', () => {
    expect(computeConfidence({ addressMatch: 'exact', parcelPresent: true, measurementType: 'verified_roof_surface', permitQuality: 'structured', conflict: true }).band).toBe('low')
  })
  it('MEDIUM on a soft gap (provider estimate, no parcel)', () => {
    expect(computeConfidence({ addressMatch: 'exact', parcelPresent: false, measurementType: 'provider_estimate', permitQuality: 'free_text' }).band).toBe('medium')
  })
  it('reasons are populated', () => {
    expect(computeConfidence({ addressMatch: 'none', parcelPresent: false, measurementType: null, permitQuality: 'none' }).reasons.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Screening — the client's required scenarios
// ---------------------------------------------------------------------------
describe('screening decisions', () => {
  const base = {
    isDuplicate: false, addressMatch: 'exact' as const, addressUsable: true, parcelPresent: true,
    roofFamily: 'shingle' as string | null,
    permit: classifyPermit({ permitDescription: 'reroof shingle' }),
    permitDateIso: '2010-01-01', measurementType: 'verified_roof_surface' as const, conflict: false,
  }

  it('recent full reroof → DISQUALIFY (new roof)', () => {
    const r = evaluateProspect({ ...base, permit: classifyPermit({ permitDescription: 'reroof' }), permitDateIso: '2024-05-12' }, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).toBe('DISQUALIFY')
    expect(r.status).toBe('disqualified_new_roof')
    expect(r.reasons[0]).toMatch(/replacement permit dated 2024-05-12/i)
  })

  it('recent REPAIR is NOT treated as a replacement', () => {
    const r = evaluateProspect({ ...base, permit: classifyPermit({ permitDescription: 'roof repair leak' }), permitDateIso: '2024-05-12' }, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).not.toBe('DISQUALIFY')  // a repair does not disqualify
  })

  it('ambiguous permit + good candidate → REVIEW_REQUIRED', () => {
    const r = evaluateProspect({ ...base, permit: classifyPermit({ permitDescription: 'roofing work' }), permitDateIso: null }, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).toBe('REVIEW_REQUIRED')
  })

  it('wrong roof type (metal in shingle campaign) → DISQUALIFY', () => {
    const r = evaluateProspect({ ...base, roofFamily: 'metal' }, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).toBe('DISQUALIFY')
    expect(r.status).toBe('disqualified_wrong_roof_type')
  })

  it('old shingle, no recent reroof, has measurement → REVIEW_REQUIRED (auto-qualify OFF)', () => {
    const r = evaluateProspect({ ...base, permit: classifyPermit({ permitDescription: 'roof repair 2005' }), permitDateIso: '2005-01-01' }, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).toBe('REVIEW_REQUIRED')
    expect(r.status).toBe('review_required')
    expect(r.screeningDecision).toBeNull()
  })

  it('no measurement → MANUAL_MEASUREMENT_REQUIRED, nothing fabricated', () => {
    const r = evaluateProspect({ ...base, measurementType: null }, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).toBe('MANUAL_MEASUREMENT_REQUIRED')
    expect(r.status).toBe('manual_measurement_required')
  })

  it('confirmed duplicate → DISQUALIFY (reject_duplicate)', () => {
    const r = evaluateProspect({ ...base, isDuplicate: true }, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).toBe('DISQUALIFY')
    expect(r.screeningDecision).toBe('reject_duplicate')
  })

  it('auto-qualify never fires while disabled, even for a perfect candidate', () => {
    const r = evaluateProspect(base, SHINGLE_CAMPAIGN, NOW)
    expect(r.outcome).toBe('REVIEW_REQUIRED')
  })

  it('auto-qualify CAN fire when a campaign enables it and confidence is HIGH', () => {
    // Structured permit (type + description) → HIGH confidence, the bar for auto-qualify.
    const structured = { ...base, permit: classifyPermit({ permitType: 'Reroof', permitDescription: 'reroof shingle 2009' }) }
    const r = evaluateProspect(structured, { ...SHINGLE_CAMPAIGN, autoQualifyEnabled: true }, NOW)
    expect(r.outcome).toBe('QUALIFIED_FOR_MAILING')
    expect(r.status).toBe('qualified')
  })
})

// ---------------------------------------------------------------------------
// Enrichment engine — free stages + measurement boundary
// ---------------------------------------------------------------------------
describe('enrichment engine', () => {
  const p = {
    isDuplicate: false, addressKey: '4386 sibley bay st 33980', parcelApn: '402205551007',
    roofType: 'Asphalt Shingle', permitType: 'Reroof', permitDescription: 'reroof shingle',
    permitDateIso: '2008-06-01', existingMeasurementType: null, existingMeasuredSquares: null,
  }

  it('no provider configured → finalizes as manual measurement, no fabrication', () => {
    const r = enrichProspect(p, SHINGLE_CAMPAIGN, { providerReady: false, now: NOW })
    expect(r.stage).toBe('finalized')
    expect(r.screening.outcome).toBe('MANUAL_MEASUREMENT_REQUIRED')
    expect(r.billable).toBeNull()
    expect(r.deferredForMeasurement).toBe(false)
  })

  it('provider configured but no measurement yet → DEFERRED at measurement (no call)', () => {
    const r = enrichProspect(p, SHINGLE_CAMPAIGN, { providerReady: true, now: NOW })
    expect(r.stage).toBe('measurement')
    expect(r.deferredForMeasurement).toBe(true)
  })

  it('recent reroof disqualifies even with no provider/measurement', () => {
    const r = enrichProspect({ ...p, permitDateIso: '2025-01-01' }, SHINGLE_CAMPAIGN, { providerReady: true, now: NOW })
    expect(r.stage).toBe('finalized')
    expect(r.screening.status).toBe('disqualified_new_roof')
  })

  it('existing verified measurement → computes billable squares, source preserved', () => {
    const r = enrichProspect(
      { ...p, existingMeasurementType: 'verified_roof_surface', existingMeasuredSquares: 30 },
      SHINGLE_CAMPAIGN, { providerReady: false, now: NOW },
    )
    expect(r.stage).toBe('finalized')
    expect(r.billable?.sourceSquares).toBe(30)   // never overwritten
    expect(r.billable?.finalSquares).toBe(33)    // +10%
    expect(r.screening.outcome).toBe('REVIEW_REQUIRED')
  })
})

// ---------------------------------------------------------------------------
// Waste + measurement assessment + cost preview
// ---------------------------------------------------------------------------
describe('waste billable squares', () => {
  it('percent / fixed / minimum / manual override, source never mutated', () => {
    expect(computeBillableSquares(53, { type: 'percent', value: 10, minSquares: null })).toMatchObject({ sourceSquares: 53, finalSquares: 58.3, manualOverride: false })
    expect(computeBillableSquares(53, { type: 'fixed_squares', value: 2, minSquares: null }).finalSquares).toBe(55)
    expect(computeBillableSquares(8, { type: 'minimum', value: 10, minSquares: null }).finalSquares).toBe(10)
    const o = computeBillableSquares(53, { type: 'percent', value: 10, minSquares: null }, 60)
    expect(o).toMatchObject({ sourceSquares: 53, finalSquares: 60, manualOverride: true, ruleUsed: 'manual_override' })
  })
})

describe('measurement assessment', () => {
  it('never promotes a footprint to a verified surface', () => {
    expect(assessMeasurementType({ provider: 'county', roof_area_squares: null, roof_area_sqft: null, building_footprint_sqft: 2000 })).toBe('building_footprint')
    expect(assessMeasurementType({ provider: 'eagleview', roof_area_squares: 24, roof_area_sqft: 2400 })).toBe('verified_roof_surface')
    expect(assessMeasurementType({ provider: 'nearmap', roof_area_squares: 24, roof_area_sqft: 2400 })).toBe('provider_estimate')
    expect(assessMeasurementType({ provider: 'manual', roof_area_squares: 24, roof_area_sqft: 2400 })).toBe('manual')
    expect(assessMeasurementType(null)).toBeNull()
  })
})

describe('cost preview never shows a fake $0', () => {
  it('pricing unknown → cost unavailable, paid enrichment blocked', () => {
    const r = computeCostPreview(
      { totalProspects: 2000, alreadyEnriched: 0, cachedMeasurements: 1420, manualMeasurementRecords: 0, measurementsRequired: 580, unitCostCents: null },
      /* providerReady */ false,
    )
    expect(r.estimatedCostCents).toBeNull()
    expect(r.pricingConfigured).toBe(false)
    expect(r.paidEnrichmentBlocked).toBe(true)
    expect(r.message).toMatch(/580 properties require a paid measurement lookup/i)
    expect(r.message).toMatch(/pricing has not been configured/i)
    expect(r.message).not.toContain('$0')
  })
  it('with configured pricing + provider, computes a real estimate', () => {
    const r = computeCostPreview(
      { totalProspects: 100, alreadyEnriched: 0, cachedMeasurements: 40, manualMeasurementRecords: 0, measurementsRequired: 60, unitCostCents: 2500 },
      true,
    )
    expect(r.pricingConfigured).toBe(true)
    expect(r.estimatedCostCents).toBe(150000)
    expect(r.paidEnrichmentBlocked).toBe(false)
  })
})

describe('yearsSince', () => {
  it('computes whole-ish years and clamps future dates to 0', () => {
    expect(Math.round(yearsSince('2016-09-30', NOW)!)).toBe(10)
    expect(yearsSince('2030-01-01', NOW)).toBe(0)
    expect(yearsSince(null)).toBeNull()
  })
})

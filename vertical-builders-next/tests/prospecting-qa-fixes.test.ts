import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignSchema } from '../lib/ops/validations/prospecting'
import { saveCampaign } from '../lib/ops/prospecting/campaigns'
import { evaluateProspect } from '../lib/ops/prospecting/screening'
import { classifyPermit } from '../lib/ops/prospecting/permit-classifier'
import { computeCostPreview } from '../lib/ops/prospecting/cost'

/**
 * ============================================================================
 * LIVE QA FIX PASS — regression tests for issues B, D, F
 * ============================================================================
 */

// ---- B: campaign min-roof-age persists and screening uses it ----------------
describe('B · campaign min_roof_age_years persistence + screening use', () => {
  it('schema coerces the submitted string to a number', () => {
    const parsed = campaignSchema.parse({ name: 'QA', min_roof_age_years: '10', waste_rule_type: 'fixed_squares', waste_rule_value: '2' })
    expect(parsed.min_roof_age_years).toBe(10)
    expect(typeof parsed.min_roof_age_years).toBe('number')
  })

  it('saveCampaign writes the edited value (7 → 10) to the update row', async () => {
    let updatedRow: Record<string, unknown> | null = null
    const fake = {
      from(table: string) {
        if (table === 'prospecting_campaigns') {
          return {
            update(row: Record<string, unknown>) {
              updatedRow = row
              return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'c1' }, error: null }) }) }) }
            },
          }
        }
        return { insert: async () => ({ error: null }) } // activity_log
      },
    }
    const input = campaignSchema.parse({ name: 'QA', min_roof_age_years: '10', waste_rule_type: 'percent', waste_rule_value: '2' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await saveCampaign(fake as any, input, { userId: 'u1', campaignId: 'c1' })
    expect(res.id).toBe('c1')
    expect(updatedRow).not.toBeNull()
    expect((updatedRow as unknown as Record<string, unknown>).min_roof_age_years).toBe(10)
  })

  it('screening actually applies the saved threshold (7 vs 10 changes the outcome)', () => {
    const now = new Date('2026-10-02T00:00:00Z')
    const permit = classifyPermit({ permitType: 'Reroof', permitDescription: 'full roof replacement, tear off to deck' })
    expect(permit.isFullReplacement).toBe(true)
    const evidence = {
      addressMatch: 'partial' as const, addressUsable: true, parcelPresent: true,
      roofFamily: 'shingle', permit, permitDateIso: '2018-01-01', // ~8.7 yrs old
      measurementType: 'manual' as const,
    }
    // Threshold 7: an ~8.7-yr-old roof is OLDER than 7 → NOT rejected as a new roof.
    const at7 = evaluateProspect(evidence, { roofTypes: ['shingle'], minRoofAgeYears: 7, autoQualifyEnabled: false }, now)
    expect(at7.status).not.toBe('disqualified_new_roof')
    // Threshold 10: the same roof is YOUNGER than 10 → rejected as a new roof.
    const at10 = evaluateProspect(evidence, { roofTypes: ['shingle'], minRoofAgeYears: 10, autoQualifyEnabled: false }, now)
    expect(at10.status).toBe('disqualified_new_roof')
  })
})

// ---- D: provider-cost copy is manual-mode aware -----------------------------
describe('D · cost preview wording in manual / kill-switch mode', () => {
  const base = { totalProspects: 6, alreadyEnriched: 0, cachedMeasurements: 0, manualMeasurementRecords: 0, measurementsRequired: 4 }

  it('manual mode speaks of MANUAL measurement, never a paid lookup', () => {
    const c = computeCostPreview({ ...base, unitCostCents: null, manualMode: true }, false)
    expect(c.message).toMatch(/manual roof measurement/i)
    expect(c.message).toMatch(/no paid provider calls will be made/i)
    expect(c.message).not.toMatch(/paid measurement lookup/i)
    expect(c.estimatedCostCents).toBeNull()
    expect(c.paidEnrichmentBlocked).toBe(true)
  })

  it('manual mode with nothing outstanding says so plainly', () => {
    const c = computeCostPreview({ ...base, measurementsRequired: 0, unitCostCents: null, manualMode: true }, false)
    expect(c.message).toMatch(/no roof measurements are outstanding/i)
    expect(c.message).not.toMatch(/paid/i)
  })

  it('live provider configured but pricing missing KEEPS the paid-cost warning', () => {
    const c = computeCostPreview({ ...base, unitCostCents: null, manualMode: false }, true)
    expect(c.message).toMatch(/paid measurement lookup/i)
    expect(c.message).toMatch(/pricing has not been configured/i)
    expect(c.estimatedCostCents).toBeNull()
  })

  it('live provider + pricing configured shows an actual estimate', () => {
    const c = computeCostPreview({ ...base, unitCostCents: 2500, manualMode: false }, true)
    expect(c.estimatedCostCents).toBe(4 * 2500)
    expect(c.message).toMatch(/\$100\.00/)
    expect(c.paidEnrichmentBlocked).toBe(false)
  })

  it('never prints a $0 cost when pricing is unknown', () => {
    for (const manualMode of [true, false]) {
      const c = computeCostPreview({ ...base, unitCostCents: null, manualMode }, !manualMode)
      expect(c.message).not.toMatch(/\$0\.00/)
    }
  })
})

// ---- F: waste rule types persist through the schema -------------------------
describe('F · waste rule type switching persists', () => {
  afterEach(() => vi.restoreAllMocks())

  it('percent keeps a percent value', () => {
    const p = campaignSchema.parse({ name: 'QA', waste_rule_type: 'percent', waste_rule_value: '2' })
    expect(p.waste_rule_type).toBe('percent'); expect(p.waste_rule_value).toBe(2)
  })
  it('fixed_squares keeps a square value', () => {
    const p = campaignSchema.parse({ name: 'QA', waste_rule_type: 'fixed_squares', waste_rule_value: '2' })
    expect(p.waste_rule_type).toBe('fixed_squares'); expect(p.waste_rule_value).toBe(2)
  })
  it('minimum keeps a floor value', () => {
    const p = campaignSchema.parse({ name: 'QA', waste_rule_type: 'minimum', waste_rule_value: '10' })
    expect(p.waste_rule_type).toBe('minimum'); expect(p.waste_rule_value).toBe(10)
  })
  it('none drops the value to null', () => {
    const p = campaignSchema.parse({ name: 'QA', waste_rule_type: 'none', waste_rule_value: '' })
    expect(p.waste_rule_type).toBe('none'); expect(p.waste_rule_value).toBeNull()
  })
})

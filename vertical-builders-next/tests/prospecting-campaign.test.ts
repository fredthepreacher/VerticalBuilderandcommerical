import { describe, expect, it } from 'vitest'
import { campaignSchema } from '../lib/ops/validations/prospecting'

/**
 * Campaign config validation. Forgiving by design — only a name is required —
 * but the roof-type filter, waste rule and batch size are bounded so a campaign
 * cannot carry nonsense into the import/estimate pipeline.
 */
describe('campaign schema', () => {
  it('requires a name', () => {
    const r = campaignSchema.safeParse({ name: '' })
    expect(r.success).toBe(false)
  })

  it('accepts a minimal campaign and fills safe defaults', () => {
    const r = campaignSchema.parse({ name: 'Sarasota shingles' })
    expect(r.roof_types).toEqual([])
    expect(r.waste_rule_type).toBe('percent')
    expect(r.default_batch_size).toBe(60)
    expect(r.active).toBe(true)
  })

  it('coerces blank optional numbers/dates to null, not zero', () => {
    const r = campaignSchema.parse({
      name: 'C', min_roof_age_years: '', waste_rule_value: '', permit_date_from: '',
    })
    expect(r.min_roof_age_years).toBeNull()
    expect(r.waste_rule_value).toBeNull()
    expect(r.permit_date_from).toBeNull()
  })

  it('parses a full campaign', () => {
    const r = campaignSchema.parse({
      name: 'Sarasota shingle 2004-2020',
      county: 'Sarasota',
      roof_types: ['shingle'],
      permit_date_from: '2004-01-01',
      permit_date_to: '2020-12-31',
      min_roof_age_years: '15',
      waste_rule_type: 'fixed_squares',
      waste_rule_value: '2',
      default_batch_size: '60',
      mail_tag: 'SAR-SHINGLE',
      active: true,
    })
    expect(r.roof_types).toEqual(['shingle'])
    expect(r.min_roof_age_years).toBe(15)
    expect(r.waste_rule_value).toBe(2)
    expect(r.permit_date_from).toBe('2004-01-01')
  })

  it('rejects an unknown roof-type family', () => {
    const r = campaignSchema.safeParse({ name: 'x', roof_types: ['aluminum-ish'] })
    expect(r.success).toBe(false)
  })

  it('clamps batch size within 1..500', () => {
    expect(campaignSchema.safeParse({ name: 'x', default_batch_size: '9000' }).success).toBe(false)
    expect(campaignSchema.parse({ name: 'x', default_batch_size: '250' }).default_batch_size).toBe(250)
  })
})

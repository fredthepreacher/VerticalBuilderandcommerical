import { describe, expect, it } from 'vitest'
import { REVIEW_ACTIONS } from '../lib/ops/prospecting/review'
import { isPricebookItemUsable, type UsablePricebookItem } from '../lib/ops/prospecting/conversion'
import type { PricebookItem } from '../lib/ops/types'

/**
 * Phase 3A logic: review-action mapping and the price-book usability gate that
 * stops a misleading estimate. The DB-coupled idempotency + concurrency
 * invariants are proven separately against a scratch Postgres in the verify step.
 */

describe('review action mapping', () => {
  it('approve is the ONLY action that qualifies a prospect', () => {
    const qualifying = Object.entries(REVIEW_ACTIONS).filter(([, spec]) => spec.status === 'qualified')
    expect(qualifying.map(([k]) => k)).toEqual(['approve'])
    expect(REVIEW_ACTIONS.approve.decision).toBe('qualify')
  })
  it('rejections map to the right disqualified statuses', () => {
    expect(REVIEW_ACTIONS.reject_new_roof.status).toBe('disqualified_new_roof')
    expect(REVIEW_ACTIONS.reject_wrong_roof_type.status).toBe('disqualified_wrong_roof_type')
    expect(REVIEW_ACTIONS.reject_bad_address.status).toBe('disqualified_bad_address')
    expect(REVIEW_ACTIONS.reject_not_opportunity.status).toBe('disqualified_not_opportunity')
    expect(REVIEW_ACTIONS.reject_duplicate.status).toBe('duplicate')
  })
  it('manual measurement and follow-up map to non-terminal states', () => {
    expect(REVIEW_ACTIONS.manual_measurement.status).toBe('manual_measurement_required')
    expect(REVIEW_ACTIONS.follow_up.status).toBe('follow_up')
  })
})

describe('price book usability (no misleading estimate)', () => {
  const base: UsablePricebookItem = {
    id: 'pb1', name: 'Architectural shingle roof, installed', category: 'Roofing', service_type: 'Roofing',
    description: 'Per square', unit: 'SQ', default_unit_price_cents: 42500,
    default_material_cost_cents: null, default_labor_cost_cents: null, active: true, tags: [],
  } as unknown as UsablePricebookItem

  it('accepts an active, priced item', () => {
    expect(isPricebookItemUsable(base).ok).toBe(true)
  })
  it('rejects a missing item', () => {
    expect(isPricebookItemUsable(null).ok).toBe(false)
  })
  it('rejects a $0 item', () => {
    expect(isPricebookItemUsable({ ...base, default_unit_price_cents: 0 }).ok).toBe(false)
  })
  it('rejects a needs-price item', () => {
    expect(isPricebookItemUsable({ ...base, tags: ['needs-price'] }).ok).toBe(false)
  })
  it('rejects an inactive / retired / archived item', () => {
    expect(isPricebookItemUsable({ ...base, active: false }).ok).toBe(false)
    expect(isPricebookItemUsable({ ...base, retired_at: '2026-01-01' }).ok).toBe(false)
    expect(isPricebookItemUsable({ ...base, archived_at: '2026-01-01' }).ok).toBe(false)
  })
})

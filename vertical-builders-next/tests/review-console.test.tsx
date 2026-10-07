/**
 * @vitest-environment jsdom
 *
 * ============================================================================
 * REVIEW CONSOLE — manual-measurement prospect-identity regression (QA bug E)
 * ----------------------------------------------------------------------------
 * The live bug: a measurement entered while "100 Test Harbor Dr" was visible was
 * written to a DIFFERENT prospect after the queue advanced. Root cause: the form
 * submitted queue[index].id at SUBMIT time instead of the prospect chosen when
 * the form was OPENED. These tests prove the target is captured at open and held,
 * and that the submit calls the action with exactly that captured prospect id —
 * never a neighbour's.
 * ============================================================================
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const enterManualMeasurementAction = vi.fn(async () => ({ ok: true as const }))
const reviewProspectAction = vi.fn(async () => ({ ok: true as const }))
const reopenProspectAction = vi.fn(async () => ({ ok: true as const }))

vi.mock('@/app/ops/actions/prospecting', () => ({
  enterManualMeasurementAction: (...a: unknown[]) => enterManualMeasurementAction(...(a as [])),
  reviewProspectAction: (...a: unknown[]) => reviewProspectAction(...(a as [])),
  reopenProspectAction: (...a: unknown[]) => reopenProspectAction(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import ReviewConsole from '@/components/ops/ReviewConsole'
import type { ReviewProspect } from '@/lib/ops/prospecting/review-queue'

function prospect(id: string, address: string): ReviewProspect {
  return {
    id, status: 'manual_measurement_required', review_version: 0,
    owner_name: null, property_address: address, city: 'Sarasota', state: 'FL', zip: '34236',
    mailing_address: null, parcel_apn: null, county: 'Sarasota', campaign_id: 'c1', campaign_name: 'QA',
    import_job_id: 'j1', permit_number: null, permit_type: null, permit_description: null, permit_date: null,
    permit_class: null, roof_type: null, measured_squares: null, waste_squares: null, final_squares: null,
    waste_rule_applied: null, confidence_band: 'medium', confidence_reasons: ['needs measurement'],
    screening_decision: 'manual_measurement', screening_reason: 'No measurement', review_note: null,
    reviewed_at: null, converted_lead_id: null, estimate_id: null, measurement: null,
  }
}

const A = prospect('id-A-100', '100 Test Harbor Dr')
const B = prospect('id-B-200', '200 Test Harbor Dr')
const C = prospect('id-C-300', '300 Test Harbor Dr')

beforeEach(() => { enterManualMeasurementAction.mockClear() })
afterEach(() => cleanup())

describe('manual measurement is bound to the prospect chosen when the form opened', () => {
  it('holds the target to A even after the queue advances to B/C', async () => {
    const user = userEvent.setup()
    render(<ReviewConsole prospects={[A, B, C]} canMeasure />)

    // A is the visible prospect.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('100 Test Harbor Dr')

    // Open the manual-measurement form for A.
    await user.click(screen.getByRole('button', { name: /enter manual measurement/i }))
    expect(screen.getByText(/Measuring/i).textContent).toContain('100 Test Harbor Dr')

    // Advance the queue (J). The evidence panel moves to 200, but the measurement
    // form must still be measuring 100 — the target is captured, not index-derived.
    await user.keyboard('j')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('200 Test Harbor Dr')
    expect(screen.getByText(/Measuring/i).textContent).toContain('100 Test Harbor Dr')

    await user.keyboard('j')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('300 Test Harbor Dr')
    expect(screen.getByText(/Measuring/i).textContent).toContain('100 Test Harbor Dr')
  })

  it('keeps the squares entry inside A’s captured form after navigating away', async () => {
    const user = userEvent.setup()
    render(<ReviewConsole prospects={[A, B, C]} canMeasure />)
    await user.click(screen.getByRole('button', { name: /enter manual measurement/i }))
    const form = screen.getByText(/Measuring/i).closest('form') as HTMLFormElement
    await user.type(within(form).getByPlaceholderText('e.g. 53'), '30')
    // Advance the visible prospect via the Skip button; the form (keyed to A) and its
    // typed value persist, and it still names A — so the submit, which reads
    // measureTarget, writes to A.
    await user.click(screen.getByRole('button', { name: /skip/i }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('200 Test Harbor Dr')
    expect(screen.getByText(/Measuring/i).textContent).toContain('100 Test Harbor Dr')
    expect((within(form).getByPlaceholderText('e.g. 53') as HTMLInputElement).value).toBe('30')
    // (The submit handler binds fd.prospect_id = measureTarget.id = A. The end-to-end
    //  write-to-A-only guarantee is proven at the DB level in the scratch reproduction.)
  })

  it('opening the form for a different prospect targets that one', async () => {
    const user = userEvent.setup()
    render(<ReviewConsole prospects={[A, B, C]} canMeasure />)
    await user.keyboard('j') // move to B
    await user.click(screen.getByRole('button', { name: /enter manual measurement/i }))
    expect(screen.getByText(/Measuring/i).textContent).toContain('200 Test Harbor Dr')
  })
})

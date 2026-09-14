import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderEstimatePdf, estimatePdfFilename, DEFAULT_COMPANY } from '../lib/ops/estimating/pdf'
import { calculateTotals } from '../lib/ops/finance/calc'
import type { Estimate, EstimateLineItem } from '../lib/ops/types'

/**
 * ============================================================================
 * ESTIMATE PDF — ink-friendly render
 * ----------------------------------------------------------------------------
 * Exact pixel geometry is impractical to assert against a binary PDF, so this
 * covers two things: (1) the renderer still produces a valid, correctly
 * paginated PDF across the totals permutations and large currency values the
 * client asked us to test, and (2) a structural guard that the ink-heavy filled
 * blocks are gone. A rendered sample is produced separately for visual QA.
 * ============================================================================
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

let seq = 0
function makeLine(over: Partial<EstimateLineItem> = {}): EstimateLineItem {
  seq += 1
  const quantity = over.quantity ?? 1
  const unit_price_cents = over.unit_price_cents ?? 10_000
  return {
    id: `line-${seq}`,
    estimate_id: 'est-1',
    sort_order: over.sort_order ?? seq,
    category: null,
    description: over.description ?? `Line item ${seq}`,
    quantity,
    unit: over.unit ?? 'EA',
    unit_price_cents,
    labor_cost_cents: null,
    material_cost_cents: null,
    markup_percent: null,
    line_total_cents: over.line_total_cents ?? Math.round(quantity * unit_price_cents),
    pricebook_item_id: null,
    source: over.source ?? 'manual',
    ai_generated: false,
    needs_review: false,
    notes: over.notes ?? null,
  }
}

function makeEstimate(lines: EstimateLineItem[], over: Partial<Estimate> = {}): Estimate {
  const totals = calculateTotals({
    lines: lines.map(l => ({ quantity: l.quantity, unitPriceCents: l.unit_price_cents })),
    discountCents: over.discount_cents ?? 0,
    taxPercent: over.tax_percent ?? 0,
    taxEnabled: (over.tax_percent ?? 0) > 0,
  })
  return {
    id: 'est-1',
    estimate_number: over.estimate_number ?? 'EST-000123',
    lead_id: null, contact_id: null, project_id: null,
    property_address: '123 Sample Street', city: 'Nokomis', state: 'FL', zip: '34275',
    service_type: 'Roof replacement',
    title: over.title ?? 'Roof replacement — architectural shingle',
    scope_summary: over.scope_summary ?? 'Tear off existing roof, install new underlayment and shingles.',
    status: 'draft',
    subtotal_cents: totals.subtotalCents,
    discount_cents: totals.discountCents,
    tax_percent: over.tax_percent ?? 0,
    tax_cents: totals.taxCents,
    total_cents: totals.totalCents,
    valid_until: over.valid_until ?? '2026-12-31',
    customer_notes: over.customer_notes ?? null,
    internal_notes: null, decline_reason: null, created_by: null, assigned_to: null,
    sent_at: null, viewed_at: null, approved_at: null, declined_at: null, converted_project_id: null,
    ai_metadata_json: {},
    archived_at: null,
    created_at: '2026-09-01T12:00:00.000Z',
    updated_at: '2026-09-01T12:00:00.000Z',
    ...over,
  }
}

async function render(lines: EstimateLineItem[], over: Partial<Estimate> = {}, opts: { taxEnabled?: boolean } = {}) {
  const estimate = makeEstimate(lines, over)
  return renderEstimatePdf({
    estimate,
    lines,
    customerName: 'Test Customer',
    taxEnabled: opts.taxEnabled ?? (estimate.tax_percent > 0),
  })
}

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-'

describe('renders a valid PDF across the totals permutations', () => {
  it('no discount, no tax', async () => {
    const pdf = await render([makeLine({ description: 'Base scope' })])
    expect(isPdf(pdf)).toBe(true)
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it('discount only', async () => {
    const pdf = await render([makeLine({ quantity: 10, unit_price_cents: 50_000 })], { discount_cents: 25_000 })
    expect(isPdf(pdf)).toBe(true)
  })

  it('tax only', async () => {
    const pdf = await render([makeLine({ quantity: 10, unit_price_cents: 50_000 })], { tax_percent: 7.5 })
    expect(isPdf(pdf)).toBe(true)
  })

  it('discount and tax together', async () => {
    const pdf = await render(
      [makeLine({ quantity: 10, unit_price_cents: 50_000 })],
      { discount_cents: 25_000, tax_percent: 7.5 },
    )
    expect(isPdf(pdf)).toBe(true)
  })
})

describe('large currency values do not break the render', () => {
  it('renders a seven-figure total', async () => {
    // 1000 SQ @ $1,234.567 → a $1.2M subtotal, plus discount and tax.
    const pdf = await render(
      [makeLine({ description: 'Very large commercial roof', quantity: 1000, unit_price_cents: 123_456 })],
      { discount_cents: 1_000_000, tax_percent: 7.5 },
    )
    expect(isPdf(pdf)).toBe(true)
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })
})

describe('pagination', () => {
  it('a long estimate flows onto multiple pages', async () => {
    const lines = Array.from({ length: 60 }, (_, i) =>
      makeLine({ description: `Scope line ${i + 1} — detailed description of the work performed`, notes: 'Includes cleanup and haul-away.' }),
    )
    const pdf = await render(lines, { customer_notes: 'Thank you for the opportunity to quote this work.' })
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('an empty estimate still renders one valid page', async () => {
    const pdf = await render([])
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(1)
  })
})

describe('filename is deterministic and safe', () => {
  it('joins number, customer and title', () => {
    const estimate = makeEstimate([makeLine()])
    const name = estimatePdfFilename(estimate, 'Test Customer')
    expect(name).toBe('EST-000123_Test_Customer_Roof_replacement_architectural_shingle.pdf')
  })
})

describe('the page is ink-friendly — no large dark fills', () => {
  const src = read('lib/ops/estimating/pdf.ts')

  it('draws no filled rectangles at all', () => {
    expect(src).not.toMatch(/drawRectangle/)
  })

  it('does not paint white text onto a fill', () => {
    expect(src).not.toMatch(/\bWHITE\b/)
  })

  it('uses a bounded totals block so values cannot drift to the page edge', () => {
    expect(src).toMatch(/PRINT_PAGE\.totalsWidth/)
  })

  it('carries the brand with a thin accent rule', () => {
    expect(src).toMatch(/drawLine[\s\S]*color: ACCENT/)
  })
})

describe('shared print brand', () => {
  it('the PDF company is the shared source of truth', () => {
    expect(DEFAULT_COMPANY.name).toBe('Vertical Builders & Commercial')
    const brand = read('lib/ops/print/brand.ts')
    expect(brand).toMatch(/PRINT_COMPANY/)
    expect(read('lib/ops/estimating/pdf.ts')).toMatch(/from '\.\.\/print\/brand'/)
  })
})

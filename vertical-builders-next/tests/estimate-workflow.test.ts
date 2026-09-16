import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimateLineSchema, estimateSchema } from '../lib/ops/validations/estimate'
import { calculateTotals, lineTotalCents } from '../lib/ops/finance/calc'

/**
 * ============================================================================
 * THE DAILY WORKFLOW — lead → estimate → measure → price → print
 * ----------------------------------------------------------------------------
 * The client's complaint was not that custom lines were impossible; they were
 * always possible. It was that the price book was the first thing in the way of
 * typing a sentence. So most of what is tested here is arrangement: what the
 * operator meets first, and what still works after it was moved.
 * ============================================================================
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const builder = read('components/ops/EstimateBuilder.tsx')

// ---------------------------------------------------------------------------
// A line built entirely by hand
// ---------------------------------------------------------------------------

describe('a fully manual line', () => {
  it('needs nothing but a description', () => {
    const parsed = estimateLineSchema.safeParse({ description: 'Tile roof' })
    expect(parsed.success).toBe(true)
    // Absent, not null — the existing schema marks it optional, and
    // `saveEstimate` maps a missing value to NULL on the way to the database.
    expect(parsed.success && parsed.data.pricebook_item_id).toBeFalsy()
    expect(parsed.success && parsed.data.source).toBe('manual')
    expect(parsed.success && parsed.data.ai_generated).toBe(false)
  })

  it('saves the description, quantity, unit and rate the operator typed', () => {
    const parsed = estimateLineSchema.parse({
      description: 'Tile roof replacement', quantity: '24.5', unit: 'SQ', unit_price_cents: '875.50',
    })
    expect(parsed.description).toBe('Tile roof replacement')
    expect(parsed.quantity).toBe(24.5)
    expect(parsed.unit).toBe('SQ')
    expect(parsed.unit_price_cents).toBe(87_550)
  })

  it('still refuses a line with no description — a blank row is not an item', () => {
    const parsed = estimateLineSchema.safeParse({ description: '   ', quantity: '5' })
    expect(parsed.success).toBe(false)
  })

  it('a decimal measurement survives, because 24.5 squares is a real roof', () => {
    expect(estimateLineSchema.parse({ description: 'X', quantity: '24.5' }).quantity).toBe(24.5)
  })

  it('an estimate of nothing but manual lines validates', () => {
    const parsed = estimateSchema.safeParse({
      title: 'Delacroix tile roof',
      status: 'draft',
      tax_percent: 0,
      lines: [
        { description: 'Tear-off', quantity: '24.5', unit: 'SQ', unit_price_cents: '120' },
        { description: 'Tile roof replacement', quantity: '24.5', unit: 'SQ', unit_price_cents: '875.50' },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

describe('totals are unchanged by any of this', () => {
  it('multiplies quantity by rate', () => {
    expect(lineTotalCents({ quantity: 24.5, unitPriceCents: 87_550 })).toBe(2_144_975)
  })

  it('adds up, discounts, then taxes', () => {
    const totals = calculateTotals({
      lines: [
        { quantity: 24.5, unitPriceCents: 87_550 },
        { quantity: 1, unitPriceCents: 45_000 },
      ],
      discountCents: 100_000,
      taxPercent: 7,
      taxEnabled: true,
    })
    expect(totals.subtotalCents).toBe(2_189_975)
    expect(totals.discountCents).toBe(100_000)
    expect(totals.taxCents).toBe(Math.round((2_189_975 - 100_000) * 0.07))
    expect(totals.totalCents).toBe(2_189_975 - 100_000 + totals.taxCents)
  })

  it('a blank quantity counts as one, and the preview says the same', () => {
    // The server's `quantityField` turns '' into 1. If the browser previewed it
    // as 0, the figure on screen would differ from the figure saved — on a
    // customer-facing document.
    expect(estimateLineSchema.parse({ description: 'Permit fee', quantity: '' }).quantity).toBe(1)
    expect(builder).toMatch(/function quantityOf/)
    expect(builder).toMatch(/if \(trimmed === ''\) return 1/)
    expect(builder).toMatch(/quantity: quantityOf\(l\.quantity\)/)
    expect(builder).toMatch(/quantity: quantityOf\(line\.quantity\)/)
  })
})

// ---------------------------------------------------------------------------
// The arrangement
// ---------------------------------------------------------------------------

describe('manual entry is what the operator meets first', () => {
  it('a new line is completely empty — no description, no quantity, no rate', () => {
    const blank = builder.slice(builder.indexOf('function blankLine'), builder.indexOf('export default function'))
    expect(blank).toMatch(/description: ''/)
    expect(blank).toMatch(/quantity: ''/)
    expect(blank).toMatch(/unitPrice: ''/)
    expect(blank).toMatch(/pricebookItemId: ''/)
    expect(blank).toMatch(/source: 'manual'/)
  })

  it('the description input comes before the price book selector in the markup', () => {
    // Reading order is the whole complaint. This is the assertion that would
    // fail if somebody moved the selector back to the top.
    const cell = builder.slice(builder.indexOf('Description first'), builder.indexOf('ops-line-pricebook') + 400)
    expect(cell.indexOf('line[${index}][description]')).toBeLessThan(cell.indexOf('ops-line-pricebook'))
  })

  it('the price book is behind a disclosure, and reads as optional', () => {
    expect(builder).toMatch(/<details className="ops-line-pricebook"/)
    expect(builder).toMatch(/Optional price book item/)
    expect(builder).toMatch(/None — custom line/)
  })

  it('no longer describes a hand-written line as the exception', () => {
    expect(builder).not.toMatch(/Custom line \(not from the pricebook\)/)
  })

  it('opens the disclosure automatically on a line that already uses the book', () => {
    // An existing estimate should look the same as it did before this change.
    expect(builder).toMatch(/open=\{Boolean\(line\.pricebookItemId\)\}/)
  })

  it('the price book still fills in wording, unit, category and rate when chosen', () => {
    const apply = builder.slice(builder.indexOf('function applyPricebookItem'), builder.indexOf('function move'))
    expect(apply).toMatch(/description: item\.name/)
    expect(apply).toMatch(/unit: item\.unit/)
    expect(apply).toMatch(/category: item\.category/)
    expect(apply).toMatch(/default_unit_price_cents/)
  })

  it('and still flags an item the company has not priced', () => {
    const apply = builder.slice(builder.indexOf('function applyPricebookItem'), builder.indexOf('function move'))
    expect(apply).toMatch(/needsReview: !item\.default_unit_price_cents/)
  })
})

describe('the AI and review gates are untouched', () => {
  it('unreviewed lines still block, with the same banner', () => {
    expect(builder).toMatch(/const unreviewed = lines\.filter\(l => l\.needsReview && !l\.reviewed\)\.length/)
    expect(builder).toMatch(/still need your review/)
    expect(builder).toMatch(/cannot be sent until they are all cleared/)
  })

  it('the AI draft panel still exists and still says the AI cannot price', () => {
    expect(builder).toMatch(/export function AiDraftPanel/)
    expect(builder).toMatch(/The AI never sets a price of its own/)
  })

  it('the estimate price boundary in lib/ops/estimating/ai.ts is unchanged', () => {
    const ai = read('lib/ops/estimating/ai.ts')
    expect(ai).toMatch(/export function sanitizeResult/)
    expect(ai).toMatch(/item\?\.default_unit_price_cents/)
    expect(ai).toMatch(/needsReview/)
  })

  it('a template line is not treated as AI-generated', () => {
    const apply = builder.slice(builder.indexOf('function applyTemplate'), builder.indexOf('function move'))
    expect(apply).toMatch(/aiGenerated: false/)
  })
})

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

describe('preview and print', () => {
  it('the builder offers Preview / Print once the estimate exists', () => {
    expect(builder).toMatch(/Preview \/ Print/)
    expect(builder).toMatch(/\/api\/estimates\/\$\{estimate\.id\}\/pdf\?disposition=inline/)
  })

  it('reuses the existing PDF route rather than generating a second time', () => {
    const detail = read('app/ops/(app)/estimates/[id]/page.tsx')
    expect(detail).toMatch(/\/api\/estimates\/\$\{params\.id\}\/pdf\?disposition=inline/)
    expect(detail).toMatch(/\/api\/estimates\/\$\{params\.id\}\/pdf/)
    // No second PDF implementation anywhere in the new code.
    expect(read('app/ops/actions/proposal-templates.ts')).not.toMatch(/pdf/i)
  })
})

// ---------------------------------------------------------------------------
// New-estimate page
// ---------------------------------------------------------------------------

describe('the new-estimate page', () => {
  const page = read('app/ops/(app)/estimates/new/page.tsx')

  it('leads with building a proposal, not with the price book and AI', () => {
    expect(page).toMatch(/Build a proposal from scratch or start with one of your saved templates/)
    expect(page).toMatch(/then preview or print the estimate/)
  })

  it('still mentions measurement and AI, as optional extras', () => {
    expect(page).toMatch(/all optional/)
    expect(page).toMatch(/roof measurement/)
  })

  it('still prefills from a lead', () => {
    expect(page).toMatch(/searchParams\.lead/)
    expect(page).toMatch(/lead_id: lead\.id/)
    expect(page).toMatch(/property_address: lead\.property_address/)
  })

  it('titles a property prospect by its address rather than leaving it blank', () => {
    expect(page).toMatch(/\[lead\.property_address, lead\.city\]\.filter\(Boolean\)\.join\(', '\)/)
  })

  it('does not require the lead to be converted first', () => {
    // Quoting a prospect must not need a customer record and a project first.
    expect(page).not.toMatch(/convertLead|requires? conversion/)
    expect(page).toMatch(/contact_id: lead\.converted_contact_id/)
  })

  it('offers the templates it loaded', () => {
    expect(page).toMatch(/listProposalTemplates/)
    expect(page).toMatch(/templates=\{templates\.map/)
  })
})

describe('quick estimate from a lead', () => {
  const detail = read('app/ops/(app)/leads/[id]/page.tsx')
  const list = read('app/ops/(app)/leads/page.tsx')

  it('lead detail has a primary Create estimate action', () => {
    expect(detail).toMatch(/href=\{`\/ops\/estimates\/new\?lead=\$\{lead\.id\}`\}/)
    expect(detail).toMatch(/Create estimate/)
  })

  it('gated on estimatesCreate', () => {
    expect(detail).toMatch(/user\.can\('estimatesCreate'\) && !archived/)
  })

  it('the lead list offers one per row too', () => {
    expect(list).toMatch(/href=\{`\/ops\/estimates\/new\?lead=\$\{lead\.id\}`\}/)
    expect(list).toMatch(/Create an estimate for this lead/)
  })

  it('lead detail lists the estimates already written against it', () => {
    expect(detail).toMatch(/from\('estimates'\)/)
    expect(detail).toMatch(/\.eq\('lead_id', params\.id\)/)
  })

  it('an archived lead is not offered a new estimate', () => {
    expect(detail).toMatch(/!archived/)
  })
})

describe('the estimates list links to templates', () => {
  it('has a Proposal templates action', () => {
    const page = read('app/ops/(app)/estimates/page.tsx')
    expect(page).toMatch(/href="\/ops\/estimates\/templates"/)
    expect(page).toMatch(/Proposal templates/)
  })
})

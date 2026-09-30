import { describe, expect, it } from 'vitest'
import {
  evaluateProductionEligibility, recipientNameFor, type EligibilityInput,
} from '../lib/ops/prospecting/production'
import { deriveBatchStatus, type ItemGenerationStatus } from '../lib/ops/prospecting/mail-batch'
import { buildManifestCsv, csvCell, type MailBatchItem } from '../lib/ops/prospecting/mail-batch-read'

/**
 * ============================================================================
 * MAIL-BATCH PRODUCTION — Phase 3B pure logic
 * ----------------------------------------------------------------------------
 * The eligibility engine, batch-status derivation and manifest builder encode
 * the spec's hard guarantees: never a $0 proposal, blocked rows are identified
 * with a reason, mailing-address fallback is explicit, a mixed batch lets valid
 * rows proceed, and one failed item never sinks a batch.
 * ============================================================================
 */

const base: EligibilityInput = {
  estimateId: 'est-1',
  estimateTotalCents: 1_250_00,
  finalSquares: 55,
  propertyAddress: '4386 Sibley Bay St',
  mailingAddress: 'PO Box 210',
  campaignPresent: true,
  proposalTemplateId: 'tmpl-1',
  alreadyInActiveBatch: false,
}

describe('production eligibility', () => {
  it('READY when everything is present and priced', () => {
    const r = evaluateProductionEligibility(base)
    expect(r.code).toBe('READY')
    expect(r.ready).toBe(true)
    expect(r.mailingAddressUsed).toBe('PO Box 210')
    expect(r.mailingFallback).toBe(false)
  })

  it('never mails a $0 estimate → PRICING_CONFIGURATION_REQUIRED', () => {
    expect(evaluateProductionEligibility({ ...base, estimateTotalCents: 0 }).code).toBe('PRICING_CONFIGURATION_REQUIRED')
    expect(evaluateProductionEligibility({ ...base, estimateTotalCents: null }).code).toBe('PRICING_CONFIGURATION_REQUIRED')
  })

  it('blocks when no usable measurement', () => {
    expect(evaluateProductionEligibility({ ...base, finalSquares: null }).code).toBe('MEASUREMENT_REQUIRED')
    expect(evaluateProductionEligibility({ ...base, finalSquares: 0 }).code).toBe('MEASUREMENT_REQUIRED')
  })

  it('blocks when no estimate exists', () => {
    expect(evaluateProductionEligibility({ ...base, estimateId: null }).code).toBe('ESTIMATE_REQUIRED')
  })

  it('requires a proposal template when a campaign is attached', () => {
    expect(evaluateProductionEligibility({ ...base, proposalTemplateId: null }).code).toBe('TEMPLATE_REQUIRED')
    // …but no campaign → template cannot be required
    expect(evaluateProductionEligibility({ ...base, campaignPresent: false, proposalTemplateId: null }).code).toBe('READY')
  })

  it('falls back to the property address when no mailing address, and flags it', () => {
    const r = evaluateProductionEligibility({ ...base, mailingAddress: null })
    expect(r.ready).toBe(true)
    expect(r.mailingFallback).toBe(true)
    expect(r.mailingAddressUsed).toBe('4386 Sibley Bay St')
  })

  it('blocks BAD_ADDRESS when neither mailing nor property address exists', () => {
    const r = evaluateProductionEligibility({ ...base, mailingAddress: null, propertyAddress: null })
    expect(r.code).toBe('BAD_ADDRESS')
    expect(r.mailingAddressUsed).toBeNull()
  })

  it('blocks ALREADY_BATCHED unless a reprint is explicitly allowed', () => {
    expect(evaluateProductionEligibility({ ...base, alreadyInActiveBatch: true }).code).toBe('ALREADY_BATCHED')
    expect(evaluateProductionEligibility({ ...base, alreadyInActiveBatch: true }, { allowRebatch: true }).code).toBe('READY')
  })

  it('mixed batch: 54 valid, 4 pricing-blocked, 2 measurement-blocked (spec §24)', () => {
    const inputs: EligibilityInput[] = [
      ...Array.from({ length: 54 }, () => ({ ...base })),
      ...Array.from({ length: 4 }, () => ({ ...base, estimateTotalCents: 0 })),
      ...Array.from({ length: 2 }, () => ({ ...base, finalSquares: null })),
    ]
    const results = inputs.map(i => evaluateProductionEligibility(i))
    expect(results.filter(r => r.ready)).toHaveLength(54)
    expect(results.filter(r => r.code === 'PRICING_CONFIGURATION_REQUIRED')).toHaveLength(4)
    expect(results.filter(r => r.code === 'MEASUREMENT_REQUIRED')).toHaveLength(2)
  })

  it('recipient name falls back to a safe generic', () => {
    expect(recipientNameFor('Maria Delgado')).toBe('Maria Delgado')
    expect(recipientNameFor(null)).toBe('Current Resident')
    expect(recipientNameFor('   ')).toBe('Current Resident')
  })
})

describe('batch status derivation', () => {
  const items = (...s: ItemGenerationStatus[]) => s.map(generation_status => ({ generation_status }))

  it('empty → draft', () => expect(deriveBatchStatus([])).toBe('draft'))
  it('any pending/generating → generating', () => {
    expect(deriveBatchStatus(items('generated', 'pending'))).toBe('generating')
    expect(deriveBatchStatus(items('generating'))).toBe('generating')
  })
  it('all generated → ready', () => expect(deriveBatchStatus(items('generated', 'generated'))).toBe('ready'))
  it('some generated + some failed/blocked → partial', () => {
    expect(deriveBatchStatus(items('generated', 'failed'))).toBe('partial')
    expect(deriveBatchStatus(items('generated', 'blocked'))).toBe('partial')
  })
  it('nothing produced → error', () => {
    expect(deriveBatchStatus(items('failed', 'blocked'))).toBe('error')
    expect(deriveBatchStatus(items('blocked'))).toBe('error')
  })
})

describe('manifest CSV', () => {
  const item = (over: Partial<MailBatchItem>): MailBatchItem => ({
    id: 'i1', prospectId: 'p1', leadId: 'l1', estimateId: 'e1', documentId: 'd1',
    generationStatus: 'generated', blockReason: null, errorMessage: null,
    recipientName: 'Maria Delgado', propertyAddress: '4386 Sibley Bay St',
    mailingAddress: 'PO Box 210', mailingFallback: false, finalSquares: 55,
    estimateTotalCents: 1_250_00, estimateNumber: 'EST-1001',
    printedAt: null, mailedAt: null, sortOrder: 0, ...over,
  })

  it('emits the documented columns and formats money in dollars', () => {
    const csv = buildManifestCsv({ id: 'b1', campaignName: 'Sarasota shingle', county: 'Sarasota' }, [item({})])
    const [header, row] = csv.split('\n')
    expect(header.split(',')).toContain('mailing_address')
    expect(header.split(',')).toContain('estimate_total')
    expect(row).toContain('1250.00')
    expect(row).toContain('EST-1001')
    expect(row.endsWith(',no,no')).toBe(true) // printed,mailed
  })

  it('marks the mailing fallback and blocked reason', () => {
    const csv = buildManifestCsv({ id: 'b1', campaignName: null, county: null }, [
      item({ mailingFallback: true, generationStatus: 'blocked', blockReason: 'PRICING_CONFIGURATION_REQUIRED', documentId: null }),
    ])
    const row = csv.split('\n')[1]
    expect(row).toContain('yes')       // mailing_fallback
    expect(row).toContain('PRICING_CONFIGURATION_REQUIRED')
  })

  it('quotes cells that contain commas or quotes (CSV safety)', () => {
    expect(csvCell('Smith, John')).toBe('"Smith, John"')
    expect(csvCell('a "quote"')).toBe('"a ""quote"""')
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(null)).toBe('')
  })

  it('empty estimate total renders as blank, not $0.00', () => {
    const csv = buildManifestCsv({ id: 'b1', campaignName: null, county: null }, [item({ estimateTotalCents: null })])
    const cells = csv.split('\n')[1].split(',')
    const idx = 'batch_id,item_id,prospect_id,lead_id,estimate_id,document_id,estimate_number,recipient_name,property_address,mailing_address,mailing_fallback,campaign,county,final_squares,estimate_total'.split(',').length - 1
    expect(cells[idx]).toBe('')
  })
})

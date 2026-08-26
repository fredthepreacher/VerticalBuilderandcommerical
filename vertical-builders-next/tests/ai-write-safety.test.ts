import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toCertificateInput, findLowConfidence, isSupportedCoiType, LOW_CONFIDENCE_THRESHOLD } from '../lib/ops/ai/coi'
import { coiExtractionSchema, type CoiExtraction } from '../lib/ops/ai/schemas'
import { certificateSchema } from '../lib/ops/validations/certificate'

/**
 * ============================================================================
 * WRITE SAFETY
 * ----------------------------------------------------------------------------
 * The rule from the change order is that the model never executes a write. Two
 * kinds of test here:
 *
 *   - Structural: no AI module can reach a mutation, verified by reading the
 *     source. This catches a future refactor that quietly wires one up.
 *   - Behavioural: the COI apply path converts only reviewed values and still
 *     has to satisfy the same schema a hand-typed certificate does.
 * ============================================================================
 */

const extraction = (partial: Partial<CoiExtraction> = {}): CoiExtraction =>
  coiExtractionSchema.parse({ coverages: [], ...partial })

describe('no AI module can perform a mutation', () => {
  const aiDir = join(process.cwd(), 'lib/ops/ai')

  it('never calls insert, update, upsert or delete', () => {
    for (const file of readdirSync(aiDir).filter(f => f.endsWith('.ts'))) {
      const source = readFileSync(join(aiDir, file), 'utf8')
      expect(source, `${file} performs a write`).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/)
    }
  })

  it('never imports a service that writes business records', () => {
    for (const file of readdirSync(aiDir).filter(f => f.endsWith('.ts'))) {
      const imports = readFileSync(join(aiDir, file), 'utf8')
        .split('\n').filter(l => /^\s*import\s/.test(l)).join('\n')
      expect(imports, `${file} imports a write path`).not.toMatch(
        /services\/(leads|invoices|estimates)|actions\//,
      )
    }
  })
})

describe('the copilot cannot hand a write to a read-only account', () => {
  it('strips any proposal before returning it to an auditor', () => {
    // The prompt tells the model not to offer one; this is the code that makes
    // it true regardless of what the model does.
    const source = readFileSync(join(process.cwd(), 'lib/ops/ai/copilot.ts'), 'utf8')
    expect(source).toMatch(/req\.role === 'read_only' && answer\.data\.proposal/)
    expect(source).toMatch(/proposal: null/)
  })
})

describe('COI apply — only reviewed values reach the database', () => {
  it('converts a reviewed extraction into a valid certificate input', () => {
    const reviewed = extraction({
      namedInsured: 'ZZ Roofing LLC',
      producer: 'Gulf Coast Insurance',
      coverages: [{
        coverageType: 'general_liability', carrier: 'Acme Mutual', policyNumber: 'GL-1',
        effectiveDate: '2026-01-01', expirationDate: '2027-01-01',
        eachOccurrence: 1_000_000, generalAggregate: 2_000_000,
        combinedSingleLimit: null, employersLiability: null,
        additionalInsured: true, waiverOfSubrogation: true, primaryNoncontributory: null,
        confidence: 0.9, sourceNote: null,
      }],
    })

    const input = toCertificateInput('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-9000-000000000001', reviewed, reviewed.coverages)
    const validated = certificateSchema.safeParse(input)
    expect(validated.success).toBe(true)
    if (validated.success) {
      expect(validated.data.policies).toHaveLength(1)
      expect(validated.data.policies[0].limits.each_occurrence).toBe(1_000_000)
      expect(validated.data.named_insured).toBe('ZZ Roofing LLC')
    }
  })

  it('uses the coverages passed in, not the ones on the extraction', () => {
    // The reviewer may have deleted or corrected a line. `toCertificateInput`
    // takes coverages as a separate argument precisely so the edited set wins.
    const reviewed = extraction({
      coverages: [
        { coverageType: 'general_liability', carrier: 'Original', policyNumber: 'A',
          effectiveDate: null, expirationDate: '2027-01-01', eachOccurrence: null,
          generalAggregate: null, combinedSingleLimit: null, employersLiability: null,
          additionalInsured: null, waiverOfSubrogation: null, primaryNoncontributory: null,
          confidence: 0.4, sourceNote: null },
      ],
    })
    const edited = [{ ...reviewed.coverages[0], carrier: 'Corrected By Human', policyNumber: 'B' }]

    const input = toCertificateInput('00000000-0000-4000-8000-000000000001', null, reviewed, edited)
    expect(input.policies[0].carrier).toBe('Corrected By Human')
    expect(input.policies[0].policy_number).toBe('B')
  })

  it('carries a missing expiration date through as null rather than inventing one', () => {
    const reviewed = extraction({
      coverages: [{
        coverageType: 'workers_compensation', carrier: null, policyNumber: null,
        effectiveDate: null, expirationDate: null, eachOccurrence: null,
        generalAggregate: null, combinedSingleLimit: null, employersLiability: 1_000_000,
        additionalInsured: null, waiverOfSubrogation: null, primaryNoncontributory: null,
        confidence: 0.3, sourceNote: null,
      }],
    })
    const input = toCertificateInput('00000000-0000-4000-8000-000000000001', null, reviewed, reviewed.coverages)
    expect(input.policies[0].expiration_date).toBeNull()
    // The certificate schema still accepts it — an incomplete COI is a real
    // thing, and the compliance evaluator is what flags the consequence.
    expect(certificateSchema.safeParse(input).success).toBe(true)
  })

  it('turns an ambiguous endorsement into false, never a confident true', () => {
    const reviewed = extraction({
      coverages: [{
        coverageType: 'general_liability', carrier: 'X', policyNumber: 'Y',
        effectiveDate: null, expirationDate: '2027-01-01', eachOccurrence: null,
        generalAggregate: null, combinedSingleLimit: null, employersLiability: null,
        additionalInsured: null, waiverOfSubrogation: null, primaryNoncontributory: null,
        confidence: null, sourceNote: null,
      }],
    })
    const input = toCertificateInput('00000000-0000-4000-8000-000000000001', null, reviewed, reviewed.coverages)
    expect(input.policies[0].additional_insured).toBe(false)
    expect(input.policies[0].waiver_of_subrogation).toBe(false)
  })

  it('rejects a backwards date range through the existing schema', () => {
    const reviewed = extraction({
      coverages: [{
        coverageType: 'general_liability', carrier: 'X', policyNumber: 'Y',
        effectiveDate: '2027-06-01', expirationDate: '2026-01-01', eachOccurrence: null,
        generalAggregate: null, combinedSingleLimit: null, employersLiability: null,
        additionalInsured: null, waiverOfSubrogation: null, primaryNoncontributory: null,
        confidence: null, sourceNote: null,
      }],
    })
    const input = toCertificateInput('00000000-0000-4000-8000-000000000001', null, reviewed, reviewed.coverages)
    // Same rule an operator typing this in by hand would hit. The AI path gets
    // no relaxation.
    expect(certificateSchema.safeParse(input).success).toBe(false)
  })

  it('an extraction with no coverages fails the certificate schema', () => {
    const reviewed = extraction()
    const input = toCertificateInput('00000000-0000-4000-8000-000000000001', null, reviewed, [])
    expect(certificateSchema.safeParse(input).success).toBe(false)
  })

  it('records the source as a human upload, because a person applied it', () => {
    const reviewed = extraction({
      coverages: [{
        coverageType: 'general_liability', carrier: 'X', policyNumber: 'Y',
        effectiveDate: null, expirationDate: '2027-01-01', eachOccurrence: null,
        generalAggregate: null, combinedSingleLimit: null, employersLiability: null,
        additionalInsured: null, waiverOfSubrogation: null, primaryNoncontributory: null,
        confidence: null, sourceNote: null,
      }],
    })
    const input = toCertificateInput('00000000-0000-4000-8000-000000000001', null, reviewed, reviewed.coverages)
    expect(input.source).toBe('admin_upload')
  })
})

describe('low-confidence surfacing', () => {
  const coverage = (over: Record<string, unknown> = {}) => ({
    coverageType: 'general_liability', carrier: 'Acme', policyNumber: 'GL-1',
    effectiveDate: '2026-01-01', expirationDate: '2027-01-01', eachOccurrence: 1_000_000,
    generalAggregate: null, combinedSingleLimit: null, employersLiability: null,
    additionalInsured: null, waiverOfSubrogation: null, primaryNoncontributory: null,
    confidence: 0.95, sourceNote: null, ...over,
  })

  it('flags a line the model was unsure about', () => {
    const flagged = findLowConfidence(extraction({ coverages: [coverage({ confidence: 0.4 })] as never }))
    expect(flagged.join(' ')).toMatch(/not confident/i)
  })

  it('always flags a missing expiration date, even at high confidence', () => {
    const flagged = findLowConfidence(extraction({ coverages: [coverage({ expirationDate: null })] as never }))
    expect(flagged.join(' ')).toMatch(/no expiration date/i)
  })

  it('flags a missing policy number and carrier', () => {
    const flagged = findLowConfidence(extraction({
      coverages: [coverage({ policyNumber: null, carrier: null })] as never,
    }))
    expect(flagged.join(' ')).toMatch(/no policy number/i)
    expect(flagged.join(' ')).toMatch(/no carrier/i)
  })

  it('flags a document where nothing was found at all', () => {
    const flagged = findLowConfidence(extraction())
    expect(flagged.join(' ')).toMatch(/no coverage lines/i)
  })

  it('says nothing when a clean line is fully populated', () => {
    const flagged = findLowConfidence(extraction({
      namedInsured: 'ZZ Roofing', coverages: [coverage()] as never,
    }))
    expect(flagged).toEqual([])
  })

  it('caps the list so the review screen stays readable', () => {
    const many = Array.from({ length: 12 }, () => coverage({ expirationDate: null, policyNumber: null, carrier: null }))
    expect(findLowConfidence(extraction({ coverages: many as never })).length).toBeLessThanOrEqual(30)
  })

  it('uses a threshold a person would agree with', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBeGreaterThanOrEqual(0.6)
    expect(LOW_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(0.9)
  })
})

describe('supported document types', () => {
  it('accepts PDF and common image formats', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
      expect(isSupportedCoiType(type)).toBe(true)
    }
  })

  it('refuses anything else rather than trying', () => {
    for (const type of ['application/msword', 'text/html', 'application/zip', '']) {
      expect(isSupportedCoiType(type)).toBe(false)
    }
  })
})

describe('the apply action goes through the deterministic path', () => {
  const source = readFileSync(join(process.cwd(), 'app/ops/actions/ai.ts'), 'utf8')

  it('validates reviewed values with the same schema as the manual form', () => {
    expect(source).toMatch(/certificateSchema\.safeParse/)
  })

  it('writes through createCertificate rather than a bespoke insert', () => {
    expect(source).toMatch(/createCertificate\(/)
  })

  it('requires the reviewCertificate capability', () => {
    expect(source).toMatch(/requireCapability\('reviewCertificate'\)/)
  })

  it('refuses to apply a draft twice', () => {
    expect(source).toMatch(/already been reviewed/)
  })

  it('never sets a compliance status directly', () => {
    expect(source).not.toMatch(/compliance_status\s*:/)
  })
})

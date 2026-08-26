import { describe, expect, it } from 'vitest'
import {
  copilotAnswerSchema, copilotPlanSchema, coiExtractionSchema, dashboardBriefSchema,
  auditBriefSchema, leadStructureSchema, parseModelOutput, proposalSchema,
} from '../lib/ops/ai/schemas'

/**
 * Model output is untrusted input. These tests are the contract that says so.
 */

describe('parseModelOutput', () => {
  it('returns a result rather than throwing, so callers must handle the bad case', () => {
    const bad = parseModelOutput(dashboardBriefSchema, { nope: true })
    expect(bad.ok).toBe(false)
    expect(bad.data).toBeUndefined()
    expect(bad.error).toBeTruthy()
  })

  it('survives every kind of junk without throwing', () => {
    for (const junk of [null, undefined, 'a string', 42, [], { headline: 123 }]) {
      expect(() => parseModelOutput(dashboardBriefSchema, junk)).not.toThrow()
    }
  })
})

describe('copilot plan', () => {
  it('accepts a well-formed plan', () => {
    const result = parseModelOutput(copilotPlanSchema, {
      toolCalls: [{ tool: 'get_expiring_policies', args: { windowDays: 45 } }],
      reply: '',
    })
    expect(result.ok).toBe(true)
    expect(result.data?.toolCalls[0].tool).toBe('get_expiring_policies')
  })

  it('clamps a runaway number of tool calls', () => {
    const result = parseModelOutput(copilotPlanSchema, {
      toolCalls: Array.from({ length: 50 }, () => ({ tool: 'get_tasks', args: {} })),
    })
    // Over the cap the schema rejects outright rather than silently truncating.
    expect(result.ok).toBe(false)
  })

  it('rejects a tool call carrying an object argument, which could hide a payload', () => {
    const result = parseModelOutput(copilotPlanSchema, {
      toolCalls: [{ tool: 'search_leads', args: { nested: { evil: true } } }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown top-level keys', () => {
    const result = parseModelOutput(copilotPlanSchema, { toolCalls: [], sql: 'DROP TABLE leads' })
    expect(result.ok).toBe(false)
  })

  it('defaults to no tool calls when the model omits them', () => {
    const result = parseModelOutput(copilotPlanSchema, { reply: 'hello' })
    expect(result.ok).toBe(true)
    expect(result.data?.toolCalls).toEqual([])
  })
})

describe('copilot answer', () => {
  it('accepts a minimal reply and fills the rest', () => {
    const result = parseModelOutput(copilotAnswerSchema, { reply: 'Three policies expire in 45 days.' })
    expect(result.ok).toBe(true)
    expect(result.data?.citedRecords).toEqual([])
    expect(result.data?.proposal).toBeNull()
  })

  it('rejects an extra field the model tried to smuggle in', () => {
    const result = parseModelOutput(copilotAnswerSchema, {
      reply: 'ok', executeSql: 'select * from job_costs',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an invented citation kind', () => {
    const result = parseModelOutput(copilotAnswerSchema, {
      reply: 'ok', citedRecords: [{ kind: 'payment', id: 'x', label: 'y' }],
    })
    expect(result.ok).toBe(false)
  })

  it('caps citations', () => {
    const result = parseModelOutput(copilotAnswerSchema, {
      reply: 'ok',
      citedRecords: Array.from({ length: 100 }, (_, i) => ({ kind: 'lead', id: `${i}`, label: 'x' })),
    })
    expect(result.ok).toBe(false)
  })
})

describe('write proposals', () => {
  it('accepts a lead proposal and defaults every unstated field', () => {
    const result = parseModelOutput(proposalSchema, {
      type: 'create_lead', fields: { first_name: 'John', phone: '9415550100' },
    })
    expect(result.ok).toBe(true)
    if (result.data?.type === 'create_lead') {
      expect(result.data.fields.first_name).toBe('John')
      expect(result.data.fields.email).toBe('')
    }
  })

  it('rejects a lead proposal carrying a field the lead form does not have', () => {
    const result = parseModelOutput(proposalSchema, {
      type: 'create_lead',
      fields: { first_name: 'John', pipeline_stage: 'won', assigned_to: 'someone' },
    })
    // pipeline_stage and assigned_to are NOT in the proposal schema: the model
    // must not be able to mark a lead Won or assign it to a person.
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown proposal type', () => {
    const result = parseModelOutput(proposalSchema, { type: 'delete_vendor', id: 'x' })
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid customer_type enum', () => {
    const result = parseModelOutput(proposalSchema, {
      type: 'create_lead', fields: { customer_type: 'government' },
    })
    expect(result.ok).toBe(false)
  })
})

describe('lead structuring', () => {
  it('defaults urgency to normal rather than guessing high', () => {
    const result = parseModelOutput(leadStructureSchema, { fields: { first_name: 'A' } })
    expect(result.ok).toBe(true)
    expect(result.data?.urgency).toBe('normal')
  })

  it('rejects an urgency outside the enum', () => {
    const result = parseModelOutput(leadStructureSchema, {
      fields: { first_name: 'A' }, urgency: 'CRITICAL!!!',
    })
    expect(result.ok).toBe(false)
  })
})

describe('COI extraction — missing stays missing', () => {
  it('keeps a null expiration date null instead of inventing one', () => {
    const result = parseModelOutput(coiExtractionSchema, {
      coverages: [{ coverageType: 'general_liability', expirationDate: null, policyNumber: null }],
    })
    expect(result.ok).toBe(true)
    expect(result.data?.coverages[0].expirationDate).toBeNull()
    expect(result.data?.coverages[0].policyNumber).toBeNull()
  })

  it('turns an unparseable date into null rather than passing it through', () => {
    const result = parseModelOutput(coiExtractionSchema, {
      coverages: [{ coverageType: 'general_liability', expirationDate: '09/12/2026' }],
    })
    expect(result.ok).toBe(true)
    expect(result.data?.coverages[0].expirationDate).toBeNull()
  })

  it('parses formatted currency into whole dollars', () => {
    const result = parseModelOutput(coiExtractionSchema, {
      coverages: [{ coverageType: 'general_liability', eachOccurrence: '$1,000,000' }],
    })
    expect(result.data?.coverages[0].eachOccurrence).toBe(1_000_000)
  })

  it('rejects a coverage type the database cannot store', () => {
    const result = parseModelOutput(coiExtractionSchema, {
      coverages: [{ coverageType: 'cyber_liability' }],
    })
    expect(result.ok).toBe(false)
  })

  it('keeps an ambiguous endorsement checkbox null rather than false', () => {
    const result = parseModelOutput(coiExtractionSchema, {
      coverages: [{ coverageType: 'general_liability' }],
    })
    expect(result.data?.coverages[0].additionalInsured).toBeNull()
    expect(result.data?.coverages[0].waiverOfSubrogation).toBeNull()
  })

  it('caps the number of coverage lines', () => {
    const result = parseModelOutput(coiExtractionSchema, {
      coverages: Array.from({ length: 40 }, () => ({ coverageType: 'other' })),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an extra field on a coverage line', () => {
    const result = parseModelOutput(coiExtractionSchema, {
      coverages: [{ coverageType: 'general_liability', isCompliant: true }],
    })
    // A model must not be able to assert compliance through the extraction shape.
    expect(result.ok).toBe(false)
  })

  it('handles a document with no coverage lines at all', () => {
    const result = parseModelOutput(coiExtractionSchema, {})
    expect(result.ok).toBe(true)
    expect(result.data?.coverages).toEqual([])
  })
})

describe('briefs', () => {
  it('requires an executive summary but tolerates empty sections', () => {
    const result = parseModelOutput(auditBriefSchema, { executiveSummary: 'All clear.' })
    expect(result.ok).toBe(true)
    expect(result.data?.criticalBlockers).toEqual([])
  })

  it('rejects a brief with no headline', () => {
    expect(parseModelOutput(dashboardBriefSchema, { bullets: ['x'] }).ok).toBe(false)
  })

  it('caps bullet count', () => {
    const result = parseModelOutput(dashboardBriefSchema, {
      headline: 'x', bullets: Array.from({ length: 50 }, () => 'y'),
    })
    expect(result.ok).toBe(false)
  })
})

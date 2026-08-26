import { describe, expect, it } from 'vitest'
import {
  clampDays, extractProjectQuery, extractWindowDays, normalise, parseIntent,
  DEFAULT_EXPIRY_WINDOW_DAYS, MAX_WINDOW_DAYS,
} from '../lib/ops/smart/intents'

/**
 * ============================================================================
 * THE INTENT PARSER
 * ----------------------------------------------------------------------------
 * Two things are being tested, and the second matters as much as the first:
 *
 *   1. Supported phrasings, and their synonyms, reach the right intent.
 *   2. Unsupported phrasings return NULL rather than a confident wrong match.
 *
 * A rule parser fails by being too eager. These tests are the pressure against
 * that — every widened pattern has to keep the null cases null.
 * ============================================================================
 */

const intentOf = (text: string) => parseIntent(text)?.intent ?? null

describe('normalise', () => {
  it('lowercases, drops punctuation the rules never need, and collapses whitespace', () => {
    expect(normalise("  What's   URGENT, today?  ")).toBe('whats urgent, today')
  })

  it('keeps every character a money amount needs, commas included', () => {
    // Stripping the comma here would turn "$2,500.00" into two numbers and
    // silently give the wrong answer, which is worse than no answer.
    expect(normalise('15% of $2,500.00')).toBe('15% of $2,500.00')
  })

  it('survives an empty or symbol-only string', () => {
    expect(normalise('')).toBe('')
    expect(parseIntent('???')).toBeNull()
  })
})

describe('attention summary', () => {
  for (const phrase of [
    'What needs my attention today?',
    'what do I need to do today',
    "what's urgent",
    'today’s priorities',
    'brief me',
    'catch me up',
    'give me an overview',
  ]) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('attention_summary'))
  }
})

describe('expiring policies', () => {
  for (const phrase of [
    'insurance expiring in 45 days',
    'COIs expiring soon',
    'policies expiring in 30 days',
    'show expiring insurance',
    'what coverage is lapsing',
    'what is expiring',
  ]) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('expiring_policies'))
  }

  it('extracts the day window when one is given', () => {
    expect(parseIntent('insurance expiring in 45 days')?.args.windowDays).toBe(45)
    expect(parseIntent('policies expiring in 30 days')?.args.windowDays).toBe(30)
  })

  it('leaves the window unset when none is given, so the caller uses its default', () => {
    expect(parseIntent('show expiring insurance')?.args.windowDays).toBeUndefined()
  })

  it('understands weeks and months as day windows', () => {
    expect(parseIntent('insurance expiring in 2 weeks')?.args.windowDays).toBe(14)
    expect(parseIntent('policies expiring in 3 months')?.args.windowDays).toBe(90)
  })

  it('clamps an absurd window rather than running the query', () => {
    expect(parseIntent('insurance expiring in 99999 days')?.args.windowDays).toBe(MAX_WINDOW_DAYS)
  })
})

describe('clampDays', () => {
  it('bounds to 1–365 and rounds', () => {
    expect(clampDays(0)).toBe(1)
    expect(clampDays(-40)).toBe(1)
    expect(clampDays(10_000)).toBe(365)
    expect(clampDays(45.6)).toBe(46)
  })

  it('falls back rather than producing NaN', () => {
    expect(clampDays(Number.NaN)).toBe(DEFAULT_EXPIRY_WINDOW_DAYS)
  })
})

describe('extractWindowDays', () => {
  it('returns undefined when the phrase has no window', () => {
    expect(extractWindowDays('show expiring insurance')).toBeUndefined()
  })
})

describe('missing paperwork', () => {
  for (const phrase of [
    'who is missing paperwork',
    'missing vendor documents',
    'incomplete subcontractors',
    'which subcontractors are not compliant',
    'show me compliance problems',
  ]) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('missing_vendor_documents'))
  }
})

describe('audit readiness', () => {
  for (const phrase of [
    'audit readiness',
    'am I ready for the audit',
    'what will block my audit',
    'audit problems',
  ]) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('audit_readiness'))
  }
})

describe('leads', () => {
  for (const phrase of [
    'leads needing follow-up',
    'show me new leads',
    'open leads',
    'stale leads',
    'who should I call',
  ]) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('leads_follow_up'))
  }
})

describe('jobs and schedule', () => {
  for (const phrase of [
    'active jobs',
    'jobs this week',
    "what's scheduled",
    'upcoming jobs',
  ]) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('active_jobs'))
  }

  it('takes a window when one is offered', () => {
    expect(parseIntent('what jobs are scheduled in 14 days')?.args.windowDays).toBe(14)
  })
})

describe('estimates', () => {
  for (const phrase of ['open estimates', 'estimates waiting', 'estimates not sent', 'show me bids']) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('open_estimates'))
  }
})

describe('invoices', () => {
  for (const phrase of ['unpaid invoices', 'overdue invoices', 'outstanding receivables', 'who owes us']) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('unpaid_invoices'))
  }
})

describe('job cost and profit', () => {
  it('separates cost from profit', () => {
    expect(intentOf('job cost for the Miller residence')).toBe('job_cost')
    expect(intentOf('profit on the Miller residence')).toBe('job_profit')
    expect(intentOf('what margin are we making on the Miller job')).toBe('job_profit')
  })

  it('extracts the job reference as a search term, not a route', () => {
    expect(parseIntent('job cost for the Miller residence')?.args.projectQuery).toBe('miller residence')
    expect(parseIntent('profit on the Venice remodel')?.args.projectQuery).toBe('venice remodel')
  })

  it('leaves the reference unset when the phrase names no job', () => {
    expect(parseIntent('show me gross profit')?.args.projectQuery).toBeUndefined()
  })
})

describe('extractProjectQuery', () => {
  it('drops filler words rather than searching for "the job"', () => {
    expect(extractProjectQuery('job cost for the job')).toBeUndefined()
    expect(extractProjectQuery('cost for my project')).toBeUndefined()
  })

  it('caps the length of what it will search for', () => {
    const long = `job cost for ${'a'.repeat(200)}`
    expect((extractProjectQuery(long) ?? '').length).toBeLessThanOrEqual(60)
  })
})

describe('help', () => {
  for (const phrase of ['help', 'what can you do', 'commands', 'what can I ask']) {
    it(`matches "${phrase}"`, () => expect(intentOf(phrase)).toBe('help'))
  }
})

describe('what the parser refuses to guess at', () => {
  // These are the cases that must reach the AI (or the help card), because a
  // deterministic answer here would be a fabricated one.
  for (const phrase of [
    'why did the Henderson job go over budget',
    'write me a poem about roofing',
    'summarise everything that happened last month',
    'is Dave any good',
    'should I take this job',
    'what did the customer say about drainage',
    'compare this quarter to last quarter',
  ]) {
    it(`returns null for "${phrase}"`, () => expect(parseIntent(phrase)).toBeNull())
  }

  it('returns null for empty input', () => {
    expect(parseIntent('')).toBeNull()
    expect(parseIntent('   ')).toBeNull()
  })
})

describe('the calculator wins over operational keywords', () => {
  it('reads a markup question as a calculation, not a job question', () => {
    expect(intentOf('add a 20% markup to 1800')).toBe('calculation')
  })

  it('reads a margin question with two numbers as a calculation', () => {
    expect(intentOf('what margin is 4000 revenue on 3000 cost')).toBe('calculation')
  })

  it('still routes a margin question about a job to the job intent', () => {
    expect(intentOf('what is the margin on the Miller job')).toBe('job_profit')
  })
})

describe('templates', () => {
  it('recognises the six supported templates', () => {
    expect(parseIntent('give me a COI renewal template')?.args.templateKey).toBe('coi_renewal')
    expect(parseIntent('draft a follow-up message for a lead')?.args.templateKey).toBe('lead_follow_up')
    expect(parseIntent('write an inspection confirmation email')?.args.templateKey).toBe('inspection_confirmation')
    expect(parseIntent('template for when I am unable to reach someone')?.args.templateKey).toBe('unable_to_reach')
    expect(parseIntent('missing document request template')?.args.templateKey).toBe('missing_document')
    expect(parseIntent('first response template for a new lead')?.args.templateKey).toBe('lead_first_response')
  })

  it('does not treat every mention of email as a template request', () => {
    expect(intentOf('which leads have no email')).toBe('leads_follow_up')
  })
})

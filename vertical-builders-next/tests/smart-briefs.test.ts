import { describe, expect, it } from 'vitest'
import { buildSmartAuditBrief, buildSmartDashboardBrief } from '../lib/ops/smart/briefs'
import type { AuditFacts, DashboardFacts } from '../lib/ops/smart/facts'

/**
 * ============================================================================
 * DETERMINISTIC BRIEFS
 * ----------------------------------------------------------------------------
 * Pure functions over a fact object, so every one of these runs without a
 * database, a network or a model. Same facts in, same brief out, every time.
 *
 * The important assertions are about restraint: no number that was not in the
 * facts, no verdict about whether an audit will be passed, and no financial
 * line at all for a viewer whose facts omitted them.
 * ============================================================================
 */

const dashboard = (over: Partial<DashboardFacts> = {}): DashboardFacts => ({
  coverageExpiring30: 0, coverageExpired: 0, vendorsBlocking: 0, vendorsNeedingReview: 0,
  leadsNeedingFollowUp: 0, openLeads: 0, activeProjects: 0, jobsStartingThisWeek: 0, ...over,
})

const audit = (over: Partial<AuditFacts> = {}): AuditFacts => ({
  vendorsEvaluated: 0, byStatus: {}, blocking: [], expiringSoon: [], expired: [],
  needsReview: [], activeProjects: 0, auditPeriod: null, ...over,
})

describe('the dashboard brief', () => {
  it('reports the counts it was given, in risk order', () => {
    const brief = buildSmartDashboardBrief(dashboard({
      coverageExpired: 2, coverageExpiring30: 3, vendorsBlocking: 1,
      leadsNeedingFollowUp: 4, overdueInvoices: 1, unpaidInvoices: 6,
    }))
    // Expired insurance first: it is the one that stops work happening.
    expect(brief.bullets[0]).toMatch(/2 coverage lines have already expired/i)
    expect(brief.bullets[1]).toMatch(/3 policies expire within 30 days/i)
    expect(brief.topPriority).toMatch(/expired certificates/i)
  })

  it('skips everything that is zero', () => {
    const brief = buildSmartDashboardBrief(dashboard({ leadsNeedingFollowUp: 2 }))
    expect(brief.bullets).toHaveLength(1)
    expect(brief.bullets[0]).toMatch(/2 leads need follow-up/i)
  })

  it('says so plainly when there is nothing to do', () => {
    const brief = buildSmartDashboardBrief(dashboard())
    expect(brief.bullets).toEqual([])
    expect(brief.headline).toMatch(/nothing needs attention/i)
    expect(brief.topPriority).toBeNull()
  })

  it('gets the singular right, because "1 leads" reads like a bug', () => {
    const brief = buildSmartDashboardBrief(dashboard({ leadsNeedingFollowUp: 1, coverageExpired: 1 }))
    expect(brief.bullets.join(' ')).toContain('1 coverage line has already expired')
    expect(brief.bullets.join(' ')).toContain('1 lead needs follow-up')
  })

  it('omits the receivables tile entirely when the facts omitted it', () => {
    // Not zero, not hidden — absent. The viewer could not see the numbers, so
    // the query never ran and there is nothing to render.
    const brief = buildSmartDashboardBrief(dashboard({ leadsNeedingFollowUp: 1 }))
    expect(brief.facts.map(f => f.label)).not.toContain('Unpaid invoices')
    expect(JSON.stringify(brief)).not.toMatch(/invoice/i)
  })

  it('includes the receivables tile when the facts carried it', () => {
    const brief = buildSmartDashboardBrief(dashboard({ unpaidInvoices: 3, overdueInvoices: 1 }))
    expect(brief.facts.map(f => f.label)).toContain('Unpaid invoices')
  })

  it('greets by first name only when it was given one', () => {
    expect(buildSmartDashboardBrief(dashboard(), 'Fred Pierre').headline).toMatch(/^Fred, /)
    expect(buildSmartDashboardBrief(dashboard()).headline).not.toMatch(/^, /)
  })

  it('links only to routes the application owns', () => {
    const brief = buildSmartDashboardBrief(dashboard({ coverageExpired: 1, leadsNeedingFollowUp: 1 }))
    for (const action of brief.actions) {
      expect(action.href, action.label).toMatch(/^\/ops\//)
    }
  })

  it('is deterministic — the same facts give byte-identical output', () => {
    const facts = dashboard({ coverageExpired: 2, leadsNeedingFollowUp: 3 })
    expect(JSON.stringify(buildSmartDashboardBrief(facts, 'Fred')))
      .toBe(JSON.stringify(buildSmartDashboardBrief(facts, 'Fred')))
  })
})

describe('the audit brief', () => {
  const populated = audit({
    vendorsEvaluated: 12,
    blocking: [
      { vendor: 'ZZ Roofing LLC', status: 'non_compliant', issues: ['General liability: expired'] },
      { vendor: 'Gulf Framing', status: 'missing', issues: ['Workers compensation: no certificate on file'] },
    ],
    expiringSoon: [
      { vendor: 'Acme Electric', coverage: 'general_liability', expirationDate: '2026-10-01', daysOut: 36 },
    ],
    expired: [
      { vendor: 'ZZ Roofing LLC', coverage: 'general_liability', expirationDate: '2026-07-01', daysOut: -56 },
    ],
    needsReview: [{ vendor: 'Bay Plumbing', issues: ['Umbrella: limits could not be read'] }],
    activeProjects: 5,
  })

  it('names specific subcontractors rather than saying "some vendors"', () => {
    const brief = buildSmartAuditBrief(populated)
    expect(brief.criticalBlockers.join(' ')).toContain('ZZ Roofing LLC')
    expect(brief.criticalBlockers.join(' ')).toContain('Gulf Framing')
    expect(brief.needsHumanReview.join(' ')).toContain('Bay Plumbing')
  })

  it('reports readiness as system status, never as a verdict', () => {
    const brief = buildSmartAuditBrief(populated)
    expect(brief.readinessStatement).toMatch(/^The system currently shows/)
    // The system does not certify an audit outcome, and must not sound as if it does.
    expect(brief.readinessStatement).not.toMatch(/you (are|will) (ready|pass)/i)
    expect(brief.readinessStatement).not.toMatch(/\byou will pass\b/i)
  })

  it('states a clean result without claiming the audit is passed', () => {
    const brief = buildSmartAuditBrief(audit({ vendorsEvaluated: 4 }))
    expect(brief.readinessStatement).toMatch(/no subcontractors blocking readiness/i)
    expect(brief.readinessStatement).not.toMatch(/passed|compliant overall|all clear/i)
  })

  it('shows how long ago a lapsed policy expired', () => {
    const brief = buildSmartAuditBrief(populated)
    expect(brief.missingPaperwork[0]).toContain('56 days ago')
  })

  it('shows how far out an expiring policy is', () => {
    const brief = buildSmartAuditBrief(populated)
    expect(brief.expiringSoon[0]).toContain('36 days out')
  })

  it('recommends the lapsed certificates first', () => {
    const brief = buildSmartAuditBrief(populated)
    expect(brief.recommendedActions[0]).toMatch(/lapsed coverage line/i)
  })

  it('returns empty sections rather than filler when there is nothing in them', () => {
    const brief = buildSmartAuditBrief(audit({ vendorsEvaluated: 3 }))
    expect(brief.criticalBlockers).toEqual([])
    expect(brief.expiringSoon).toEqual([])
    expect(brief.needsHumanReview).toEqual([])
    expect(brief.recommendedActions).toHaveLength(1)
    expect(brief.recommendedActions[0]).toMatch(/no action is outstanding/i)
  })

  it('mentions the audit period when one was supplied', () => {
    const brief = buildSmartAuditBrief(audit({
      vendorsEvaluated: 1, auditPeriod: { start: '2026-01-01', end: '2026-08-21' },
    }))
    expect(brief.executiveSummary).toContain('2026-01-01')
  })

  it('never invents a number that was not in the facts', () => {
    const brief = buildSmartAuditBrief(populated)
    const values = brief.facts.map(f => f.value)
    expect(values).toContain(12)  // vendorsEvaluated
    expect(values).toContain(2)   // blocking
    expect(values).toContain(1)   // expired
    expect(values).toContain(5)   // activeProjects
  })

  it('is deterministic', () => {
    expect(JSON.stringify(buildSmartAuditBrief(populated)))
      .toBe(JSON.stringify(buildSmartAuditBrief(populated)))
  })
})

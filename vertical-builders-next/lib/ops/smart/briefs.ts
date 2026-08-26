import type { AuditFacts, DashboardFacts } from './facts'
import type { SmartAction, SmartFact, SmartItem } from './types'

/**
 * ============================================================================
 * DETERMINISTIC BRIEFS — the same facts, written by code
 * ----------------------------------------------------------------------------
 * Pure functions over the fact objects in `./facts.ts`. No database, no model,
 * no network: hand them facts and they hand back a brief.
 *
 * The writing is templated, and it reads like it. That is the honest trade —
 * this is a status report, not prose, and calling it "AI-written" would be a
 * lie. What it does have is the property that matters: every number is the
 * number the compliance evaluator actually produced.
 * ============================================================================
 */

export interface SmartBrief {
  headline: string
  bullets: string[]
  topPriority: string | null
  facts: SmartFact[]
  actions: SmartAction[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const verb = (n: number, singular: string, plural_: string) => (n === 1 ? singular : plural_)

// ---------------------------------------------------------------------------
// Dashboard brief
// ---------------------------------------------------------------------------

/**
 * Ordered by what costs money or creates risk if ignored, which is the same
 * priority order the AI brief is instructed to use. Zeros are skipped: a list
 * of things that are fine is noise.
 */
export function buildSmartDashboardBrief(facts: DashboardFacts, name?: string): SmartBrief {
  const bullets: string[] = []
  const priorities: string[] = []

  if (facts.coverageExpired > 0) {
    bullets.push(`${plural(facts.coverageExpired, 'coverage line')} ${verb(facts.coverageExpired, 'has', 'have')} already expired.`)
    priorities.push('Chase the expired certificates — work cannot be scheduled against lapsed coverage.')
  }
  if (facts.coverageExpiring30 > 0) {
    bullets.push(`${plural(facts.coverageExpiring30, 'policy', 'policies')} expire within 30 days.`)
    priorities.push('Send renewal requests for the policies expiring this month.')
  }
  if (facts.vendorsBlocking > 0) {
    bullets.push(`${plural(facts.vendorsBlocking, 'subcontractor')} ${verb(facts.vendorsBlocking, 'is', 'are')} blocking compliance.`)
    priorities.push('Clear the blocking subcontractors before the next audit.')
  }
  if (facts.vendorsNeedingReview > 0) {
    bullets.push(`${plural(facts.vendorsNeedingReview, 'subcontractor file')} ${verb(facts.vendorsNeedingReview, 'needs', 'need')} review.`)
  }
  if (typeof facts.overdueInvoices === 'number' && facts.overdueInvoices > 0) {
    bullets.push(`${plural(facts.overdueInvoices, 'invoice')} ${verb(facts.overdueInvoices, 'is', 'are')} overdue.`)
    priorities.push('Follow up the overdue invoices.')
  }
  if (facts.leadsNeedingFollowUp > 0) {
    bullets.push(`${plural(facts.leadsNeedingFollowUp, 'lead')} ${verb(facts.leadsNeedingFollowUp, 'needs', 'need')} follow-up.`)
    priorities.push('Call the leads that are overdue a follow-up.')
  }
  if (facts.jobsStartingThisWeek > 0) {
    bullets.push(`${plural(facts.jobsStartingThisWeek, 'job')} ${verb(facts.jobsStartingThisWeek, 'starts', 'start')} in the next 7 days.`)
  }

  const who = name ? `${name.split(' ')[0]}, ` : ''
  const headline = bullets.length === 0
    ? `${who}nothing needs attention right now — no expiring coverage, no compliance blockers, no overdue follow-ups.`
    : `${who}${plural(bullets.length, 'thing')} ${verb(bullets.length, 'needs', 'need')} your attention today.`

  const facts_: SmartFact[] = [
    { label: 'Expired coverage', value: facts.coverageExpired, tone: facts.coverageExpired > 0 ? 'bad' : 'ok' },
    { label: 'Expiring in 30 days', value: facts.coverageExpiring30, tone: facts.coverageExpiring30 > 0 ? 'warn' : 'ok' },
    { label: 'Blocking subcontractors', value: facts.vendorsBlocking, tone: facts.vendorsBlocking > 0 ? 'bad' : 'ok' },
    { label: 'Leads needing follow-up', value: facts.leadsNeedingFollowUp, tone: facts.leadsNeedingFollowUp > 0 ? 'warn' : 'ok' },
    { label: 'Active jobs', value: facts.activeProjects },
  ]
  if (typeof facts.unpaidInvoices === 'number') {
    facts_.push({
      label: 'Unpaid invoices',
      value: facts.unpaidInvoices,
      tone: (facts.overdueInvoices ?? 0) > 0 ? 'warn' : 'neutral',
    })
  }

  const actions: SmartAction[] = []
  if (facts.coverageExpired > 0 || facts.coverageExpiring30 > 0) {
    actions.push({ label: 'Review expiring coverage', href: '/ops/compliance' })
  }
  if (facts.vendorsBlocking > 0 || facts.vendorsNeedingReview > 0) {
    actions.push({ label: 'Open the compliance register', href: '/ops/compliance' })
  }
  if (facts.leadsNeedingFollowUp > 0) {
    actions.push({ label: 'See leads needing follow-up', href: '/ops/leads' })
  }

  return { headline, bullets, topPriority: priorities[0] ?? null, facts: facts_, actions }
}

// ---------------------------------------------------------------------------
// Audit brief
// ---------------------------------------------------------------------------

export interface SmartAuditBrief {
  readinessStatement: string
  executiveSummary: string
  criticalBlockers: string[]
  expiringSoon: string[]
  missingPaperwork: string[]
  needsHumanReview: string[]
  recommendedActions: string[]
  facts: SmartFact[]
  items: SmartItem[]
}

export function buildSmartAuditBrief(facts: AuditFacts): SmartAuditBrief {
  const blockingCount = facts.blocking.length
  const reviewCount = facts.needsReview.length
  const expiredCount = facts.expired.length
  const expiringCount = facts.expiringSoon.length

  // Phrased as a report of system status, never as a verdict. The system does
  // not certify that an audit will be passed and must not sound as though it does.
  const readinessStatement = blockingCount === 0 && expiredCount === 0
    ? `The system currently shows no subcontractors blocking readiness across ${plural(facts.vendorsEvaluated, 'evaluated subcontractor')}.`
    : `The system currently shows ${plural(blockingCount, 'subcontractor')} blocking readiness and ${plural(expiredCount, 'expired coverage line')}, across ${plural(facts.vendorsEvaluated, 'evaluated subcontractor')}.`

  const summaryParts = [
    `${plural(facts.vendorsEvaluated, 'subcontractor')} evaluated against the current requirements.`,
  ]
  if (blockingCount > 0) summaryParts.push(`${plural(blockingCount, 'file')} would block an audit today.`)
  if (expiredCount > 0) summaryParts.push(`${plural(expiredCount, 'coverage line')} already lapsed.`)
  if (expiringCount > 0) summaryParts.push(`${plural(expiringCount, 'more')} expire within 60 days.`)
  if (reviewCount > 0) summaryParts.push(`${plural(reviewCount, 'file')} need a human decision.`)
  if (summaryParts.length === 1) summaryParts.push('No blockers, no lapses and nothing awaiting review.')
  if (facts.auditPeriod) {
    summaryParts.push(`Audit period ${facts.auditPeriod.start} to ${facts.auditPeriod.end}.`)
  }

  const recommended: string[] = []
  if (expiredCount > 0) recommended.push(`Obtain replacement certificates for the ${plural(expiredCount, 'lapsed coverage line')} before any further work is scheduled.`)
  if (blockingCount > 0) recommended.push(`Resolve the ${plural(blockingCount, 'blocking subcontractor file')} listed above.`)
  if (expiringCount > 0) recommended.push(`Send renewal requests for the ${plural(expiringCount, 'policy', 'policies')} expiring within 60 days.`)
  if (reviewCount > 0) recommended.push(`Review the ${plural(reviewCount, 'file')} the evaluator could not decide automatically.`)
  if (recommended.length === 0) recommended.push('No action is outstanding. Re-run this brief before the audit date to confirm nothing has lapsed since.')

  return {
    readinessStatement,
    executiveSummary: summaryParts.join(' '),
    criticalBlockers: facts.blocking.map(b =>
      `${b.vendor} — ${b.status.replace(/_/g, ' ')}${b.issues.length ? `: ${b.issues.join('; ')}` : ''}`),
    expiringSoon: facts.expiringSoon.map(p =>
      `${p.vendor} — ${p.coverage.replace(/_/g, ' ')} expires ${p.expirationDate} (${p.daysOut} ${p.daysOut === 1 ? 'day' : 'days'} out)`),
    missingPaperwork: facts.expired.map(p =>
      `${p.vendor} — ${p.coverage.replace(/_/g, ' ')} expired ${p.expirationDate} (${Math.abs(p.daysOut)} ${Math.abs(p.daysOut) === 1 ? 'day' : 'days'} ago)`),
    needsHumanReview: facts.needsReview.map(r =>
      `${r.vendor}${r.issues.length ? ` — ${r.issues.join('; ')}` : ''}`),
    recommendedActions: recommended,
    facts: [
      { label: 'Subcontractors evaluated', value: facts.vendorsEvaluated },
      { label: 'Blocking readiness', value: blockingCount, tone: blockingCount > 0 ? 'bad' : 'ok' },
      { label: 'Coverage already expired', value: expiredCount, tone: expiredCount > 0 ? 'bad' : 'ok' },
      { label: 'Expiring within 60 days', value: expiringCount, tone: expiringCount > 0 ? 'warn' : 'ok' },
      { label: 'Awaiting human review', value: reviewCount, tone: reviewCount > 0 ? 'warn' : 'ok' },
      { label: 'Active jobs', value: facts.activeProjects },
    ],
    items: facts.blocking.slice(0, 10).map(b => ({
      title: b.vendor,
      subtitle: b.issues[0] ?? undefined,
      status: b.status,
    })),
  }
}

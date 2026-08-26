import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requestJson } from './provider'
import { auditBriefSchema, dashboardBriefSchema, parseModelOutput, type AuditBrief, type DashboardBrief } from './schemas'
import { INJECTION_PREAMBLE, clampText } from './guardrails'
import { buildComplianceRegister } from '../services/compliance'
import { findExpiringPolicies } from '../services/certificates'
import { ACTIVE_PROJECT_STATUSES, OPEN_LEAD_STAGES } from '../types'

/**
 * ============================================================================
 * BRIEFS
 * ----------------------------------------------------------------------------
 * The division of labour is the whole point:
 *
 *   Application code  computes every number, deterministically, under RLS.
 *   The model         puts them in priority order and writes the sentences.
 *
 * The model is never asked "how many policies are expiring". It is handed the
 * count and told to prioritise. That way a hallucinated number is not merely
 * unlikely — there is no path by which one could appear, because the model was
 * never doing arithmetic in the first place.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Audit brief
// ---------------------------------------------------------------------------

export interface AuditFacts {
  vendorsEvaluated: number
  byStatus: Record<string, number>
  blocking: { vendor: string; status: string; issues: string[] }[]
  expiringSoon: { vendor: string; coverage: string; expirationDate: string; daysOut: number }[]
  expired: { vendor: string; coverage: string; expirationDate: string; daysOut: number }[]
  needsReview: { vendor: string; issues: string[] }[]
  activeProjects: number
  auditPeriod: { start: string; end: string } | null
}

/** Deterministic. Every figure in the brief traces back to one of these. */
export async function collectAuditFacts(
  supabase: SupabaseClient,
  period: { start: string; end: string } | null,
): Promise<AuditFacts> {
  const [register, expiring] = await Promise.all([
    buildComplianceRegister(supabase, {}),
    findExpiringPolicies(supabase, 60, { includeExpired: true }),
  ])

  const { count: activeProjects } = await supabase
    .from('projects').select('id', { count: 'exact', head: true })
    .in('status', ACTIVE_PROJECT_STATUSES).is('archived_at', null)

  const byStatus: Record<string, number> = {}
  for (const row of register) {
    byStatus[row.evaluation.status] = (byStatus[row.evaluation.status] ?? 0) + 1
  }

  const issuesOf = (row: (typeof register)[number]) =>
    row.evaluation.checks
      .filter(c => c.status !== 'pass')
      .slice(0, 4)
      .map(c => `${c.coverageLabel}: ${c.reasons[0] ?? c.status}`)

  return {
    vendorsEvaluated: register.length,
    byStatus,
    blocking: register
      .filter(r => ['missing', 'non_compliant'].includes(r.evaluation.status))
      .slice(0, 25)
      .map(r => ({ vendor: r.vendor.legal_name, status: r.evaluation.status, issues: issuesOf(r) })),
    expiringSoon: expiring.filter(p => p.days_out >= 0).slice(0, 25).map(p => ({
      vendor: p.vendor_name, coverage: p.coverage_type,
      expirationDate: p.expiration_date, daysOut: p.days_out,
    })),
    expired: expiring.filter(p => p.days_out < 0).slice(0, 25).map(p => ({
      vendor: p.vendor_name, coverage: p.coverage_type,
      expirationDate: p.expiration_date, daysOut: p.days_out,
    })),
    needsReview: register
      .filter(r => r.evaluation.status === 'needs_review')
      .slice(0, 25)
      .map(r => ({ vendor: r.vendor.legal_name, issues: issuesOf(r) })),
    activeProjects: activeProjects ?? 0,
    auditPeriod: period,
  }
}

export async function generateAuditBrief(facts: AuditFacts): Promise<AuditBrief> {
  const response = await requestJson({
    messages: [
      {
        role: 'system',
        content: [
          'You write an audit-readiness brief for the owner of a Florida general',
          'contractor, from figures the compliance system has already calculated.',
          '',
          INJECTION_PREAMBLE,
          '',
          'RULES',
          '- Every number in your brief must come from the facts below. Do not compute,',
          '  estimate or round anything.',
          '- You are summarising statuses the system determined. You are not deciding',
          '  whether the company passes an audit, and you must not imply that you are.',
          '- readinessStatement must be phrased as a summary of system status, e.g.',
          '  "The system currently shows 3 subcontractors blocking readiness."',
          '  Never "You are ready" or "You will pass".',
          '- Name specific subcontractors. A brief that says "some vendors have issues"',
          '  is useless.',
          '- If a section has nothing in it, return an empty array rather than filler.',
          '',
          'Respond with JSON only:',
          '{ "executiveSummary": "", "criticalBlockers": [], "expiringSoon": [],',
          '  "missingPaperwork": [], "needsHumanReview": [], "recommendedActions": [],',
          '  "readinessStatement": "" }',
        ].join('\n'),
      },
      { role: 'user', content: `DETERMINISTIC FACTS (calculated by the system):\n${JSON.stringify(facts).slice(0, 12_000)}` },
    ],
    maxOutputTokens: 1_500,
    temperature: 0.2,
  })

  const parsed = parseModelOutput(auditBriefSchema, response.data)
  if (!parsed.ok || !parsed.data) throw new Error(parsed.error ?? 'The AI returned an unusable brief.')
  return parsed.data
}

// ---------------------------------------------------------------------------
// Dashboard brief
// ---------------------------------------------------------------------------

export interface DashboardFacts {
  coverageExpiring30: number
  coverageExpired: number
  vendorsBlocking: number
  vendorsNeedingReview: number
  leadsNeedingFollowUp: number
  openLeads: number
  activeProjects: number
  jobsStartingThisWeek: number
  /** Omitted entirely when the viewer has no financial access. */
  unpaidInvoices?: number
  overdueInvoices?: number
}

export async function collectDashboardFacts(
  supabase: SupabaseClient,
  opts: { includeFinancial: boolean },
): Promise<DashboardFacts> {
  const today = new Date().toISOString().slice(0, 10)
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

  const [register, expiring, leads, projects, starting] = await Promise.all([
    buildComplianceRegister(supabase, {}),
    findExpiringPolicies(supabase, 30, { includeExpired: true }),
    supabase.from('leads').select('id, next_follow_up_at, last_contacted_at')
      .is('archived_at', null).in('pipeline_stage', OPEN_LEAD_STAGES).limit(500),
    supabase.from('projects').select('id', { count: 'exact', head: true })
      .in('status', ACTIVE_PROJECT_STATUSES).is('archived_at', null),
    supabase.from('projects').select('id', { count: 'exact', head: true })
      .gte('scheduled_start_date', today).lte('scheduled_start_date', weekOut),
  ])

  const leadRows = leads.data ?? []
  const facts: DashboardFacts = {
    coverageExpiring30: expiring.filter(p => p.days_out >= 0).length,
    coverageExpired: expiring.filter(p => p.days_out < 0).length,
    vendorsBlocking: register.filter(r => ['missing', 'non_compliant'].includes(r.evaluation.status)).length,
    vendorsNeedingReview: register.filter(r => r.evaluation.status === 'needs_review').length,
    leadsNeedingFollowUp: leadRows.filter(l =>
      !l.last_contacted_at || (l.next_follow_up_at && (l.next_follow_up_at as string) <= new Date().toISOString())).length,
    openLeads: leadRows.length,
    activeProjects: projects.count ?? 0,
    jobsStartingThisWeek: starting.count ?? 0,
  }

  // The financial numbers are simply not fetched for a viewer without access,
  // so they cannot leak into the prompt, let alone the output.
  if (opts.includeFinancial) {
    const { data: invoices } = await supabase.from('invoices')
      .select('due_date, balance_due_cents').not('status', 'in', '(draft,void)').gt('balance_due_cents', 0).limit(500)
    const list = invoices ?? []
    facts.unpaidInvoices = list.length
    facts.overdueInvoices = list.filter(i => i.due_date && (i.due_date as string) < today).length
  }

  return facts
}

export async function generateDashboardBrief(facts: DashboardFacts, name: string): Promise<DashboardBrief> {
  const response = await requestJson({
    messages: [
      {
        role: 'system',
        content: [
          'You write a four-line morning brief for the owner of a Florida general',
          'contractor, from counts the system has already calculated.',
          '',
          INJECTION_PREAMBLE,
          '',
          'RULES',
          '- Use only the numbers given. Never compute or estimate one.',
          '- Skip anything that is zero. A brief listing things that are fine is noise.',
          '- Order by what costs money or creates risk if ignored: expired insurance',
          '  first, then blocked subcontractors, then overdue invoices, then leads.',
          '- Each bullet is one short sentence. No preamble, no encouragement.',
          '- If everything is zero, say so in one line and return no bullets.',
          '',
          'Respond with JSON only:',
          '{ "headline": "one sentence", "bullets": ["..."], "topPriority": "the single',
          '  most important thing to do today" }',
        ].join('\n'),
      },
      { role: 'user', content: `For ${clampText(name, 60)}.\nFACTS:\n${JSON.stringify(facts)}` },
    ],
    maxOutputTokens: 500,
    temperature: 0.2,
  })

  const parsed = parseModelOutput(dashboardBriefSchema, response.data)
  if (!parsed.ok || !parsed.data) throw new Error(parsed.error ?? 'The AI returned an unusable brief.')
  return parsed.data
}

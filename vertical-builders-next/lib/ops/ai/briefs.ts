import 'server-only'
import { requestJson } from './provider'
import { auditBriefSchema, dashboardBriefSchema, parseModelOutput, type AuditBrief, type DashboardBrief } from './schemas'
import { INJECTION_PREAMBLE, clampText } from './guardrails'
import {
  collectAuditFacts, collectDashboardFacts,
  type AuditFacts, type DashboardFacts,
} from '../smart/facts'

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
 * The facts themselves are collected by `lib/ops/smart/facts.ts` and are shared
 * with Smart Ops, so both modes report the same numbers from the same queries.
 * ============================================================================
 */

// Re-exported so existing callers keep importing briefs from one place.
export { collectAuditFacts, collectDashboardFacts }
export type { AuditFacts, DashboardFacts }

// ---------------------------------------------------------------------------
// Audit brief
// ---------------------------------------------------------------------------

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

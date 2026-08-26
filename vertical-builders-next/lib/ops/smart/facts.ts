import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildComplianceRegister } from '../services/compliance'
import { findExpiringPolicies } from '../services/certificates'
import { ACTIVE_PROJECT_STATUSES, OPEN_LEAD_STAGES } from '../types'

/**
 * ============================================================================
 * DETERMINISTIC FACTS — the numbers, computed by application code
 * ----------------------------------------------------------------------------
 * These collectors are the single source of every figure in every brief, in
 * both modes. Smart Ops renders them directly. AI Enhanced hands the same
 * object to a model and asks it to prioritise and phrase — never to count.
 *
 * They live here, outside `lib/ops/ai/`, precisely so that Smart Ops can reach
 * them without pulling the OpenAI provider into its module graph. That is not
 * tidiness for its own sake: a test asserts that nothing under `lib/ops/smart/`
 * can reach the provider, and this file is what makes that possible while the
 * two modes still share one definition of the truth.
 *
 * Every query runs on the caller\'s user-scoped Supabase client, under RLS.
 * ============================================================================
 */

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

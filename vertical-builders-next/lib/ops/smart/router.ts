import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canViewCosts, canViewProfit, can } from '../auth/permissions'
import type { UserRole } from '../types'
import { executeTool, type ToolContext } from '../ai/tools'
import { collectAuditFacts, collectDashboardFacts } from './facts'
import { buildSmartAuditBrief, buildSmartDashboardBrief } from './briefs'
import { calculate } from './calculations'
import { parseIntent, DEFAULT_EXPIRY_WINDOW_DAYS } from './intents'
import { isTemplateKey, renderTemplate, TEMPLATE_LABELS } from './templates'
import type { SmartItem, SmartOpsMatch, SmartOpsResponse } from './types'

/**
 * ============================================================================
 * SMART OPS ROUTER — deterministic execution
 * ----------------------------------------------------------------------------
 * Takes a matched intent and produces an answer, using the same allowlisted
 * read tools the Copilot uses, on the same user-scoped Supabase client, under
 * the same RLS. The permission story is therefore identical in both modes:
 * Smart Ops cannot see a row the signed-in user could not fetch themselves, and
 * a financial intent for an auditor is refused before a query is built.
 *
 * Three properties are load-bearing:
 *
 *   1. This module never imports the AI provider. A test asserts it, which is
 *      what makes the zero-provider guarantee mechanical rather than a promise.
 *   2. It never writes. Every intent is a read, a calculation or a template.
 *   3. Every `href` comes from the fixed map below. The parser cannot invent a
 *      route, because it never supplies one.
 * ============================================================================
 */

export interface SmartOpsContext {
  supabase: SupabaseClient
  userId: string
  userName: string
  role: UserRole
  settings: { costs_visible_to_pm: boolean; profit_visible_to_pm: boolean }
}

/** Application-owned routes. Nothing user-supplied ever reaches an href. */
const ROUTES = {
  compliance: '/ops/compliance',
  subcontractors: '/ops/subcontractors',
  subcontractor: (id: string) => `/ops/subcontractors/${id}`,
  audits: '/ops/audits',
  leads: '/ops/leads',
  lead: (id: string) => `/ops/leads/${id}`,
  projects: '/ops/projects',
  project: (id: string) => `/ops/projects/${id}`,
  schedule: '/ops/schedule',
  estimates: '/ops/estimates',
  estimate: (id: string) => `/ops/estimates/${id}`,
  invoices: '/ops/invoices',
  invoice: (id: string) => `/ops/invoices/${id}`,
  dashboard: '/ops/dashboard',
} as const

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const toolCtx = (ctx: SmartOpsContext): ToolContext => ({
  supabase: ctx.supabase,
  userId: ctx.userId,
  role: ctx.role,
  settings: ctx.settings,
})

/** A row shape loose enough for the tool payloads, strict enough to be safe. */
type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const refused = (intent: SmartOpsResponse['intent'], title: string, summary: string): SmartOpsResponse =>
  ({ mode: 'smart_ops', intent, title, summary, notices: ['This is a permission boundary, not a missing feature.'] })

// ---------------------------------------------------------------------------
// The supported command list — also what `help` prints
// ---------------------------------------------------------------------------

export interface SmartCommand {
  example: string
  what: string
  /** Financial commands are hidden from an account that cannot use them. */
  requires?: 'costs' | 'profit' | 'invoices'
}

export const SMART_COMMANDS: SmartCommand[] = [
  { example: 'What needs my attention today?', what: 'A prioritised summary across compliance, leads and jobs' },
  { example: 'Show insurance expiring in 45 days', what: 'Coverage lines expiring inside a window you name' },
  { example: 'Who is missing paperwork?', what: 'Subcontractors whose file is incomplete' },
  { example: 'What is my audit readiness?', what: 'Counts from the deterministic compliance evaluator' },
  { example: 'Which leads need follow-up?', what: 'Open leads overdue a call' },
  { example: 'What jobs are active this week?', what: 'Jobs starting or finishing in the next 7 days' },
  { example: 'Show open estimates', what: 'Estimates not yet approved or declined' },
  { example: 'Show unpaid invoices', what: 'Issued invoices with a balance', requires: 'invoices' },
  { example: 'Job cost for the Miller residence', what: 'Recorded costs on one job', requires: 'costs' },
  { example: 'Profit on the Miller residence', what: 'Contract versus cost on one job', requires: 'profit' },
  { example: 'What is 15% of 2500?', what: 'Percentages, markup, margin and basic arithmetic' },
  { example: 'Give me a COI renewal template', what: 'A ready-to-edit message you send yourself' },
]

export function availableCommands(ctx: Pick<SmartOpsContext, 'role' | 'settings'>): SmartCommand[] {
  return SMART_COMMANDS.filter(command => {
    if (!command.requires) return true
    if (command.requires === 'costs') return canViewCosts(ctx.role, ctx.settings)
    if (command.requires === 'profit') return canViewProfit(ctx.role, ctx.settings)
    // Matches the tool layer: receivables through the assistant are closed to
    // the auditor, so the command is not advertised either.
    if (ctx.role === 'read_only') return false
    return can(ctx.role, 'invoicesView')
  })
}

export function helpResponse(ctx: Pick<SmartOpsContext, 'role' | 'settings'>, preamble?: string): SmartOpsResponse {
  const commands = availableCommands(ctx)
  return {
    mode: 'smart_ops',
    intent: 'help',
    title: 'What I can answer',
    summary: preamble
      ?? 'I read your live CRM data and answer a defined set of operational questions. No AI provider is involved, so this costs nothing to run.',
    items: commands.map(c => ({ title: c.example, subtitle: c.what })),
    suggestedActions: commands.slice(0, 4).map(c => ({ label: c.example, command: c.example })),
  }
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

async function attentionSummary(ctx: SmartOpsContext): Promise<SmartOpsResponse> {
  // Financial counts are only fetched when the viewer can see them — the same
  // rule the AI brief follows, for the same reason.
  const includeFinancial = can(ctx.role, 'invoicesView') && ctx.role !== 'read_only'
  const facts = await collectDashboardFacts(ctx.supabase, { includeFinancial })
  const brief = buildSmartDashboardBrief(facts, ctx.userName)

  return {
    mode: 'smart_ops',
    intent: 'attention_summary',
    title: 'Today',
    summary: brief.headline,
    facts: brief.facts,
    items: brief.bullets.map(b => ({ title: b })),
    notices: brief.topPriority ? [`Start with: ${brief.topPriority}`] : undefined,
    suggestedActions: brief.actions,
  }
}

async function expiringPolicies(ctx: SmartOpsContext, windowDays?: number): Promise<SmartOpsResponse> {
  const days = windowDays ?? DEFAULT_EXPIRY_WINDOW_DAYS
  const result = await executeTool(toolCtx(ctx), 'get_expiring_policies', { windowDays: days, limit: 25 })
  if (!result.ok) return refused('expiring_policies', 'Expiring coverage', result.denied ?? 'That lookup is not available.')

  const data = (result.data ?? {}) as { count?: number; policies?: Row[] }
  const policies = data.policies ?? []
  const expired = policies.filter(p => num(p.daysOut) < 0)

  return {
    mode: 'smart_ops',
    intent: 'expiring_policies',
    title: `Coverage expiring within ${days} days`,
    summary: (data.count ?? 0) === 0
      ? `No coverage lines expire in the next ${days} days.`
      : `${data.count} coverage ${data.count === 1 ? 'line' : 'lines'} expire within ${days} days${expired.length ? `, and ${expired.length} ${expired.length === 1 ? 'has' : 'have'} already lapsed` : ''}.`,
    facts: [
      { label: 'Expiring', value: (data.count ?? 0) - expired.length, tone: 'warn' },
      { label: 'Already expired', value: expired.length, tone: expired.length ? 'bad' : 'ok' },
      { label: 'Window', value: `${days} days` },
    ],
    items: policies.map(p => ({
      id: str(p.vendorId),
      title: str(p.vendor),
      subtitle: `${str(p.coverage).replace(/_/g, ' ')}${p.carrier ? ` · ${str(p.carrier)}` : ''} · expires ${str(p.expirationDate)}`,
      status: num(p.daysOut) < 0 ? `expired ${Math.abs(num(p.daysOut))}d ago` : `${num(p.daysOut)}d out`,
      href: str(p.vendorId) ? ROUTES.subcontractor(str(p.vendorId)) : undefined,
    })),
    suggestedActions: [
      { label: 'Open the compliance register', href: ROUTES.compliance },
      { label: 'Draft a COI renewal request', command: 'Give me a COI renewal template' },
    ],
  }
}

async function missingDocuments(ctx: SmartOpsContext): Promise<SmartOpsResponse> {
  const result = await executeTool(toolCtx(ctx), 'get_missing_vendor_documents', { limit: 25 })
  if (!result.ok) return refused('missing_vendor_documents', 'Incomplete subcontractor files', result.denied ?? 'That lookup is not available.')

  const data = (result.data ?? {}) as { count?: number; vendors?: Row[] }
  const vendors = data.vendors ?? []

  return {
    mode: 'smart_ops',
    intent: 'missing_vendor_documents',
    title: 'Subcontractors with incomplete files',
    summary: vendors.length === 0
      ? 'Every active subcontractor file is complete.'
      : `${vendors.length} subcontractor ${vendors.length === 1 ? 'file needs' : 'files need'} attention.`,
    facts: [{ label: 'Files needing attention', value: vendors.length, tone: vendors.length ? 'warn' : 'ok' }],
    items: vendors.map(v => ({
      id: str(v.vendorId),
      title: str(v.vendor),
      subtitle: Array.isArray(v.issues) ? (v.issues as string[]).join(' · ') : undefined,
      status: str(v.status).replace(/_/g, ' '),
      href: str(v.vendorId) ? ROUTES.subcontractor(str(v.vendorId)) : undefined,
    })),
    suggestedActions: [
      { label: 'Open the compliance register', href: ROUTES.compliance },
      { label: 'Draft a missing document request', command: 'Give me a missing document request template' },
    ],
  }
}

async function auditReadiness(ctx: SmartOpsContext): Promise<SmartOpsResponse> {
  const facts = await collectAuditFacts(ctx.supabase, null)
  const brief = buildSmartAuditBrief(facts)

  const notices = [brief.readinessStatement]
  if (brief.needsHumanReview.length) {
    notices.push(`${brief.needsHumanReview.length} ${brief.needsHumanReview.length === 1 ? 'file needs' : 'files need'} a human decision — the evaluator does not guess.`)
  }

  return {
    mode: 'smart_ops',
    intent: 'audit_readiness',
    title: 'Audit readiness',
    summary: brief.executiveSummary,
    facts: brief.facts,
    items: brief.items,
    notices,
    suggestedActions: [
      { label: 'Open the Audit Center', href: ROUTES.audits },
      { label: 'Who is missing paperwork?', command: 'Who is missing paperwork?' },
    ],
  }
}

async function leadsFollowUp(ctx: SmartOpsContext): Promise<SmartOpsResponse> {
  const result = await executeTool(toolCtx(ctx), 'get_leads_needing_follow_up', { limit: 25 })
  if (!result.ok) return refused('leads_follow_up', 'Leads needing follow-up', result.denied ?? 'That lookup is not available.')

  const leads = (result.data ?? []) as Row[]
  const nameOf = (l: Row) =>
    [str(l.first_name), str(l.last_name)].filter(Boolean).join(' ') || str(l.company_name) || 'Unnamed lead'

  return {
    mode: 'smart_ops',
    intent: 'leads_follow_up',
    title: 'Leads needing follow-up',
    summary: leads.length === 0
      ? 'No open leads are overdue a follow-up.'
      : `${leads.length} ${leads.length === 1 ? 'lead is' : 'leads are'} overdue a follow-up, oldest first.`,
    facts: [{ label: 'Awaiting follow-up', value: leads.length, tone: leads.length ? 'warn' : 'ok' }],
    items: leads.map(l => ({
      id: str(l.id),
      title: nameOf(l),
      subtitle: [str(l.phone), str(l.email)].filter(Boolean).join(' · ') || undefined,
      status: str(l.pipeline_stage).replace(/_/g, ' '),
      href: str(l.id) ? ROUTES.lead(str(l.id)) : undefined,
    })),
    suggestedActions: [
      { label: 'Open leads', href: ROUTES.leads },
      { label: 'Draft a follow-up message', command: 'Give me a lead follow-up template' },
    ],
  }
}

async function activeJobs(ctx: SmartOpsContext, windowDays?: number): Promise<SmartOpsResponse> {
  const days = windowDays ?? 7
  const [scheduleResult, projectsResult] = await Promise.all([
    executeTool(toolCtx(ctx), 'get_schedule_summary', { windowDays: days, limit: 15 }),
    executeTool(toolCtx(ctx), 'search_projects', { activeOnly: true, limit: 25 }),
  ])
  if (!projectsResult.ok) return refused('active_jobs', 'Active jobs', projectsResult.denied ?? 'That lookup is not available.')

  const schedule = (scheduleResult.data ?? {}) as { starting?: Row[]; finishing?: Row[] }
  const projects = (projectsResult.data ?? []) as Row[]
  const starting = schedule.starting ?? []
  const finishing = schedule.finishing ?? []

  return {
    mode: 'smart_ops',
    intent: 'active_jobs',
    title: `Jobs — next ${days} days`,
    summary: projects.length === 0
      ? 'There are no active jobs right now.'
      : `${projects.length} active ${projects.length === 1 ? 'job' : 'jobs'}; ${starting.length} starting and ${finishing.length} finishing in the next ${days} days.`,
    facts: [
      { label: 'Active jobs', value: projects.length },
      { label: `Starting within ${days}d`, value: starting.length },
      { label: `Finishing within ${days}d`, value: finishing.length },
    ],
    items: projects.map(p => ({
      id: str(p.id),
      title: `${str(p.project_number) ? `${str(p.project_number)} · ` : ''}${str(p.project_name)}`,
      subtitle: [str(p.city), str(p.service_category)].filter(Boolean).join(' · ') || undefined,
      status: str(p.status).replace(/_/g, ' '),
      href: str(p.id) ? ROUTES.project(str(p.id)) : undefined,
    })),
    suggestedActions: [
      { label: 'Open the schedule', href: ROUTES.schedule },
      { label: 'Open jobs', href: ROUTES.projects },
    ],
  }
}

async function openEstimates(ctx: SmartOpsContext): Promise<SmartOpsResponse> {
  const result = await executeTool(toolCtx(ctx), 'get_open_estimates', { limit: 25 })
  if (!result.ok) return refused('open_estimates', 'Open estimates', result.denied ?? 'That lookup is not available.')

  const estimates = (result.data ?? []) as Row[]
  return {
    mode: 'smart_ops',
    intent: 'open_estimates',
    title: 'Open estimates',
    summary: estimates.length === 0
      ? 'There are no estimates waiting.'
      : `${estimates.length} ${estimates.length === 1 ? 'estimate is' : 'estimates are'} still open.`,
    facts: [{ label: 'Open estimates', value: estimates.length }],
    items: estimates.map(e => ({
      id: str(e.id),
      title: `${str(e.estimate_number) ? `${str(e.estimate_number)} · ` : ''}${str(e.title) || 'Untitled estimate'}`,
      subtitle: num(e.total_cents) ? money(num(e.total_cents)) : undefined,
      status: str(e.status).replace(/_/g, ' '),
      href: str(e.id) ? ROUTES.estimate(str(e.id)) : undefined,
    })),
    suggestedActions: [{ label: 'Open estimates', href: ROUTES.estimates }],
  }
}

async function unpaidInvoices(ctx: SmartOpsContext): Promise<SmartOpsResponse> {
  const result = await executeTool(toolCtx(ctx), 'get_unpaid_invoices', { limit: 25 })
  if (!result.ok) {
    return refused('unpaid_invoices', 'Unpaid invoices',
      result.denied ?? 'Receivables are not available to your account.')
  }

  const data = (result.data ?? {}) as { count?: number; totalOutstandingCents?: number; overdueCount?: number; invoices?: Row[] }
  const invoices = data.invoices ?? []

  return {
    mode: 'smart_ops',
    intent: 'unpaid_invoices',
    title: 'Unpaid invoices',
    summary: invoices.length === 0
      ? 'Every issued invoice is settled.'
      : `${invoices.length} unpaid ${invoices.length === 1 ? 'invoice' : 'invoices'} totalling ${money(num(data.totalOutstandingCents))}${data.overdueCount ? `, of which ${data.overdueCount} ${data.overdueCount === 1 ? 'is' : 'are'} overdue` : ''}.`,
    facts: [
      { label: 'Outstanding', value: money(num(data.totalOutstandingCents)) },
      { label: 'Invoices', value: invoices.length },
      { label: 'Overdue', value: num(data.overdueCount), tone: num(data.overdueCount) ? 'bad' : 'ok' },
    ],
    items: invoices.map(i => ({
      id: str(i.id),
      title: str(i.invoice_number) || 'Invoice',
      subtitle: `${money(num(i.balance_due_cents))} outstanding${str(i.due_date) ? ` · due ${str(i.due_date)}` : ''}`,
      status: str(i.status),
      href: str(i.id) ? ROUTES.invoice(str(i.id)) : undefined,
    })),
    suggestedActions: [{ label: 'Open invoices', href: ROUTES.invoices }],
  }
}

/**
 * Resolves a free-text job reference to exactly one project, or explains why it
 * could not. Ambiguity is surfaced rather than resolved by picking the first
 * row — the wrong job's costs is a worse answer than no answer.
 */
async function resolveProject(
  ctx: SmartOpsContext,
  query: string | undefined,
): Promise<{ id: string; label: string } | { candidates: SmartItem[] } | null> {
  if (!query) return null
  const result = await executeTool(toolCtx(ctx), 'search_projects', { query, activeOnly: false, limit: 6 })
  if (!result.ok) return null
  const rows = (result.data ?? []) as Row[]
  if (rows.length === 0) return null
  if (rows.length === 1) {
    return { id: str(rows[0].id), label: `${str(rows[0].project_number) ? `${str(rows[0].project_number)} · ` : ''}${str(rows[0].project_name)}` }
  }
  return {
    candidates: rows.map(p => ({
      id: str(p.id),
      title: `${str(p.project_number) ? `${str(p.project_number)} · ` : ''}${str(p.project_name)}`,
      subtitle: str(p.city) || undefined,
      status: str(p.status).replace(/_/g, ' '),
      href: str(p.id) ? ROUTES.project(str(p.id)) : undefined,
    })),
  }
}

async function jobFinancials(
  ctx: SmartOpsContext,
  intent: 'job_cost' | 'job_profit',
  projectQuery?: string,
): Promise<SmartOpsResponse> {
  const gate = intent === 'job_cost'
    ? canViewCosts(ctx.role, ctx.settings)
    : canViewProfit(ctx.role, ctx.settings)

  // Checked before anything is looked up, so an auditor's question never
  // becomes a query against job_costs at all.
  if (!gate) {
    return refused(intent,
      intent === 'job_cost' ? 'Job costs' : 'Job profitability',
      'Financial information is not available to your account.')
  }

  const resolved = await resolveProject(ctx, projectQuery)
  if (!resolved) {
    return {
      mode: 'smart_ops', intent,
      title: intent === 'job_cost' ? 'Job costs' : 'Job profitability',
      summary: projectQuery
        ? `I could not find a job matching "${projectQuery}".`
        : 'Tell me which job — for example "job cost for the Miller residence".',
      notices: ['Built-in commands match a job by name or number. Open the job and use its financials panel if the name is hard to type.'],
      suggestedActions: [{ label: 'Open jobs', href: ROUTES.projects }],
    }
  }
  if ('candidates' in resolved) {
    return {
      mode: 'smart_ops', intent,
      title: 'Which job?',
      summary: `"${projectQuery}" matches ${resolved.candidates.length} jobs. Open the one you meant.`,
      items: resolved.candidates,
    }
  }

  if (intent === 'job_cost') {
    const result = await executeTool(toolCtx(ctx), 'get_job_cost_summary', { projectId: resolved.id })
    if (!result.ok) return refused(intent, 'Job costs', result.denied ?? 'That lookup is not available.')
    const data = (result.data ?? {}) as { totalCostCents?: number; byCategory?: Record<string, number>; entries?: number }
    const byCategory = data.byCategory ?? {}
    return {
      mode: 'smart_ops', intent,
      title: `Job costs — ${resolved.label}`,
      summary: num(data.entries) === 0
        ? 'No costs have been recorded against this job yet.'
        : `${money(num(data.totalCostCents))} recorded across ${num(data.entries)} ${num(data.entries) === 1 ? 'entry' : 'entries'}.`,
      facts: [
        { label: 'Total cost', value: money(num(data.totalCostCents)) },
        { label: 'Entries', value: num(data.entries) },
      ],
      items: Object.entries(byCategory).map(([category, cents]) => ({
        title: category.replace(/_/g, ' '),
        subtitle: money(num(cents)),
      })),
      suggestedActions: [{ label: 'Open the job', href: ROUTES.project(resolved.id) }],
    }
  }

  const result = await executeTool(toolCtx(ctx), 'get_profit_summary', { projectId: resolved.id })
  if (!result.ok) return refused(intent, 'Job profitability', result.denied ?? 'That lookup is not available.')
  const data = (result.data ?? {}) as {
    contractAmountCents?: number | null; totalCostCents?: number
    grossProfitCents?: number | null; grossMarginPercent?: number | null; note?: string
  }

  const hasContract = typeof data.contractAmountCents === 'number' && data.contractAmountCents > 0
  return {
    mode: 'smart_ops', intent,
    title: `Profitability — ${resolved.label}`,
    summary: hasContract
      ? `${money(num(data.grossProfitCents))} gross profit at ${data.grossMarginPercent}% margin.`
      : 'No contract amount is set on this job, so margin cannot be calculated.',
    facts: [
      { label: 'Contract', value: hasContract ? money(num(data.contractAmountCents)) : '—' },
      { label: 'Costs', value: money(num(data.totalCostCents)) },
      { label: 'Gross profit', value: hasContract ? money(num(data.grossProfitCents)) : '—',
        tone: hasContract && num(data.grossProfitCents) < 0 ? 'bad' : 'neutral' },
      { label: 'Gross margin', value: hasContract ? `${data.grossMarginPercent}%` : '—' },
    ],
    notices: data.note ? [data.note] : undefined,
    suggestedActions: [{ label: 'Open the job', href: ROUTES.project(resolved.id) }],
  }
}

function calculation(match: SmartOpsMatch): SmartOpsResponse {
  const request = match.args.calculation
  if (!request) {
    return { mode: 'smart_ops', intent: 'calculation', title: 'Calculation', summary: 'I could not read that calculation.' }
  }
  const result = calculate(request)
  if (!result.ok) {
    return {
      mode: 'smart_ops', intent: 'calculation',
      title: 'Calculation', summary: result.error ?? 'That calculation could not be completed.',
      facts: [{ label: 'Asked', value: result.expression }],
    }
  }
  return {
    mode: 'smart_ops',
    intent: 'calculation',
    title: result.expression,
    summary: result.value,
    facts: [
      { label: 'Formula', value: result.formula },
      ...(result.detail ?? []).map(d => ({ label: d.label, value: d.value })),
    ],
    notices: ['This is a standalone calculation. It is not attached to any job, estimate or invoice.'],
  }
}

function template(ctx: SmartOpsContext, key: string): SmartOpsResponse {
  if (!isTemplateKey(key)) {
    return helpResponse(ctx, 'I do not have that template. Here is what I can do.')
  }
  const rendered = renderTemplate(key, { senderName: ctx.userName })
  return {
    mode: 'smart_ops',
    intent: 'template',
    title: TEMPLATE_LABELS[key],
    summary: rendered.subject,
    copyText: rendered.body,
    notices: [
      'Nothing has been sent. Copy this, edit it, and send it from your own email or phone.',
      ...(rendered.placeholders.length
        ? [`Fill in before sending: ${rendered.placeholders.join(', ')}.`]
        : []),
    ],
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface SmartOpsOutcome {
  /** Null when nothing matched — the caller decides what to do about that. */
  response: SmartOpsResponse | null
  match: SmartOpsMatch | null
}

/**
 * Parse and, if the parse succeeded, execute.
 *
 * A null response means "I did not recognise that", never "there is no answer".
 * The distinction matters: the caller routes a null to the generative Copilot
 * when AI Enhanced is activated, and to the built-in help when it is not.
 */
export async function runSmartOps(ctx: SmartOpsContext, message: string): Promise<SmartOpsOutcome> {
  const match = parseIntent(message)
  if (!match) return { response: null, match: null }

  try {
    const response = await execute(ctx, match)
    return { response, match }
  } catch (error) {
    console.error('[smart-ops] intent failed', match.intent, error instanceof Error ? error.message : 'unknown')
    return {
      match,
      response: {
        mode: 'smart_ops',
        intent: match.intent,
        title: 'That lookup failed',
        summary: 'Something went wrong reading your data. Nothing has been changed.',
      },
    }
  }
}

async function execute(ctx: SmartOpsContext, match: SmartOpsMatch): Promise<SmartOpsResponse> {
  switch (match.intent) {
    case 'attention_summary': return attentionSummary(ctx)
    case 'expiring_policies': return expiringPolicies(ctx, match.args.windowDays)
    case 'missing_vendor_documents': return missingDocuments(ctx)
    case 'audit_readiness': return auditReadiness(ctx)
    case 'leads_follow_up': return leadsFollowUp(ctx)
    case 'active_jobs': return activeJobs(ctx, match.args.windowDays)
    case 'open_estimates': return openEstimates(ctx)
    case 'unpaid_invoices': return unpaidInvoices(ctx)
    case 'job_cost':
    case 'job_profit': return jobFinancials(ctx, match.intent, match.args.projectQuery)
    case 'calculation': return calculation(match)
    case 'template': return template(ctx, match.args.templateKey ?? '')
    case 'help': return helpResponse(ctx)
  }
}

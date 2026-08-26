import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canViewCosts, canViewProfit, can } from '../auth/permissions'
import type { UserRole } from '../types'
import { ACTIVE_PROJECT_STATUSES, OPEN_LEAD_STAGES } from '../types'
import { findExpiringPolicies } from '../services/certificates'
import { buildComplianceRegister, loadVendorComplianceContext, evaluateVendorContext } from '../services/compliance'
import { AI_LIMITS, clampInt, clampText, clampWindowDays } from './guardrails'

/**
 * ============================================================================
 * ALLOWLISTED READ TOOLS — the Copilot's only route to data
 * ----------------------------------------------------------------------------
 * Three properties make this the security boundary rather than the prompt:
 *
 *  1. The `supabase` handed in is ALWAYS the user-scoped client. This module
 *     never imports `createSupabaseAdminClient`, so RLS applies to every query
 *     here and the Copilot cannot see a row the signed-in user could not fetch
 *     for themselves. A test asserts the absence of that import.
 *
 *  2. The model selects a tool by name from a fixed enum with typed arguments.
 *     There is no SQL, no table name, no column list, no URL and no storage
 *     path anywhere in the model's output surface. An invented tool name is
 *     rejected before execution.
 *
 *  3. Financial tools check `canViewCosts` / `canViewProfit` before running.
 *     That is redundant with RLS — which already returns zero rows for an
 *     auditor — and the redundancy is deliberate: it produces a clear
 *     "not available to your account" message instead of a confusing empty
 *     result, and it holds even if a future migration loosens a policy.
 *
 * No tool in this file writes. There is no mutation path from the model.
 * ============================================================================
 */

export interface ToolContext {
  supabase: SupabaseClient
  userId: string
  role: UserRole
  settings: { costs_visible_to_pm: boolean; profit_visible_to_pm: boolean }
}

export interface ToolResult {
  ok: boolean
  /** Shown to the user when a tool is refused, so the refusal is explicable. */
  denied?: string
  data?: unknown
}

type ToolArgs = Record<string, string | number | boolean | null>
type ToolHandler = (ctx: ToolContext, args: ToolArgs) => Promise<ToolResult>

interface ToolDefinition {
  name: string
  description: string
  args: string
  /** Financial tools declare which gate they need. */
  requires?: 'costs' | 'profit' | 'invoices'
  handler: ToolHandler
}

const ok = (data: unknown): ToolResult => ({ ok: true, data })
const denied = (message: string): ToolResult => ({ ok: false, denied: message })

const rows = (n?: unknown) => clampInt(n, 1, AI_LIMITS.maxRowsPerTool, 10)
const term = (v: unknown) => clampText(v, 80)

/** PostgREST `or()` filters are a mini-language; strip its metacharacters. */
const safeLike = (v: unknown) => term(v).replace(/[,()*%\\]/g, '')

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const TOOL_LIST: ToolDefinition[] = [
  {
    name: 'get_dashboard_summary',
    description: 'Counts of open leads, active jobs, expiring coverage lines, vendors needing attention.',
    args: '{}',
    handler: async ({ supabase }) => {
      const [leads, projects, vendors, expiring] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .in('pipeline_stage', OPEN_LEAD_STAGES).is('archived_at', null),
        supabase.from('projects').select('id', { count: 'exact', head: true })
          .in('status', ACTIVE_PROJECT_STATUSES).is('archived_at', null),
        supabase.from('vendors').select('id', { count: 'exact', head: true })
          .is('archived_at', null).neq('status', 'blocked'),
        findExpiringPolicies(supabase, 30, { includeExpired: true }),
      ])
      return ok({
        openLeads: leads.count ?? 0,
        activeProjects: projects.count ?? 0,
        activeVendors: vendors.count ?? 0,
        coverageLinesExpiringOrExpired30d: expiring.length,
      })
    },
  },

  {
    name: 'search_leads',
    description: 'Find leads. args: { query?, stage?, limit? }',
    args: '{ query?: string, stage?: string, limit?: number }',
    handler: async ({ supabase }, args) => {
      let q = supabase.from('leads')
        .select('id, first_name, last_name, company_name, email, phone, service_type, city, pipeline_stage, created_at, next_follow_up_at')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(rows(args.limit))
      const search = safeLike(args.query)
      if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,company_name.ilike.%${search}%,email.ilike.%${search}%`)
      if (typeof args.stage === 'string' && args.stage) q = q.eq('pipeline_stage', term(args.stage))
      const { data } = await q
      return ok(data ?? [])
    },
  },

  {
    name: 'get_leads_needing_follow_up',
    description: 'Open leads whose follow-up date has passed or that have never been contacted.',
    args: '{ limit?: number }',
    handler: async ({ supabase }, args) => {
      const today = new Date().toISOString()
      const { data } = await supabase.from('leads')
        .select('id, first_name, last_name, company_name, phone, email, pipeline_stage, created_at, last_contacted_at, next_follow_up_at')
        .is('archived_at', null)
        .in('pipeline_stage', OPEN_LEAD_STAGES)
        .or(`next_follow_up_at.lte.${today},last_contacted_at.is.null`)
        .order('created_at', { ascending: true })
        .limit(rows(args.limit))
      return ok(data ?? [])
    },
  },

  {
    name: 'search_clients',
    description: 'Find customer/contact records. args: { query?, limit? }',
    args: '{ query?: string, limit?: number }',
    handler: async ({ supabase }, args) => {
      let q = supabase.from('contacts')
        .select('id, first_name, last_name, company_name, email, phone, city, state, contact_type')
        .is('archived_at', null).order('last_name').limit(rows(args.limit))
      const search = safeLike(args.query)
      if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,company_name.ilike.%${search}%,email.ilike.%${search}%`)
      const { data } = await q
      return ok(data ?? [])
    },
  },

  {
    name: 'search_projects',
    description: 'Find jobs/projects. args: { query?, status?, activeOnly?, limit? }',
    args: '{ query?: string, status?: string, activeOnly?: boolean, limit?: number }',
    handler: async ({ supabase }, args) => {
      let q = supabase.from('projects')
        .select('id, project_number, project_name, status, city, service_category, scheduled_start_date, scheduled_end_date, start_date, estimated_completion_date')
        .is('archived_at', null).order('created_at', { ascending: false }).limit(rows(args.limit))
      const search = safeLike(args.query)
      if (search) q = q.or(`project_name.ilike.%${search}%,project_number.ilike.%${search}%`)
      if (typeof args.status === 'string' && args.status) q = q.eq('status', term(args.status))
      else if (args.activeOnly !== false) q = q.in('status', ACTIVE_PROJECT_STATUSES)
      const { data } = await q
      return ok(data ?? [])
    },
  },

  {
    name: 'get_schedule_summary',
    description: 'Jobs starting or finishing within a window. args: { windowDays?, limit? }',
    args: '{ windowDays?: number, limit?: number }',
    handler: async ({ supabase }, args) => {
      const days = clampWindowDays(args.windowDays, 7)
      const from = new Date().toISOString().slice(0, 10)
      const to = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
      const [starting, finishing] = await Promise.all([
        supabase.from('projects').select('id, project_number, project_name, scheduled_start_date')
          .gte('scheduled_start_date', from).lte('scheduled_start_date', to)
          .order('scheduled_start_date').limit(rows(args.limit)),
        supabase.from('projects').select('id, project_number, project_name, scheduled_end_date')
          .gte('scheduled_end_date', from).lte('scheduled_end_date', to)
          .order('scheduled_end_date').limit(rows(args.limit)),
      ])
      return ok({ windowDays: days, starting: starting.data ?? [], finishing: finishing.data ?? [] })
    },
  },

  {
    name: 'search_subcontractors',
    description: 'Find subcontractors/vendors. args: { query?, complianceStatus?, limit? }',
    args: '{ query?: string, complianceStatus?: string, limit?: number }',
    handler: async ({ supabase }, args) => {
      let q = supabase.from('vendors')
        .select('id, legal_name, primary_trade, status, compliance_status, earliest_expiration_date, email, phone, w9_status, license_expiration_date')
        .is('archived_at', null).order('legal_name').limit(rows(args.limit))
      const search = safeLike(args.query)
      if (search) q = q.ilike('legal_name', `%${search}%`)
      if (typeof args.complianceStatus === 'string' && args.complianceStatus) {
        q = q.eq('compliance_status', term(args.complianceStatus))
      }
      const { data } = await q
      return ok(data ?? [])
    },
  },

  {
    name: 'get_subcontractor_compliance',
    description: 'Deterministic compliance evaluation for one vendor. args: { vendorId }',
    args: '{ vendorId: string }',
    handler: async ({ supabase }, args) => {
      const vendorId = typeof args.vendorId === 'string' ? args.vendorId : ''
      if (!/^[0-9a-f-]{36}$/i.test(vendorId)) return denied('A valid subcontractor id is required.')
      const ctx = await loadVendorComplianceContext(supabase, vendorId)
      if (!ctx) return denied('That subcontractor could not be found, or you do not have access to it.')
      // The evaluator is the only source of a compliance verdict. The model
      // receives its output and may explain it; it never recomputes it.
      const evaluation = evaluateVendorContext(ctx, {})
      return ok({
        vendor: { id: ctx.vendor.id, name: ctx.vendor.legal_name, trade: ctx.vendor.primary_trade },
        status: evaluation.status,
        earliestExpiration: evaluation.earliestExpiration,
        checks: evaluation.checks.map(c => ({
          coverage: c.coverageType,
          status: c.status,
          reasons: c.reasons.slice(0, 4),
          expirationDate: c.expirationDate ?? null,
          daysToExpiration: c.daysToExpiration ?? null,
        })),
      })
    },
  },

  {
    name: 'get_expiring_policies',
    description: 'Coverage lines expiring within a window. args: { windowDays?, includeExpired?, limit? }',
    args: '{ windowDays?: number, includeExpired?: boolean, limit?: number }',
    handler: async ({ supabase }, args) => {
      const days = clampWindowDays(args.windowDays, 45)
      const list = await findExpiringPolicies(supabase, days, { includeExpired: args.includeExpired !== false })
      return ok({
        windowDays: days,
        count: list.length,
        policies: list.slice(0, rows(args.limit)).map(p => ({
          vendorId: p.vendor_id, vendor: p.vendor_name, coverage: p.coverage_type,
          carrier: p.carrier, expirationDate: p.expiration_date, daysOut: p.days_out,
        })),
      })
    },
  },

  {
    name: 'get_missing_vendor_documents',
    description: 'Active vendors whose documentation is incomplete. args: { limit? }',
    args: '{ limit?: number }',
    handler: async ({ supabase }, args) => {
      const register = await buildComplianceRegister(supabase, {})
      const problems = register
        .filter(r => ['missing', 'non_compliant', 'needs_review', 'expiring_soon'].includes(r.evaluation.status))
        .slice(0, rows(args.limit))
        .map(r => ({
          vendorId: r.vendor.id,
          vendor: r.vendor.legal_name,
          status: r.evaluation.status,
          issues: r.evaluation.checks
            .filter(c => c.status !== 'pass')
            .slice(0, 4)
            .map(c => `${c.coverageLabel}: ${c.reasons[0] ?? c.status}`),
        }))
      return ok({ count: problems.length, vendors: problems })
    },
  },

  {
    name: 'get_audit_readiness',
    description: 'Deterministic audit-readiness counts across active subcontractors.',
    args: '{}',
    handler: async ({ supabase }) => {
      const register = await buildComplianceRegister(supabase, {})
      const byStatus: Record<string, number> = {}
      for (const row of register) {
        byStatus[row.evaluation.status] = (byStatus[row.evaluation.status] ?? 0) + 1
      }
      const expiring = await findExpiringPolicies(supabase, 60, { includeExpired: true })
      return ok({
        vendorsEvaluated: register.length,
        byStatus,
        blocking: register.filter(r => ['missing', 'non_compliant'].includes(r.evaluation.status)).length,
        needsReview: register.filter(r => r.evaluation.status === 'needs_review').length,
        coverageExpiringOrExpired60d: expiring.length,
      })
    },
  },

  {
    name: 'get_open_estimates',
    description: 'Estimates not yet approved or declined. args: { limit? }',
    args: '{ limit?: number }',
    handler: async ({ supabase }, args) => {
      const { data } = await supabase.from('estimates')
        .select('id, estimate_number, title, status, total_cents, valid_until, created_at')
        .in('status', ['draft', 'ai_draft', 'measuring', 'ready_for_review', 'sent', 'viewed'])
        .is('archived_at', null)
        .order('created_at', { ascending: false }).limit(rows(args.limit))
      return ok(data ?? [])
    },
  },

  {
    name: 'get_tasks',
    description: 'Open tasks. args: { mineOnly?, limit? }',
    args: '{ mineOnly?: boolean, limit?: number }',
    handler: async ({ supabase, userId }, args) => {
      let q = supabase.from('tasks')
        .select('id, title, due_date, priority, status, related_entity_type, related_entity_id')
        .in('status', ['open', 'in_progress'])
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(rows(args.limit))
      if (args.mineOnly === true) q = q.eq('assigned_to', userId)
      const { data } = await q
      return ok(data ?? [])
    },
  },

  // -------------------------------------------------------------------------
  // Financial tools — gated
  // -------------------------------------------------------------------------

  {
    name: 'get_unpaid_invoices',
    description: 'Issued invoices with a balance. args: { limit? }',
    args: '{ limit?: number }',
    requires: 'invoices',
    handler: async ({ supabase }, args) => {
      const { data } = await supabase.from('invoices')
        .select('id, invoice_number, status, issue_date, due_date, total_cents, amount_paid_cents, balance_due_cents, project_id')
        .not('status', 'in', '(draft,void)').gt('balance_due_cents', 0)
        .order('due_date', { ascending: true }).limit(rows(args.limit))
      const list = data ?? []
      const today = new Date().toISOString().slice(0, 10)
      return ok({
        count: list.length,
        totalOutstandingCents: list.reduce((s, i) => s + (i.balance_due_cents as number), 0),
        overdueCount: list.filter(i => i.due_date && (i.due_date as string) < today).length,
        invoices: list,
      })
    },
  },

  {
    name: 'get_job_cost_summary',
    description: 'Job costs for one project. args: { projectId }',
    args: '{ projectId: string }',
    requires: 'costs',
    handler: async ({ supabase }, args) => {
      const projectId = typeof args.projectId === 'string' ? args.projectId : ''
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return denied('A valid job id is required.')
      const { data } = await supabase.from('job_costs')
        .select('category, description, amount_cents, cost_date')
        .eq('project_id', projectId).order('cost_date', { ascending: false })
        .limit(AI_LIMITS.maxRowsPerTool)
      const list = data ?? []
      const byCategory: Record<string, number> = {}
      for (const c of list) byCategory[c.category as string] = (byCategory[c.category as string] ?? 0) + (c.amount_cents as number)
      return ok({
        projectId,
        totalCostCents: list.reduce((s, c) => s + (c.amount_cents as number), 0),
        byCategory,
        entries: list.length,
      })
    },
  },

  {
    name: 'get_profit_summary',
    description: 'Contract vs cost for one project. args: { projectId }',
    args: '{ projectId: string }',
    requires: 'profit',
    handler: async ({ supabase }, args) => {
      const projectId = typeof args.projectId === 'string' ? args.projectId : ''
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return denied('A valid job id is required.')
      const [{ data: project }, { data: costs }] = await Promise.all([
        supabase.from('projects').select('project_number, project_name, contract_amount_cents').eq('id', projectId).maybeSingle(),
        supabase.from('job_costs').select('amount_cents').eq('project_id', projectId),
      ])
      if (!project) return denied('That job could not be found, or you do not have access to it.')
      const totalCostCents = (costs ?? []).reduce((s, c) => s + (c.amount_cents as number), 0)
      const contract = project.contract_amount_cents as number | null
      // Mirrors calculateProfitability: no contract amount means no margin, not 0%.
      return ok({
        project: project.project_name,
        contractAmountCents: contract,
        totalCostCents,
        grossProfitCents: contract ? contract - totalCostCents : null,
        grossMarginPercent: contract ? Math.round(((contract - totalCostCents) / contract) * 1000) / 10 : null,
        note: contract ? undefined : 'No contract amount is set on this job, so margin cannot be calculated.',
      })
    },
  },
]

const TOOLS = new Map(TOOL_LIST.map(t => [t.name, t]))

// ---------------------------------------------------------------------------
// Permission gate + executor
// ---------------------------------------------------------------------------

function isAllowed(tool: ToolDefinition, ctx: ToolContext): boolean {
  if (!tool.requires) return can(ctx.role, 'readRecords')
  if (tool.requires === 'costs') return canViewCosts(ctx.role, ctx.settings)
  if (tool.requires === 'profit') return canViewProfit(ctx.role, ctx.settings)

  // Receivables through the assistant are closed to the auditor.
  //
  // `read_only` holds `invoicesView`, so it can open /ops/invoices in the UI —
  // that is existing Phase 1 behaviour and this change order does not alter it.
  // But the Phase 3 permission matrix is explicit that the auditor must not
  // "get financial data indirectly through the Copilot", and outstanding
  // receivables are company financial data. Where the two readings conflict,
  // the assistant takes the narrower one.
  //
  // Worth flagging to the client: an auditor can still read the invoices page
  // directly. If that is also unwanted, `invoicesView` needs to change, which
  // is a product decision rather than an AI one.
  if (ctx.role === 'read_only') return false
  return can(ctx.role, 'invoicesView')
}

/** The tools this user may actually call — the list the model is shown. */
export function availableTools(ctx: ToolContext): { name: string; description: string; args: string }[] {
  return TOOL_LIST.filter(t => isAllowed(t, ctx))
    .map(t => ({ name: t.name, description: t.description, args: t.args }))
}

export function toolNames(): string[] {
  return TOOL_LIST.map(t => t.name)
}

/**
 * Execute one tool call.
 *
 * An unknown name is refused rather than guessed at — no fuzzy matching, no
 * fallback tool. A tool the user may not call is refused with a message that
 * says so plainly, which is more useful than an empty result and, importantly,
 * is the same answer whether or not the row exists.
 */
export async function executeTool(ctx: ToolContext, name: string, args: ToolArgs): Promise<ToolResult> {
  const tool = TOOLS.get(name)
  if (!tool) return denied(`There is no tool called "${clampText(name, 60)}".`)

  if (!isAllowed(tool, ctx)) {
    if (tool.requires === 'costs' || tool.requires === 'profit') {
      return denied('Financial information is not available to your account.')
    }
    return denied('Your account does not have access to that information.')
  }

  try {
    return await tool.handler(ctx, args ?? {})
  } catch (error) {
    console.error('[ops-ai] tool failed', name, error instanceof Error ? error.message : 'unknown')
    return denied('That lookup failed. Nothing has been changed.')
  }
}

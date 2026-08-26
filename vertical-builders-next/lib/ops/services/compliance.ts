import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  evaluateCompliance,
  resolveRequirements,
  type ComplianceResult,
} from '../compliance/evaluator'
import type {
  ComplianceStatus,
  ComplianceWaiver,
  InsuranceCertificate,
  InsurancePolicy,
  RequirementTemplate,
  Vendor,
} from '../types'
import { getSettings } from './settings'

/**
 * The bridge between the database and the pure evaluator.
 *
 * Everything the evaluator needs is fetched here, then handed over as plain
 * data. That separation is what makes the compliance rules unit-testable and
 * what makes an audit reproducible: the same inputs always give the same answer.
 */

/** Certificates whose policy lines count as "current paperwork". */
const LIVE_REVIEW_STATUSES = ['approved', 'needs_review']

export interface VendorComplianceContext {
  vendor: Vendor
  certificates: InsuranceCertificate[]
  policies: InsurancePolicy[]
  reviewStatusByPolicy: Record<string, string>
  waivers: ComplianceWaiver[]
  templates: RequirementTemplate[]
  warningDays: number
}

export async function loadVendorComplianceContext(
  supabase: SupabaseClient,
  vendorId: string,
  opts: { includeHistorical?: boolean } = {},
): Promise<VendorComplianceContext | null> {
  const [{ data: vendor }, settings] = await Promise.all([
    supabase.from('vendors').select('*').eq('id', vendorId).maybeSingle(),
    getSettings(supabase),
  ])
  if (!vendor) return null

  const { data: certificates } = await supabase
    .from('insurance_certificates')
    .select('*, insurance_policies(*)')
    .eq('vendor_id', vendorId)
    .order('received_at', { ascending: false })

  const certs = (certificates ?? []) as InsuranceCertificate[]

  const usable = opts.includeHistorical
    ? certs
    : certs.filter(c => LIVE_REVIEW_STATUSES.includes(c.review_status))

  const policies: InsurancePolicy[] = []
  const reviewStatusByPolicy: Record<string, string> = {}
  for (const cert of usable) {
    for (const policy of cert.insurance_policies ?? []) {
      policies.push(policy)
      reviewStatusByPolicy[policy.id] = cert.review_status
    }
  }

  const [{ data: waivers }, { data: templates }] = await Promise.all([
    supabase.from('compliance_waivers').select('*').eq('vendor_id', vendorId).is('revoked_at', null),
    supabase
      .from('insurance_requirement_templates')
      .select('*, insurance_requirements(*)')
      .eq('active', true),
  ])

  return {
    vendor: vendor as Vendor,
    certificates: certs,
    policies,
    reviewStatusByPolicy,
    waivers: (waivers ?? []) as ComplianceWaiver[],
    templates: (templates ?? []) as RequirementTemplate[],
    warningDays: settings.warning_window_days,
  }
}

export interface VendorEvaluation extends ComplianceResult {
  vendorId: string
  projectId: string | null
  requirementSources: Record<string, string>
  requirementCount: number
}

/**
 * Evaluate one vendor, optionally in the context of one project (which can
 * carry its own requirement override).
 */
export function evaluateVendorContext(
  ctx: VendorComplianceContext,
  opts: { projectId?: string | null; asOfDate?: Date } = {},
): VendorEvaluation {
  const { requirements, sources } = resolveRequirements(ctx.templates, {
    trade: ctx.vendor.primary_trade,
    projectId: opts.projectId ?? null,
    vendorTemplateId: ctx.vendor.default_requirement_template_id,
  })

  const waivers = opts.projectId
    ? ctx.waivers.filter(w => !w.project_id || w.project_id === opts.projectId)
    : ctx.waivers.filter(w => !w.project_id)

  const result = evaluateCompliance({
    requirements,
    policies: ctx.policies,
    certificateReviewStatusByPolicy: ctx.reviewStatusByPolicy,
    waivers,
    asOfDate: opts.asOfDate ?? new Date(),
    warningDays: ctx.warningDays,
  })

  return {
    ...result,
    vendorId: ctx.vendor.id,
    projectId: opts.projectId ?? null,
    requirementSources: sources,
    requirementCount: requirements.filter(r => r.required).length,
  }
}

export async function evaluateVendor(
  supabase: SupabaseClient,
  vendorId: string,
  opts: { projectId?: string | null; asOfDate?: Date } = {},
): Promise<VendorEvaluation | null> {
  const ctx = await loadVendorComplianceContext(supabase, vendorId)
  if (!ctx) return null
  return evaluateVendorContext(ctx, opts)
}

/**
 * Recompute and cache a vendor's headline status.
 *
 * The cached columns exist purely so list views can filter and sort in the
 * database. Detail screens always re-run the evaluator, so a stale cache can
 * never cause a wrong answer on a screen someone is actually reading.
 */
export async function refreshVendorCompliance(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<VendorEvaluation | null> {
  const evaluation = await evaluateVendor(supabase, vendorId)
  if (!evaluation) return null

  await supabase
    .from('vendors')
    .update({
      compliance_status: evaluation.status,
      compliance_checked_at: new Date().toISOString(),
      earliest_expiration_date: evaluation.earliestExpiration,
    })
    .eq('id', vendorId)

  return evaluation
}

/** Recompute every non-archived vendor. Used by the cron job and Settings. */
export async function refreshAllVendors(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from('vendors').select('id').is('archived_at', null)
  let count = 0
  for (const row of data ?? []) {
    await refreshVendorCompliance(supabase, row.id as string)
    count += 1
  }
  return count
}

// ---------------------------------------------------------------------------
// Compliance register (the /ops/compliance table)
// ---------------------------------------------------------------------------

export interface ComplianceRow {
  vendor: Vendor
  evaluation: VendorEvaluation
  projects: { id: string; project_number: string; project_name: string; status: string }[]
}

export async function buildComplianceRegister(
  supabase: SupabaseClient,
  opts: { vendorIds?: string[]; asOfDate?: Date } = {},
): Promise<ComplianceRow[]> {
  let query = supabase.from('vendors').select('id').is('archived_at', null).order('legal_name')
  if (opts.vendorIds?.length) query = query.in('id', opts.vendorIds)
  const { data: vendorIds } = await query

  const rows: ComplianceRow[] = []
  for (const { id } of vendorIds ?? []) {
    const ctx = await loadVendorComplianceContext(supabase, id as string)
    if (!ctx) continue
    const evaluation = evaluateVendorContext(ctx, { asOfDate: opts.asOfDate })

    const { data: assignments } = await supabase
      .from('project_vendors')
      .select('projects(id, project_number, project_name, status)')
      .eq('vendor_id', id)
      .eq('active', true)

    rows.push({
      vendor: ctx.vendor,
      evaluation,
      projects: (assignments ?? []).flatMap(a => {
        // PostgREST returns the embedded row as an object or an array
        // depending on the relationship shape; normalise both.
        const embedded = (a as unknown as { projects: unknown }).projects
        const list = Array.isArray(embedded) ? embedded : embedded ? [embedded] : []
        return list as ComplianceRow['projects']
      }),
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Documentation Readiness (dashboard KPI)
// ---------------------------------------------------------------------------

export interface ReadinessScore {
  readyVendors: number
  totalVendors: number
  percentage: number
  byStatus: Record<ComplianceStatus, number>
}

/**
 * "Documentation Readiness" — the share of vendors attached to live projects
 * whose required paperwork is present, current and reviewed.
 *
 * This is a paperwork completeness measure, NOT a legal or insurance opinion,
 * and it is always labelled that way in the UI.
 */
export function calculateReadiness(rows: ComplianceRow[]): ReadinessScore {
  const byStatus = {
    compliant: 0, expiring_soon: 0, needs_review: 0,
    missing: 0, non_compliant: 0, waived: 0,
  } as Record<ComplianceStatus, number>

  for (const row of rows) byStatus[row.evaluation.status] += 1

  const total = rows.length
  const ready = byStatus.compliant + byStatus.expiring_soon + byStatus.waived
  return {
    readyVendors: ready,
    totalVendors: total,
    percentage: total === 0 ? 100 : Math.round((ready / total) * 100),
    byStatus,
  }
}

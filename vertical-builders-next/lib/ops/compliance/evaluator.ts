/**
 * ============================================================================
 * COMPLIANCE EVALUATOR  —  the heart of Vertical Ops
 * ----------------------------------------------------------------------------
 * A pure, deterministic function. No database, no clock, no I/O: every input is
 * passed in, which is what makes it unit-testable and makes an audit result
 * reproducible months later.
 *
 * It answers one question for one vendor (optionally in the context of one
 * project): given these requirements, these policy lines, these certificate
 * review states and these waivers, as of this date — is this subcontractor
 * documented and current?
 *
 * It deliberately does NOT decide anything legal. See COMPLIANCE_DISCLAIMER.
 * ============================================================================
 */

import {
  COMPLIANCE_SEVERITY,
  COVERAGE_LABELS,
  type ComplianceStatus,
  type ComplianceWaiver,
  type CoverageType,
  type InsurancePolicy,
  type InsuranceRequirement,
  type RequirementTemplate,
} from '../types'
import { daysBetween, toUtcDate } from '../utils/dates'

export type CheckStatus = 'pass' | 'warning' | 'fail' | 'missing' | 'waived'

export interface ComplianceCheck {
  requirementId: string
  coverageType: CoverageType
  coverageLabel: string
  status: CheckStatus
  /** Human-readable explanations. Always populated for anything but a clean pass. */
  reasons: string[]
  policyId?: string
  carrier?: string | null
  policyNumber?: string | null
  effectiveDate?: string | null
  expirationDate?: string | null
  daysToExpiration?: number | null
  /** Per-condition detail so the requirement matrix can render a column per rule. */
  detail: {
    limits: 'pass' | 'fail' | 'n/a'
    additionalInsured: 'pass' | 'fail' | 'n/a'
    waiverOfSubrogation: 'pass' | 'fail' | 'n/a'
    primaryNoncontributory: 'pass' | 'fail' | 'n/a'
    review: 'pass' | 'pending' | 'rejected' | 'n/a'
  }
  /** Present when a waiver masked a failure. The original failure is preserved. */
  waiver?: {
    id: string
    reason: string
    approvedBy: string
    expiresAt: string | null
    /** What the check would have been without the waiver. Never erased. */
    underlyingStatus: CheckStatus
    underlyingReasons: string[]
  }
}

export interface ComplianceResult {
  status: ComplianceStatus
  checks: ComplianceCheck[]
  /** Earliest expiration among the policies actually used to satisfy requirements. */
  earliestExpiration: string | null
  /** Days until `earliestExpiration`; negative when already expired. */
  earliestExpirationDays: number | null
  asOfDate: string
  warningDays: number
  /** True when at least one waiver is currently masking a failure. */
  hasActiveWaiver: boolean
  summary: string
}

export interface EvaluateInput {
  requirements: InsuranceRequirement[]
  policies: InsurancePolicy[]
  /** policyId -> certificate review status ('approved' | 'needs_review' | ...) */
  certificateReviewStatusByPolicy: Record<string, string>
  waivers: ComplianceWaiver[]
  asOfDate: Date
  warningDays: number
}

// ---------------------------------------------------------------------------
// Requirement resolution
// ---------------------------------------------------------------------------

/**
 * Resolution order (most specific wins, per coverage type):
 *
 *     project override  →  vendor default template  →  trade template  →  global default
 *
 * The spec calls out project → trade → global; the vendor-level template slots
 * in below the project override because `vendors.default_requirement_template_id`
 * exists and a specific vendor's contract terms beat a generic trade rule.
 *
 * Merging is per-coverage-type and whole-record: the highest-priority template
 * that mentions a coverage type supplies that entire rule. This is predictable
 * to reason about — nobody has to work out which template contributed which
 * individual limit.
 */
export function resolveRequirements(
  templates: RequirementTemplate[],
  ctx: { trade?: string | null; projectId?: string | null; vendorTemplateId?: string | null },
): { requirements: InsuranceRequirement[]; sources: Record<string, string> } {
  const active = templates.filter(t => t.active)
  const rank = (t: RequirementTemplate): number => {
    if (t.scope === 'project' && ctx.projectId && t.project_id === ctx.projectId) return 0
    if (ctx.vendorTemplateId && t.id === ctx.vendorTemplateId) return 1
    if (t.scope === 'trade' && ctx.trade && t.trade === ctx.trade) return 2
    if (t.scope === 'global') return 3
    return 99 // not applicable to this vendor/project
  }

  const byCoverage = new Map<string, { req: InsuranceRequirement; rank: number; source: string }>()
  for (const template of active) {
    const r = rank(template)
    if (r === 99) continue
    for (const req of template.insurance_requirements ?? []) {
      const existing = byCoverage.get(req.coverage_type)
      if (!existing || r < existing.rank) {
        byCoverage.set(req.coverage_type, { req, rank: r, source: template.name })
      }
    }
  }

  const requirements: InsuranceRequirement[] = []
  const sources: Record<string, string> = {}
  for (const [coverage, entry] of byCoverage) {
    requirements.push(entry.req)
    sources[coverage] = entry.source
  }
  requirements.sort(
    (a, b) => COVERAGE_ORDER.indexOf(a.coverage_type) - COVERAGE_ORDER.indexOf(b.coverage_type),
  )
  return { requirements, sources }
}

const COVERAGE_ORDER: CoverageType[] = [
  'general_liability', 'workers_compensation', 'commercial_auto', 'umbrella',
  'professional_liability', 'pollution_liability', 'other',
]

// ---------------------------------------------------------------------------
// Policy selection
// ---------------------------------------------------------------------------

/**
 * Picks the policy line that best represents a coverage type as of a date:
 *   1. a policy in force on that date, latest expiration wins
 *   2. otherwise the policy with the latest expiration (so we can say "expired
 *      on X" rather than "missing", which are very different conversations)
 */
export function selectPolicyForCoverage(
  policies: InsurancePolicy[],
  coverageType: CoverageType,
  asOf: Date,
): InsurancePolicy | null {
  const candidates = policies.filter(p => p.coverage_type === coverageType)
  if (candidates.length === 0) return null

  const expTime = (p: InsurancePolicy) => toUtcDate(p.expiration_date)?.getTime() ?? Number.POSITIVE_INFINITY
  const inForce = candidates.filter(p => {
    const eff = toUtcDate(p.effective_date)
    const exp = toUtcDate(p.expiration_date)
    if (eff && eff.getTime() > asOf.getTime()) return false
    if (exp && exp.getTime() < asOf.getTime()) return false
    return true
  })

  const pool = inForce.length > 0 ? inForce : candidates
  return pool.reduce((best, p) => (expTime(p) > expTime(best) ? p : best), pool[0])
}

// ---------------------------------------------------------------------------
// Limit checking
// ---------------------------------------------------------------------------

function num(limits: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = limits?.[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

/** Returns the list of failure reasons; empty array means the limits pass. */
export function checkLimits(req: InsuranceRequirement, policy: InsurancePolicy): string[] {
  const limits = (policy.limits_json ?? {}) as Record<string, unknown>
  const reasons: string[] = []
  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

  if (req.min_limit_each_occurrence != null) {
    const actual = num(limits, 'each_occurrence', 'occurrence', 'combined_single_limit')
    if (actual === null) reasons.push('Each-occurrence limit is not recorded on the policy line.')
    else if (actual < req.min_limit_each_occurrence) {
      reasons.push(`Each occurrence ${fmt(actual)} is below the required ${fmt(req.min_limit_each_occurrence)}.`)
    }
  }

  if (req.min_limit_aggregate != null) {
    const actual = num(limits, 'general_aggregate', 'aggregate')
    if (actual === null) reasons.push('Aggregate limit is not recorded on the policy line.')
    else if (actual < req.min_limit_aggregate) {
      reasons.push(`Aggregate ${fmt(actual)} is below the required ${fmt(req.min_limit_aggregate)}.`)
    }
  }

  if (req.min_combined_single_limit != null) {
    const actual = num(limits, 'combined_single_limit', 'each_occurrence')
    if (actual === null) reasons.push('Combined single limit is not recorded on the policy line.')
    else if (actual < req.min_combined_single_limit) {
      reasons.push(`Combined single limit ${fmt(actual)} is below the required ${fmt(req.min_combined_single_limit)}.`)
    }
  }

  if (req.min_workers_comp_el != null) {
    const actual = num(limits, 'el_each_accident', 'employers_liability', 'each_occurrence')
    if (actual === null) reasons.push("Employer's liability limit is not recorded on the policy line.")
    else if (actual < req.min_workers_comp_el) {
      reasons.push(`Employer's liability ${fmt(actual)} is below the required ${fmt(req.min_workers_comp_el)}.`)
    }
  }

  return reasons
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

function findWaiver(
  waivers: ComplianceWaiver[],
  req: InsuranceRequirement,
  asOf: Date,
): ComplianceWaiver | null {
  return (
    waivers.find(w => {
      if (w.revoked_at) return false
      if (w.expires_at && new Date(w.expires_at).getTime() < asOf.getTime()) return false
      if (w.requirement_id && w.requirement_id === req.id) return true
      if (w.coverage_type && w.coverage_type === req.coverage_type) return true
      return false
    }) ?? null
  )
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

export function evaluateCompliance(input: EvaluateInput): ComplianceResult {
  const { requirements, policies, certificateReviewStatusByPolicy, waivers, asOfDate, warningDays } = input
  const asOf = toUtcDate(asOfDate)!
  const checks: ComplianceCheck[] = []
  const expirations: Date[] = []
  let hasActiveWaiver = false

  const required = requirements.filter(r => r.required)

  for (const req of required) {
    const policy = selectPolicyForCoverage(policies, req.coverage_type, asOf)
    const reasons: string[] = []
    const detail: ComplianceCheck['detail'] = {
      limits: 'n/a', additionalInsured: 'n/a', waiverOfSubrogation: 'n/a',
      primaryNoncontributory: 'n/a', review: 'n/a',
    }
    let status: CheckStatus
    let daysToExpiration: number | null = null

    if (!policy) {
      status = 'missing'
      reasons.push(`No ${COVERAGE_LABELS[req.coverage_type]} policy line is on file.`)
    } else {
      const expiration = toUtcDate(policy.expiration_date)
      const effective = toUtcDate(policy.effective_date)
      daysToExpiration = expiration ? daysBetween(asOf, expiration) : null

      let failed = false
      let warned = false

      // 1. expiration ---------------------------------------------------------
      if (!expiration) {
        failed = true
        reasons.push('The policy line has no expiration date recorded — it cannot be verified as current.')
      } else if (daysToExpiration !== null && daysToExpiration < 0) {
        failed = true
        reasons.push(`Coverage expired ${Math.abs(daysToExpiration)} day${Math.abs(daysToExpiration) === 1 ? '' : 's'} ago (${policy.expiration_date}).`)
      } else if (daysToExpiration !== null && daysToExpiration <= warningDays) {
        warned = true
        reasons.push(`Coverage expires in ${daysToExpiration} day${daysToExpiration === 1 ? '' : 's'} (${policy.expiration_date}).`)
      }
      if (effective && effective.getTime() > asOf.getTime()) {
        failed = true
        reasons.push(`Coverage does not take effect until ${policy.effective_date}.`)
      }

      // 2. limits -------------------------------------------------------------
      const hasLimitRule =
        req.min_limit_each_occurrence != null || req.min_limit_aggregate != null ||
        req.min_combined_single_limit != null || req.min_workers_comp_el != null
      if (hasLimitRule) {
        const limitReasons = checkLimits(req, policy)
        detail.limits = limitReasons.length ? 'fail' : 'pass'
        if (limitReasons.length) { failed = true; reasons.push(...limitReasons) }
      }

      // 3. required endorsement flags ----------------------------------------
      if (req.additional_insured_required) {
        detail.additionalInsured = policy.additional_insured ? 'pass' : 'fail'
        if (!policy.additional_insured) {
          failed = true
          reasons.push('Additional insured status is required but is not recorded on this policy line.')
        }
      }
      if (req.waiver_of_subrogation_required) {
        detail.waiverOfSubrogation = policy.waiver_of_subrogation ? 'pass' : 'fail'
        if (!policy.waiver_of_subrogation) {
          failed = true
          reasons.push('Waiver of subrogation is required but is not recorded on this policy line.')
        }
      }
      if (req.primary_noncontributory_required) {
        detail.primaryNoncontributory = policy.primary_noncontributory ? 'pass' : 'fail'
        if (!policy.primary_noncontributory) {
          failed = true
          reasons.push('Primary and non-contributory status is required but is not recorded on this policy line.')
        }
      }
      if (req.endorsement_required) {
        reasons.push('A copy of the endorsement page is required — confirm the document is attached to this vendor.')
      }

      // 4. human review -------------------------------------------------------
      const reviewStatus = certificateReviewStatusByPolicy[policy.id] ?? 'needs_review'
      if (reviewStatus === 'approved') {
        detail.review = 'pass'
      } else if (reviewStatus === 'rejected') {
        detail.review = 'rejected'
        failed = true
        reasons.push('The source certificate was rejected during review.')
      } else {
        detail.review = 'pending'
        warned = true
        reasons.push('The source certificate has not been reviewed and approved by a person yet.')
      }

      // 5. verdict ------------------------------------------------------------
      if (failed) status = 'fail'
      else if (warned) status = 'warning'
      else status = 'pass'

      if (expiration && !failed) expirations.push(expiration)


    }

    const check: ComplianceCheck = {
      requirementId: req.id,
      coverageType: req.coverage_type,
      coverageLabel: COVERAGE_LABELS[req.coverage_type],
      status,
      reasons,
      detail,
      policyId: policy?.id,
      carrier: policy?.carrier ?? null,
      policyNumber: policy?.policy_number ?? null,
      effectiveDate: policy?.effective_date ?? null,
      expirationDate: policy?.expiration_date ?? null,
      daysToExpiration,
    }

    // Waivers mask a failure but never erase it.
    if (status !== 'pass') {
      const waiver = findWaiver(waivers, req, asOf)
      if (waiver) {
        hasActiveWaiver = true
        check.waiver = {
          id: waiver.id,
          reason: waiver.reason,
          approvedBy: waiver.approved_by,
          expiresAt: waiver.expires_at,
          underlyingStatus: status,
          underlyingReasons: [...reasons],
        }
        check.status = 'waived'
      }
    }

    checks.push(check)
  }

  // -------------------------------------------------------------------------
  // Roll checks up into one status.
  // Priority: non_compliant > missing > needs_review > expiring_soon > waived > compliant
  // -------------------------------------------------------------------------
  const candidates: ComplianceStatus[] = ['compliant']
  for (const c of checks) {
    if (c.status === 'fail') candidates.push('non_compliant')
    else if (c.status === 'missing') candidates.push('missing')
    else if (c.status === 'waived') candidates.push('waived')
    else if (c.status === 'warning') {
      candidates.push(c.detail.review === 'pending' ? 'needs_review' : 'expiring_soon')
    }
  }
  if (required.length === 0) candidates.push('needs_review')

  const status = COMPLIANCE_SEVERITY.find(s => candidates.includes(s)) ?? 'compliant'

  const earliest = expirations.length
    ? expirations.reduce((a, b) => (a.getTime() < b.getTime() ? a : b))
    : null

  return {
    status,
    checks,
    earliestExpiration: earliest ? earliest.toISOString().slice(0, 10) : null,
    earliestExpirationDays: earliest ? daysBetween(asOf, earliest) : null,
    asOfDate: asOf.toISOString().slice(0, 10),
    warningDays,
    hasActiveWaiver,
    summary: summarize(status, checks, required.length),
  }
}

function summarize(status: ComplianceStatus, checks: ComplianceCheck[], requiredCount: number): string {
  if (requiredCount === 0) {
    return 'No insurance requirements are configured for this vendor — nothing can be verified yet.'
  }
  const failing = checks.filter(c => c.status === 'fail').map(c => c.coverageLabel)
  const missing = checks.filter(c => c.status === 'missing').map(c => c.coverageLabel)
  const warning = checks.filter(c => c.status === 'warning').map(c => c.coverageLabel)
  const waived = checks.filter(c => c.status === 'waived').map(c => c.coverageLabel)

  switch (status) {
    case 'non_compliant':
      return `Does not meet requirements: ${failing.join(', ')}.`
    case 'missing':
      return `No certificate on file for: ${missing.join(', ')}.`
    case 'needs_review':
      return `Awaiting human review: ${warning.join(', ')}.`
    case 'expiring_soon':
      return `Expiring inside the warning window: ${warning.join(', ')}.`
    case 'waived':
      return `Documented exception on file for: ${waived.join(', ')}.`
    default:
      return `All ${requiredCount} required coverage${requiredCount === 1 ? '' : 's'} present, current and reviewed.`
  }
}

import { describe, expect, it } from 'vitest'
import {
  checkLimits,
  evaluateCompliance,
  resolveRequirements,
  selectPolicyForCoverage,
} from '../lib/ops/compliance/evaluator'
import type {
  ComplianceWaiver, CoverageType, InsurancePolicy, InsuranceRequirement, RequirementTemplate,
} from '../lib/ops/types'

/**
 * The evaluator is the one piece of this system that must never be wrong, so it
 * is pure and every rule in spec §16 and §28 has a test here.
 */

const TODAY = new Date('2026-06-15T00:00:00Z')

function daysFromToday(days: number): string {
  return new Date(TODAY.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

function requirement(overrides: Partial<InsuranceRequirement> = {}): InsuranceRequirement {
  return {
    id: `req-${overrides.coverage_type ?? 'gl'}`,
    template_id: 'tpl-global',
    coverage_type: 'general_liability',
    required: true,
    min_limit_each_occurrence: 1_000_000,
    min_limit_aggregate: 2_000_000,
    min_combined_single_limit: null,
    min_workers_comp_el: null,
    additional_insured_required: true,
    waiver_of_subrogation_required: true,
    primary_noncontributory_required: true,
    endorsement_required: false,
    notes: null,
    ...overrides,
  }
}

function policy(overrides: Partial<InsurancePolicy> = {}): InsurancePolicy {
  return {
    id: `pol-${overrides.coverage_type ?? 'gl'}-${overrides.policy_number ?? '1'}`,
    certificate_id: 'cert-1',
    coverage_type: 'general_liability',
    carrier: 'Southern Owners',
    naic: null,
    policy_number: 'GL-1',
    effective_date: daysFromToday(-200),
    expiration_date: daysFromToday(165),
    limits_json: {
      each_occurrence: 1_000_000,
      general_aggregate: 2_000_000,
      products_completed_ops_aggregate: 2_000_000,
    },
    additional_insured: true,
    waiver_of_subrogation: true,
    primary_noncontributory: true,
    claims_made: null,
    occurrence_form: true,
    notes: null,
    ...overrides,
  }
}

const WC_REQ = requirement({
  id: 'req-wc',
  coverage_type: 'workers_compensation',
  min_limit_each_occurrence: null,
  min_limit_aggregate: null,
  min_workers_comp_el: 1_000_000,
  additional_insured_required: false,
  waiver_of_subrogation_required: false,
  primary_noncontributory_required: false,
})

const WC_POLICY = policy({
  id: 'pol-wc',
  coverage_type: 'workers_compensation',
  policy_number: 'WC-1',
  limits_json: {
    statutory: true,
    el_each_accident: 1_000_000,
    el_disease_each_employee: 1_000_000,
    el_disease_policy_limit: 1_000_000,
  },
  additional_insured: false,
  waiver_of_subrogation: false,
  primary_noncontributory: false,
})

function evaluate(opts: {
  requirements: InsuranceRequirement[]
  policies: InsurancePolicy[]
  review?: Record<string, string>
  waivers?: ComplianceWaiver[]
  warningDays?: number
}) {
  const review = opts.review ?? Object.fromEntries(opts.policies.map(p => [p.id, 'approved']))
  return evaluateCompliance({
    requirements: opts.requirements,
    policies: opts.policies,
    certificateReviewStatusByPolicy: review,
    waivers: opts.waivers ?? [],
    asOfDate: TODAY,
    warningDays: opts.warningDays ?? 30,
  })
}

describe('evaluateCompliance', () => {
  it('returns compliant when everything is present, current, sufficient and reviewed', () => {
    const result = evaluate({ requirements: [requirement(), WC_REQ], policies: [policy(), WC_POLICY] })
    expect(result.status).toBe('compliant')
    expect(result.checks.every(c => c.status === 'pass')).toBe(true)
    expect(result.earliestExpiration).toBe(daysFromToday(165))
  })

  it('reports MISSING when a required coverage has no policy line at all', () => {
    const result = evaluate({ requirements: [requirement(), WC_REQ], policies: [policy()] })
    expect(result.status).toBe('missing')
    const wc = result.checks.find(c => c.coverageType === 'workers_compensation')!
    expect(wc.status).toBe('missing')
    expect(wc.reasons[0]).toMatch(/no workers compensation policy line/i)
  })

  it('reports NON_COMPLIANT for expired workers compensation', () => {
    const expiredWc = { ...WC_POLICY, expiration_date: daysFromToday(-3) }
    const result = evaluate({ requirements: [requirement(), WC_REQ], policies: [policy(), expiredWc] })
    expect(result.status).toBe('non_compliant')
    const wc = result.checks.find(c => c.coverageType === 'workers_compensation')!
    expect(wc.status).toBe('fail')
    expect(wc.reasons.join(' ')).toMatch(/expired 3 days ago/i)
  })

  it('reports NON_COMPLIANT when a GL limit is below the requirement', () => {
    const lowGl = policy({ limits_json: { each_occurrence: 500_000, general_aggregate: 2_000_000 } })
    const result = evaluate({ requirements: [requirement()], policies: [lowGl] })
    expect(result.status).toBe('non_compliant')
    const gl = result.checks[0]
    expect(gl.detail.limits).toBe('fail')
    expect(gl.reasons.join(' ')).toMatch(/\$500,000 is below the required \$1,000,000/)
  })

  it('reports EXPIRING_SOON inside the warning window but not outside it', () => {
    const soon = policy({ expiration_date: daysFromToday(12) })
    const inside = evaluate({ requirements: [requirement()], policies: [soon] })
    expect(inside.status).toBe('expiring_soon')
    expect(inside.checks[0].daysToExpiration).toBe(12)

    const outside = evaluate({ requirements: [requirement()], policies: [soon], warningDays: 7 })
    expect(outside.status).toBe('compliant')
  })

  it('reports NON_COMPLIANT when a required additional-insured flag is absent', () => {
    const noAi = policy({ additional_insured: false })
    const result = evaluate({ requirements: [requirement()], policies: [noAi] })
    expect(result.status).toBe('non_compliant')
    expect(result.checks[0].detail.additionalInsured).toBe('fail')
    expect(result.checks[0].reasons.join(' ')).toMatch(/additional insured/i)
  })

  it('reports NEEDS_REVIEW when the certificate has not been approved by a person', () => {
    const p = policy()
    const result = evaluate({
      requirements: [requirement()],
      policies: [p],
      review: { [p.id]: 'needs_review' },
    })
    expect(result.status).toBe('needs_review')
    expect(result.checks[0].detail.review).toBe('pending')
  })

  it('treats a rejected certificate as a hard failure, not a pending review', () => {
    const p = policy()
    const result = evaluate({
      requirements: [requirement()],
      policies: [p],
      review: { [p.id]: 'rejected' },
    })
    expect(result.status).toBe('non_compliant')
    expect(result.checks[0].detail.review).toBe('rejected')
  })

  it('masks a failure with a waiver but preserves the underlying finding', () => {
    const waiver: ComplianceWaiver = {
      id: 'waiver-1',
      vendor_id: 'v1',
      project_id: null,
      coverage_type: 'workers_compensation',
      requirement_id: null,
      reason: 'Sole proprietor with a valid Florida exemption on file.',
      approved_by: 'user-1',
      expires_at: null,
      revoked_at: null,
      created_at: daysFromToday(-10),
    }
    const result = evaluate({ requirements: [requirement(), WC_REQ], policies: [policy()], waivers: [waiver] })

    expect(result.status).toBe('waived')
    expect(result.hasActiveWaiver).toBe(true)

    const wc = result.checks.find(c => c.coverageType === 'workers_compensation')!
    expect(wc.status).toBe('waived')
    // The original failure is still on the record — never erased.
    expect(wc.waiver?.underlyingStatus).toBe('missing')
    expect(wc.waiver?.underlyingReasons.join(' ')).toMatch(/no workers compensation policy line/i)
  })

  it('ignores a revoked or expired waiver', () => {
    const base = {
      id: 'w', vendor_id: 'v1', project_id: null, coverage_type: 'workers_compensation' as CoverageType,
      requirement_id: null, reason: 'x', approved_by: 'u', created_at: daysFromToday(-30),
    }
    const revoked: ComplianceWaiver = { ...base, expires_at: null, revoked_at: daysFromToday(-1) }
    const expired: ComplianceWaiver = { ...base, expires_at: daysFromToday(-1), revoked_at: null }

    expect(evaluate({ requirements: [WC_REQ], policies: [], waivers: [revoked] }).status).toBe('missing')
    expect(evaluate({ requirements: [WC_REQ], policies: [], waivers: [expired] }).status).toBe('missing')
  })

  it('ranks a hard failure above a missing coverage above a pending review', () => {
    const lowGl = policy({ limits_json: { each_occurrence: 100, general_aggregate: 100 } })
    const result = evaluate({ requirements: [requirement(), WC_REQ], policies: [lowGl] })
    // GL fails AND WC is missing — non_compliant wins.
    expect(result.status).toBe('non_compliant')
  })

  it('ignores requirements marked not required', () => {
    const optional = requirement({ id: 'req-umb', coverage_type: 'umbrella', required: false })
    const result = evaluate({ requirements: [requirement(), optional], policies: [policy()] })
    expect(result.status).toBe('compliant')
    expect(result.checks).toHaveLength(1)
  })

  it('flags a vendor with no configured requirements rather than calling them compliant', () => {
    const result = evaluate({ requirements: [], policies: [] })
    expect(result.status).toBe('needs_review')
    expect(result.summary).toMatch(/no insurance requirements are configured/i)
  })

  it('fails a policy with no expiration date recorded', () => {
    const undated = policy({ expiration_date: null })
    const result = evaluate({ requirements: [requirement()], policies: [undated] })
    expect(result.status).toBe('non_compliant')
    expect(result.checks[0].reasons.join(' ')).toMatch(/no expiration date/i)
  })

  it('fails a policy that has not taken effect yet', () => {
    const future = policy({ effective_date: daysFromToday(10), expiration_date: daysFromToday(400) })
    const result = evaluate({ requirements: [requirement()], policies: [future] })
    expect(result.status).toBe('non_compliant')
    expect(result.checks[0].reasons.join(' ')).toMatch(/does not take effect until/i)
  })
})

describe('selectPolicyForCoverage', () => {
  it('prefers a policy that is in force today', () => {
    const expired = policy({ id: 'old', expiration_date: daysFromToday(-5) })
    const current = policy({ id: 'new', expiration_date: daysFromToday(100) })
    expect(selectPolicyForCoverage([expired, current], 'general_liability', TODAY)?.id).toBe('new')
  })

  it('falls back to the latest expired policy so we can say "expired", not "missing"', () => {
    const older = policy({ id: 'older', effective_date: daysFromToday(-700), expiration_date: daysFromToday(-300) })
    const newer = policy({ id: 'newer', effective_date: daysFromToday(-300), expiration_date: daysFromToday(-5) })
    expect(selectPolicyForCoverage([older, newer], 'general_liability', TODAY)?.id).toBe('newer')
  })

  it('returns null when no policy of that coverage type exists', () => {
    expect(selectPolicyForCoverage([policy()], 'pollution_liability', TODAY)).toBeNull()
  })
})

describe('checkLimits', () => {
  it('accepts a combined single limit in place of each-occurrence for auto', () => {
    const req = requirement({
      coverage_type: 'commercial_auto',
      min_limit_each_occurrence: null,
      min_limit_aggregate: null,
      min_combined_single_limit: 1_000_000,
    })
    const auto = policy({ coverage_type: 'commercial_auto', limits_json: { combined_single_limit: 1_000_000 } })
    expect(checkLimits(req, auto)).toEqual([])
  })

  it("flags an employer's liability limit below the requirement", () => {
    const wc = policy({
      coverage_type: 'workers_compensation',
      limits_json: { statutory: true, el_each_accident: 500_000 },
    })
    const reasons = checkLimits(WC_REQ, wc)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatch(/Employer's liability \$500,000 is below/)
  })

  it('reports an unrecorded limit rather than silently passing it', () => {
    const bare = policy({ limits_json: {} })
    const reasons = checkLimits(requirement(), bare)
    expect(reasons.join(' ')).toMatch(/not recorded/i)
  })
})

describe('resolveRequirements', () => {
  const globalTpl: RequirementTemplate = {
    id: 'tpl-global', name: 'Global Default', scope: 'global', trade: null, project_id: null,
    active: true, disclaimer: null,
    insurance_requirements: [
      requirement({ id: 'g-gl', min_limit_each_occurrence: 1_000_000 }),
      { ...WC_REQ, id: 'g-wc' },
    ],
  }
  const roofingTpl: RequirementTemplate = {
    id: 'tpl-roof', name: 'Roofing', scope: 'trade', trade: 'Roofing', project_id: null,
    active: true, disclaimer: null,
    insurance_requirements: [requirement({ id: 'r-gl', min_limit_each_occurrence: 2_000_000 })],
  }
  const projectTpl: RequirementTemplate = {
    id: 'tpl-proj', name: 'Gulfview Plaza', scope: 'project', trade: null, project_id: 'proj-1',
    active: true, disclaimer: null,
    insurance_requirements: [requirement({ id: 'p-gl', min_limit_each_occurrence: 5_000_000 })],
  }

  it('falls back to the global template when nothing more specific applies', () => {
    const { requirements, sources } = resolveRequirements([globalTpl, roofingTpl], { trade: 'Drywall' })
    expect(requirements.find(r => r.coverage_type === 'general_liability')!.id).toBe('g-gl')
    expect(sources.general_liability).toBe('Global Default')
  })

  it('lets a trade template beat the global default', () => {
    const { requirements } = resolveRequirements([globalTpl, roofingTpl], { trade: 'Roofing' })
    expect(requirements.find(r => r.coverage_type === 'general_liability')!.id).toBe('r-gl')
    // Coverage the trade template does not mention still comes from global.
    expect(requirements.find(r => r.coverage_type === 'workers_compensation')!.id).toBe('g-wc')
  })

  it('lets a project override beat both', () => {
    const { requirements, sources } = resolveRequirements(
      [globalTpl, roofingTpl, projectTpl],
      { trade: 'Roofing', projectId: 'proj-1' },
    )
    expect(requirements.find(r => r.coverage_type === 'general_liability')!.id).toBe('p-gl')
    expect(sources.general_liability).toBe('Gulfview Plaza')
  })

  it('ignores a project template belonging to a different project', () => {
    const { requirements } = resolveRequirements(
      [globalTpl, projectTpl],
      { trade: 'Roofing', projectId: 'proj-2' },
    )
    expect(requirements.find(r => r.coverage_type === 'general_liability')!.id).toBe('g-gl')
  })

  it('ignores inactive templates', () => {
    const { requirements } = resolveRequirements(
      [globalTpl, { ...roofingTpl, active: false }],
      { trade: 'Roofing' },
    )
    expect(requirements.find(r => r.coverage_type === 'general_liability')!.id).toBe('g-gl')
  })
})

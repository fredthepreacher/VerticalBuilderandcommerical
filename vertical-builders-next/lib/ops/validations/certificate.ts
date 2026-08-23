import { z } from 'zod'
import { COVERAGE_TYPES } from '../types'

const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional())

const nullableDate = z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional())

/** Insurance limits: whole dollars, integers only. Never floats. */
const limitValue = z.preprocess(
  v => {
    if (v === '' || v === null || v === undefined) return undefined
    if (typeof v === 'number') return Math.round(v)
    const raw = String(v).replace(/[$,\s]/g, '')
    const n = Number(raw)
    return Number.isFinite(n) ? Math.round(n) : undefined
  },
  z.number().int().nonnegative().max(1_000_000_000).optional(),
)

export const policyLineSchema = z.object({
  id: z.string().uuid().optional(),
  coverage_type: z.enum(COVERAGE_TYPES),
  carrier: optionalText(160),
  naic: optionalText(20),
  policy_number: optionalText(80),
  effective_date: nullableDate,
  expiration_date: nullableDate,
  additional_insured: z.coerce.boolean().optional(),
  waiver_of_subrogation: z.coerce.boolean().optional(),
  primary_noncontributory: z.coerce.boolean().optional(),
  claims_made: z.coerce.boolean().optional(),
  occurrence_form: z.coerce.boolean().optional(),
  notes: optionalText(1000),
  limits: z.object({
    each_occurrence: limitValue,
    general_aggregate: limitValue,
    products_completed_ops_aggregate: limitValue,
    damage_to_rented_premises: limitValue,
    med_exp: limitValue,
    personal_adv_injury: limitValue,
    combined_single_limit: limitValue,
    aggregate: limitValue,
    el_each_accident: limitValue,
    el_disease_each_employee: limitValue,
    el_disease_policy_limit: limitValue,
    statutory: z.coerce.boolean().optional(),
  }).default({}),
})

export type PolicyLineInput = z.infer<typeof policyLineSchema>

export const certificateSchema = z.object({
  vendor_id: z.string().uuid(),
  document_id: z.string().uuid().nullable().optional(),
  issue_date: nullableDate,
  received_at: nullableDate,
  broker_name: optionalText(200),
  broker_contact_name: optionalText(120),
  broker_email: z.preprocess(v => (v === '' ? undefined : v), z.string().email().max(160).optional()),
  broker_phone: optionalText(40),
  named_insured: optionalText(200),
  certificate_holder: optionalText(200),
  source: z.enum(['admin_upload', 'vendor_portal', 'email_manual']).default('admin_upload'),
  reviewer_notes: optionalText(2000),
  project_ids: z.array(z.string().uuid()).max(50).default([]),
  policies: z.array(policyLineSchema).min(1, 'Add at least one coverage line.').max(20),
})
  .superRefine((value, ctx) => {
    value.policies.forEach((p, i) => {
      const eff = p.effective_date
      const exp = p.expiration_date
      if (eff && exp && exp < eff) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['policies', i, 'expiration_date'],
          message: 'Expiration date must be on or after the effective date.',
        })
      }
    })
  })

export type CertificateInput = z.infer<typeof certificateSchema>

/** Strips undefined limit keys so limits_json stays tidy in the database. */
export function cleanLimits(limits: Record<string, unknown>): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
  for (const [k, v] of Object.entries(limits ?? {})) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

export const waiverSchema = z.object({
  vendor_id: z.string().uuid(),
  project_id: z.preprocess(v => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  coverage_type: z.enum(COVERAGE_TYPES).optional(),
  requirement_id: z.preprocess(v => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  reason: z.string().trim().min(10, 'Explain why this exception is being granted (at least 10 characters).').max(2000),
  expires_at: z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional()),
})

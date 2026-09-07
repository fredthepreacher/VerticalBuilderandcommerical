import { z } from 'zod'
import { UNITS } from '../types'
import { centsField } from './estimate'

/**
 * ============================================================================
 * PROPOSAL TEMPLATE VALIDATION
 * ----------------------------------------------------------------------------
 * A template is reusable proposal wording. Two rules shape this schema:
 *
 *   1. PRICING IS OPTIONAL. Quantity and rate are nullable, and blank stays
 *      blank — a template that silently defaulted to a quantity of 1 and a rate
 *      of $0 would put those figures on a customer's proposal.
 *
 *   2. NO CUSTOMER PII. A template is reused across customers, so the fields
 *      that identify one are simply absent from the schema. Anything the
 *      "save this estimate as a template" path tries to carry across that is
 *      not listed here is dropped by `.strict()` rather than stored.
 * ============================================================================
 */

const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional())

const nullableUuid = z.preprocess(v => (v === '' || v === undefined ? null : v),
  z.string().uuid().nullable().optional())

/**
 * Blank means blank. This is the difference between "the client has not decided
 * a rate yet" and "the rate is zero", and putting $0.00 on a proposal because a
 * field was empty is exactly the failure to avoid.
 */
const optionalCents = z.preprocess(
  v => (v === '' || v === null || v === undefined ? null : v),
  centsField.nullable(),
)

const optionalQuantity = z.preprocess(
  v => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(String(v).replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 10_000) / 10_000 : null
  },
  z.number().min(0).max(1_000_000).nullable(),
)

/** Catches a template accidentally saved with one customer's details in it. */
const EMAIL_LIKE = /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/
const PHONE_LIKE = /(?<![\d])(?:\+?1[\s.\-]?)?\(?[2-9]\d{2}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(?![\d])/

export const proposalTemplateLineSchema = z.object({
  id: z.string().uuid().optional(),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  category: optionalText(80),
  description: z.string().trim().min(1, 'Every template line needs a description.').max(500),
  unit: z.enum(UNITS).default('EA'),
  default_quantity: optionalQuantity,
  default_unit_price_cents: optionalCents,
  pricebook_item_id: nullableUuid,
  notes: optionalText(1000),
}).strict()

export type ProposalTemplateLineInput = z.infer<typeof proposalTemplateLineSchema>

export const proposalTemplateSchema = z.object({
  name: z.string().trim()
    .min(1, 'Give the template a name — that is how you will find it later.')
    .max(120)
    .refine(v => !EMAIL_LIKE.test(v), 'A template name should not contain an email address.')
    .refine(v => !PHONE_LIKE.test(v), 'A template name should not contain a phone number.'),
  description: optionalText(500),
  service_type: optionalText(80),
  scope_summary: optionalText(6_000),
  customer_notes: optionalText(4_000),
  lines: z.array(proposalTemplateLineSchema).max(200).default([]),
}).strict()

export type ProposalTemplateInput = z.infer<typeof proposalTemplateSchema>

/**
 * The fields a template may hold, as data rather than as a comment.
 *
 * Used by the "save this estimate as a template" path and asserted by the
 * tests, so the PII rule is checkable rather than merely stated.
 */
export const TEMPLATE_HEADER_FIELDS = [
  'name', 'description', 'service_type', 'scope_summary', 'customer_notes',
] as const

/** Everything a template must never carry over from an estimate. */
export const FORBIDDEN_TEMPLATE_FIELDS = [
  'contact_id', 'lead_id', 'project_id', 'estimate_number', 'property_address',
  'city', 'state', 'zip', 'customer_name', 'email', 'phone', 'assigned_to',
  'valid_until', 'internal_notes', 'discount_cents', 'tax_percent', 'total_cents',
] as const

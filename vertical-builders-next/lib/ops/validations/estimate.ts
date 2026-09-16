import { z } from 'zod'
import {
  COST_CATEGORIES, ESTIMATE_STATUSES, INVOICE_TYPES, PAYMENT_METHODS, UNITS,
} from '../types'

const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional())

const nullableDate = z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional())
const nullableUuid = z.preprocess(v => (v === '' ? null : v), z.string().uuid().nullable().optional())

/** Dollars in, integer cents out. Never a float. */
export const centsField = z.preprocess(
  v => {
    if (v === '' || v === null || v === undefined) return 0
    const n = Number(String(v).replace(/[$,\s]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 100) : 0
  },
  z.number().int().min(-1_000_000_000).max(1_000_000_000),
)

/** Quantities may be decimal — 2.5 squares of roof is real. */
const quantityField = z.preprocess(
  v => {
    if (v === '' || v === null || v === undefined) return 1
    const n = Number(String(v).replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 1
  },
  z.number().min(0).max(1_000_000),
)

export const estimateLineSchema = z.object({
  id: z.string().uuid().optional(),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  category: optionalText(80),
  description: z.string().trim().min(1, 'Every line needs a description.').max(500),
  quantity: quantityField,
  unit: z.enum(UNITS).default('EA'),
  unit_price_cents: centsField,
  labor_cost_cents: z.preprocess(v => (v === '' || v === undefined ? null : v), centsField.nullable()),
  material_cost_cents: z.preprocess(v => (v === '' || v === undefined ? null : v), centsField.nullable()),
  markup_percent: z.preprocess(
    v => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().min(0).max(1000).nullable(),
  ),
  pricebook_item_id: nullableUuid,
  // 'template' added in 0014 — provenance matters, and storing a template line
  // as 'manual' would make "where did this wording come from" unanswerable.
  source: z.enum(['manual', 'pricebook', 'ai', 'measurement', 'import', 'template']).default('manual'),
  ai_generated: z.coerce.boolean().default(false),
  needs_review: z.coerce.boolean().default(false),
  notes: optionalText(1000),
})

export type EstimateLineInput = z.infer<typeof estimateLineSchema>

export const estimateSchema = z.object({
  title: z.string().trim().min(1, 'Give the estimate a title.').max(200),
  contact_id: nullableUuid,
  lead_id: nullableUuid,
  project_id: nullableUuid,
  property_address: optionalText(200),
  city: optionalText(80),
  state: optionalText(2),
  zip: optionalText(12),
  service_type: optionalText(80),
  scope_summary: optionalText(8000),
  status: z.enum(ESTIMATE_STATUSES).default('draft'),
  discount_cents: centsField.optional(),
  tax_percent: z.preprocess(
    v => (v === '' || v === undefined || v === null ? 0 : Number(v)),
    z.number().min(0).max(100),
  ).default(0),
  valid_until: nullableDate,
  customer_notes: optionalText(4000),
  internal_notes: optionalText(4000),
  assigned_to: nullableUuid,
  lines: z.array(estimateLineSchema).max(200).default([]),
})

export type EstimateInput = z.infer<typeof estimateSchema>

export const pricebookItemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  category: optionalText(80),
  service_type: optionalText(80),
  description: optionalText(1000),
  unit: z.enum(UNITS).default('EA'),
  default_unit_price_cents: centsField,
  default_material_cost_cents: z.preprocess(v => (v === '' || v === undefined ? null : v), centsField.nullable()),
  default_labor_cost_cents: z.preprocess(v => (v === '' || v === undefined ? null : v), centsField.nullable()),
  active: z.coerce.boolean().default(true),
  tags: z.array(z.string().max(40)).max(20).default([]),
})

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

const measureNumber = z.preprocess(
  v => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(String(v).replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? n : null
  },
  z.number().min(0).max(1_000_000).nullable(),
)

export const roofMeasurementSchema = z.object({
  address: z.string().trim().min(3, 'Enter the property address.').max(300),
  project_id: nullableUuid,
  estimate_id: nullableUuid,
  provider: z.enum(['manual', 'uploaded_report', 'eagleview', 'nearmap', 'other']).default('manual'),
  roof_area_sqft: measureNumber,
  roof_area_squares: measureNumber,
  primary_pitch: optionalText(20),
  facet_count: z.preprocess(
    v => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(500).nullable(),
  ),
  ridge_lf: measureNumber,
  hip_lf: measureNumber,
  valley_lf: measureNumber,
  eave_lf: measureNumber,
  rake_lf: measureNumber,
  waste_factor_percent: z.preprocess(
    v => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().min(0).max(100).nullable(),
  ),
  notes: optionalText(2000),
}).refine(
  v => v.roof_area_sqft !== null || v.roof_area_squares !== null,
  { message: 'Enter the roof area, either in square feet or in squares.', path: ['roof_area_squares'] },
)

// ---------------------------------------------------------------------------
// Invoices, payments, costs
// ---------------------------------------------------------------------------

export const invoiceItemSchema = z.object({
  id: z.string().uuid().optional(),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  description: z.string().trim().min(1, 'Every line needs a description.').max(500),
  quantity: quantityField,
  unit: optionalText(12),
  unit_price_cents: centsField,
  estimate_line_item_id: nullableUuid,
})

export const invoiceSchema = z.object({
  project_id: z.string().uuid('Choose a job for this invoice.'),
  contact_id: nullableUuid,
  estimate_id: nullableUuid,
  invoice_type: z.enum(INVOICE_TYPES).default('standard'),
  issue_date: z.string().min(10, 'Issue date is required.'),
  due_date: nullableDate,
  discount_cents: centsField.optional(),
  tax_percent: z.preprocess(
    v => (v === '' || v === undefined || v === null ? 0 : Number(v)),
    z.number().min(0).max(100),
  ).default(0),
  notes: optionalText(4000),
  customer_message: optionalText(4000),
  items: z.array(invoiceItemSchema).min(1, 'An invoice needs at least one line.').max(200),
})

export const manualPaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount_cents: centsField.refine(v => v > 0, 'Enter an amount greater than zero.'),
  method: z.enum(PAYMENT_METHODS).default('check'),
  check_number: optionalText(40),
  reference_number: optionalText(80),
  received_date: z.string().min(10, 'Enter the date the payment was received.'),
  notes: optionalText(1000),
  allow_overpayment: z.coerce.boolean().default(false),
})

export const jobCostSchema = z.object({
  project_id: z.string().uuid(),
  category: z.enum(COST_CATEGORIES),
  vendor_id: nullableUuid,
  description: z.string().trim().min(1, 'Describe the cost.').max(300),
  amount_cents: centsField.refine(v => v !== 0, 'Enter an amount.'),
  cost_date: z.string().min(10, 'Enter the date of the cost.'),
  notes: optionalText(1000),
})

// ---------------------------------------------------------------------------
// Schedule, photos, agreements
// ---------------------------------------------------------------------------

export const scheduleUpdateSchema = z.object({
  project_id: z.string().uuid(),
  scheduled_start_date: nullableDate,
  scheduled_end_date: nullableDate,
  schedule_notes: optionalText(1000),
}).refine(
  v => {
    if (!v.scheduled_start_date || !v.scheduled_end_date) return true
    return v.scheduled_end_date >= v.scheduled_start_date
  },
  { message: 'The end date must be on or after the start date.', path: ['scheduled_end_date'] },
)

export const projectPhotoSchema = z.object({
  project_id: z.string().uuid(),
  phase: z.enum(['before', 'during', 'after', 'inspection', 'damage', 'progress', 'completion', 'other'])
    .default('progress'),
  caption: optionalText(300),
  taken_at: nullableDate,
  customer_visible: z.coerce.boolean().default(false),
})

export const agreementSchema = z.object({
  vendor_id: z.string().uuid(),
  status: z.enum(['missing', 'sent', 'signed', 'expired', 'superseded']).default('sent'),
  effective_date: nullableDate,
  expiration_date: nullableDate,
  signed_date: nullableDate,
  notes: optionalText(2000),
}).refine(
  v => v.status !== 'signed' || Boolean(v.signed_date),
  { message: 'A signed agreement needs the date it was signed.', path: ['signed_date'] },
).refine(
  v => {
    if (!v.effective_date || !v.expiration_date) return true
    return v.expiration_date >= v.effective_date
  },
  { message: 'Expiration must be on or after the effective date.', path: ['expiration_date'] },
)

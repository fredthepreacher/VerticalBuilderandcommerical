import { z } from 'zod'
import { PROJECT_STATUSES } from '../types'

const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional())
const nullableUuid = z.preprocess(v => (v === '' ? null : v), z.string().uuid().nullable().optional())
const nullableDate = z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional())
const nullableCents = z.preprocess(
  v => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(String(v).replace(/[$,\s]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 100) : null
  },
  z.number().int().nonnegative().nullable(),
)

export const projectSchema = z.object({
  project_name: z.string().trim().min(1, 'Project name is required.').max(200),
  customer_id: nullableUuid,
  jobsite_address: optionalText(200),
  city: optionalText(80),
  state: optionalText(2),
  zip: optionalText(12),
  customer_type: z.enum(['residential', 'commercial']).optional(),
  service_category: optionalText(80),
  description: optionalText(4000),
  status: z.enum(PROJECT_STATUSES).default('prospect'),
  estimator_id: nullableUuid,
  project_manager_id: nullableUuid,
  start_date: nullableDate,
  estimated_completion_date: nullableDate,
  actual_completion_date: nullableDate,
  estimate_amount_cents: nullableCents,
  contract_amount_cents: nullableCents,
  permit_number: optionalText(80),
  permit_status: optionalText(80),
  insurance_claim_related: z.coerce.boolean().default(false),
  insurance_carrier: optionalText(160),
  insurance_claim_number: optionalText(80),
  notes: optionalText(4000),
})

export const contactSchema = z.object({
  contact_type: z.enum(['homeowner', 'business', 'property_manager', 'other']).default('homeowner'),
  first_name: optionalText(120),
  last_name: optionalText(120),
  company_name: optionalText(200),
  email: z.preprocess(v => (v === '' ? undefined : v), z.string().email().max(160).optional()),
  phone: optionalText(40),
  secondary_phone: optionalText(40),
  preferred_contact_method: optionalText(30),
  billing_address: optionalText(200),
  city: optionalText(80),
  state: optionalText(2),
  zip: optionalText(12),
  tags: z.array(z.string().max(40)).max(20).default([]),
  notes: optionalText(4000),
}).refine(v => v.first_name || v.last_name || v.company_name, {
  message: 'Enter at least a name or a company.',
  path: ['first_name'],
})

export const projectVendorSchema = z.object({
  project_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  scope_of_work: optionalText(500),
  start_date: nullableDate,
  end_date: nullableDate,
})

export const taskSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required.').max(200),
  description: optionalText(4000),
  assigned_to: nullableUuid,
  due_date: nullableDate,
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).default('open'),
  related_entity_type: optionalText(30),
  related_entity_id: nullableUuid,
})

export const noteSchema = z.object({
  entity_type: z.string().min(1).max(30),
  entity_id: z.string().uuid(),
  body: z.string().trim().min(1, 'Write something first.').max(8000),
})

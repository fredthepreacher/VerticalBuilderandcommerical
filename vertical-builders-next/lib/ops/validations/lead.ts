import { z } from 'zod'
import { LEAD_STAGES } from '../types'

const trimmed = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), trimmed(max).optional())

/**
 * Public website intake. Deliberately forgiving about optional fields — a lead
 * is worth more than a perfectly shaped record — but strict about the three
 * things the office needs to call someone back, and about length limits so the
 * endpoint cannot be used as free storage.
 */
export const publicLeadSchema = z.object({
  name: trimmed(120).min(1, 'Please enter your name.'),
  email: trimmed(160).email('Please enter a valid email address.'),
  phone: trimmed(40).refine(v => v.replace(/\D/g, '').length >= 10, 'Please enter a valid phone number.'),
  projectType: optionalText(80),
  city: optionalText(80),
  propertyAddress: optionalText(200),
  state: optionalText(2),
  zip: optionalText(12),
  customerType: z.enum(['residential', 'commercial']).optional(),
  preferredContactMethod: optionalText(30),
  timeline: optionalText(60),
  financingInterest: z.coerce.boolean().optional(),
  message: optionalText(4000),
  sourcePage: optionalText(300),
  // marketing attribution — stored in leads.source_metadata
  utmSource: optionalText(120),
  utmMedium: optionalText(120),
  utmCampaign: optionalText(120),
  utmTerm: optionalText(120),
  utmContent: optionalText(120),
  referrer: optionalText(500),
  // honeypot: must be empty. Bots fill it in.
  company: z.string().max(200).optional(),
})

export type PublicLeadInput = z.infer<typeof publicLeadSchema>

/** Internal lead edit (office user), where every field is editable. */
export const leadUpdateSchema = z.object({
  first_name: trimmed(120).min(1),
  last_name: optionalText(120),
  company_name: optionalText(160),
  email: z.preprocess(v => (v === '' ? undefined : v), z.string().email().max(160).optional()),
  phone: optionalText(40),
  preferred_contact_method: optionalText(30),
  customer_type: z.enum(['residential', 'commercial']).optional(),
  service_type: optionalText(80),
  property_address: optionalText(200),
  city: optionalText(80),
  state: optionalText(2),
  zip: optionalText(12),
  project_description: optionalText(4000),
  timeline: optionalText(60),
  financing_interest: z.coerce.boolean().optional(),
  estimated_budget_cents: z.coerce.number().int().nonnegative().nullable().optional(),
  pipeline_stage: z.enum(LEAD_STAGES),
  assigned_to: z.preprocess(v => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  next_follow_up_at: z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional()),
  lost_reason: optionalText(500),
  notes_summary: optionalText(2000),
})

/** Splits "Marie Delacroix" into first/last without losing anything. */
export function splitName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

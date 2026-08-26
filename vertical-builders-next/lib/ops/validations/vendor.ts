import { z } from 'zod'
import { TRADES, VENDOR_STATUSES, VENDOR_TYPES } from '../types'

const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional())

export const vendorSchema = z.object({
  legal_name: z.string().trim().min(1, 'Legal company name is required.').max(200),
  dba: optionalText(200),
  vendor_type: z.enum(VENDOR_TYPES).default('subcontractor'),
  primary_trade: optionalText(80),
  trades: z.array(z.string().max(80)).max(20).default([]),
  status: z.enum(VENDOR_STATUSES).default('pending'),
  contact_first_name: optionalText(80),
  contact_last_name: optionalText(80),
  email: z.preprocess(v => (v === '' ? undefined : v), z.string().email().max(160).optional()),
  phone: optionalText(40),
  secondary_contact: optionalText(200),
  address: optionalText(200),
  city: optionalText(80),
  state: optionalText(2),
  zip: optionalText(12),
  // Only the last four. The MVP deliberately does not store full tax IDs.
  ein_last4: z.preprocess(v => (v === '' ? undefined : v),
    z.string().regex(/^\d{4}$/, 'Enter only the last four digits.').optional()),
  license_number: optionalText(80),
  license_type: optionalText(80),
  license_expiration_date: z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional()),
  w9_status: z.enum(['missing', 'on_file', 'expired']).default('missing'),
  default_requirement_template_id: z.preprocess(v => (v === '' ? null : v),
    z.string().uuid().nullable().optional()),
  notes: optionalText(4000),
})

export type VendorInput = z.infer<typeof vendorSchema>
export const TRADE_OPTIONS = TRADES

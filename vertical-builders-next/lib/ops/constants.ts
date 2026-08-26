/**
 * Values shared between the public website and the CRM.
 *
 * SERVICE_TYPES intentionally mirrors the marketing site's PROJECT_TYPES
 * (lib/data.ts) plus the extra categories the office uses internally, so a lead
 * that arrives from the website already carries a service value the CRM
 * recognises and can filter on.
 */

export const SERVICE_TYPES = [
  'Roofing',
  'Storm Damage / Emergency Tarp',
  'Ceiling / Interior Repair',
  'Water Damage Repair',
  'Kitchen & Bath Remodel',
  'Pool / Lanai / Outdoor Living',
  'Pavers & Concrete',
  'Impact Windows & Doors',
  'New Construction',
  'Additions / ADU',
  'Permitting Help',
  'Commercial',
  'Other',
] as const

export const SERVICE_CATEGORIES = SERVICE_TYPES

export const CONTACT_METHODS = [
  { value: 'phone', label: 'Phone call' },
  { value: 'text', label: 'Text message' },
  { value: 'email', label: 'Email' },
] as const

export const PERMIT_STATUSES = [
  'Not required', 'Preparing application', 'Submitted', 'In review',
  'Revisions requested', 'Issued', 'Inspections in progress', 'Closed',
] as const

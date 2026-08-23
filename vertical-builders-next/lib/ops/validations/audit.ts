import { z } from 'zod'
import { AUDIT_STATUSES, COMPLIANCE_STATUSES, COVERAGE_TYPES, VENDOR_STATUSES } from '../types'

export const auditCycleSchema = z.object({
  name: z.string().trim().min(1, 'Give the audit cycle a name, e.g. "2026 H1 Insurance Audit".').max(160),
  audit_period_start: z.string().min(10, 'Start date is required.'),
  audit_period_end: z.string().min(10, 'End date is required.'),
  due_date: z.preprocess(v => (v === '' ? null : v), z.string().nullable().optional()),
  status: z.enum(AUDIT_STATUSES).default('draft'),
  notes: z.preprocess(v => (v === '' ? undefined : v), z.string().max(4000).optional()),
}).refine(v => v.audit_period_end >= v.audit_period_start, {
  message: 'The end of the audit period must be on or after the start.',
  path: ['audit_period_end'],
})

export const auditFilterSchema = z.object({
  projectIds: z.array(z.string().uuid()).max(200).default([]),
  vendorIds: z.array(z.string().uuid()).max(500).default([]),
  trades: z.array(z.string().max(80)).max(40).default([]),
  vendorStatuses: z.array(z.enum(VENDOR_STATUSES)).default([]),
  complianceStatuses: z.array(z.enum(COMPLIANCE_STATUSES)).default([]),
  coverageTypes: z.array(z.enum(COVERAGE_TYPES)).default([]),
  includeDocuments: z.coerce.boolean().default(true),
})

export type AuditFilters = z.infer<typeof auditFilterSchema>

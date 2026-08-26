/**
 * Vertical Ops — shared domain types.
 * Kept hand-written (rather than generated) so the MVP has no codegen step.
 */

export const USER_ROLES = ['admin', 'office', 'project_manager', 'read_only'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const LEAD_STAGES = [
  'new', 'contact_attempted', 'contacted', 'consultation_scheduled', 'inspection_complete',
  'estimate_in_progress', 'estimate_sent', 'follow_up', 'won', 'lost',
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contact_attempted: 'Contact Attempted',
  contacted: 'Contacted',
  consultation_scheduled: 'Inspection / Consultation Scheduled',
  inspection_complete: 'Inspection Complete',
  estimate_in_progress: 'Estimate In Progress',
  estimate_sent: 'Estimate Sent',
  follow_up: 'Follow-Up',
  won: 'Won',
  lost: 'Lost',
}

export const OPEN_LEAD_STAGES: LeadStage[] = [
  'new', 'contact_attempted', 'contacted', 'consultation_scheduled',
  'inspection_complete', 'estimate_in_progress', 'estimate_sent', 'follow_up',
]

export const PROJECT_STATUSES = [
  'prospect', 'estimate', 'preconstruction', 'permitting', 'scheduled',
  'in_progress', 'on_hold', 'final_walkthrough', 'complete', 'cancelled',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  prospect: 'Prospect',
  estimate: 'Estimate',
  preconstruction: 'Pre-Construction',
  permitting: 'Permitting',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  final_walkthrough: 'Final Walkthrough',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

/** Statuses that mean the project is live work needing compliant vendors. */
export const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [
  'preconstruction', 'permitting', 'scheduled', 'in_progress', 'final_walkthrough',
]

export const VENDOR_STATUSES = ['pending', 'active', 'inactive', 'blocked'] as const
export type VendorStatus = (typeof VENDOR_STATUSES)[number]

export const VENDOR_TYPES = ['subcontractor', 'supplier', 'consultant', 'other'] as const
export type VendorType = (typeof VENDOR_TYPES)[number]

export const TRADES = [
  'Roofing', 'Drywall', 'Framing', 'Electrical', 'Plumbing', 'HVAC', 'Painting',
  'Flooring', 'Concrete', 'Pavers', 'Pool', 'Screen / Lanai', 'Windows / Doors',
  'Engineering', 'Demolition', 'Landscaping', 'General labor', 'Other',
] as const
export type Trade = (typeof TRADES)[number]

export const COVERAGE_TYPES = [
  'general_liability', 'workers_compensation', 'commercial_auto', 'umbrella',
  'professional_liability', 'pollution_liability', 'other',
] as const
export type CoverageType = (typeof COVERAGE_TYPES)[number]

export const COVERAGE_LABELS: Record<CoverageType, string> = {
  general_liability: 'General Liability',
  workers_compensation: 'Workers Compensation',
  commercial_auto: 'Commercial Auto',
  umbrella: 'Umbrella / Excess',
  professional_liability: 'Professional Liability',
  pollution_liability: 'Pollution Liability',
  other: 'Other',
}

export const COVERAGE_SHORT: Record<CoverageType, string> = {
  general_liability: 'GL',
  workers_compensation: 'WC',
  commercial_auto: 'Auto',
  umbrella: 'Umb',
  professional_liability: 'Prof',
  pollution_liability: 'Poll',
  other: 'Other',
}

export const COMPLIANCE_STATUSES = [
  'compliant', 'expiring_soon', 'needs_review', 'missing', 'non_compliant', 'waived',
] as const
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number]

export const COMPLIANCE_LABELS: Record<ComplianceStatus, string> = {
  compliant: 'Compliant',
  expiring_soon: 'Expiring Soon',
  needs_review: 'Needs Review',
  missing: 'Missing',
  non_compliant: 'Non-Compliant',
  waived: 'Waived / Exception',
}

/** Worst-first. Index 0 is the most severe overall outcome. */
export const COMPLIANCE_SEVERITY: ComplianceStatus[] = [
  'non_compliant', 'missing', 'needs_review', 'expiring_soon', 'waived', 'compliant',
]

export const CERTIFICATE_REVIEW_STATUSES = [
  'needs_review', 'approved', 'rejected', 'replaced', 'archived',
] as const
export type CertificateReviewStatus = (typeof CERTIFICATE_REVIEW_STATUSES)[number]

export const DOCUMENT_TYPES = [
  'coi', 'insurance_endorsement', 'workers_comp_exemption', 'w9', 'contractor_license',
  'business_license', 'subcontractor_agreement', 'contract', 'permit', 'inspection',
  'estimate', 'change_order', 'invoice', 'warranty', 'photo', 'audit_package', 'other',
  // Phase 2
  'receipt', 'measurement_report', 'signed_estimate', 'lead_import', 'project_photo',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  coi: 'Certificate of Insurance',
  insurance_endorsement: 'Insurance Endorsement',
  workers_comp_exemption: 'Workers Comp Exemption',
  w9: 'W-9',
  contractor_license: 'Contractor License',
  business_license: 'Business License',
  subcontractor_agreement: 'Subcontractor Agreement',
  contract: 'Contract',
  permit: 'Permit',
  inspection: 'Inspection',
  estimate: 'Estimate',
  change_order: 'Change Order',
  invoice: 'Invoice',
  warranty: 'Warranty',
  photo: 'Photo',
  audit_package: 'Audit Package',
  other: 'Other',
  receipt: 'Receipt',
  measurement_report: 'Roof Measurement Report',
  signed_estimate: 'Signed Estimate',
  lead_import: 'Lead Import File',
  project_photo: 'Project Photo',
}

export const AUDIT_STATUSES = ['draft', 'preparing', 'ready', 'submitted', 'closed'] as const
export type AuditStatus = (typeof AUDIT_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const

export const ENTITY_TYPES = [
  'vendor', 'project', 'contact', 'lead', 'audit', 'estimate', 'invoice',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

// ---------------------------------------------------------------------------
// Row shapes (only the columns the app actually reads)
// ---------------------------------------------------------------------------

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  phone: string | null
  active: boolean
  created_at: string
}

export interface AppSettings {
  id: string
  warning_window_days: number
  reminder_thresholds: number[]
  company_name: string
  company_email: string
  company_phone: string
  max_upload_mb: number
  upload_token_ttl_days: number
  // ---- Phase 2 ----
  estimate_number_prefix: string
  estimate_valid_days: number
  estimate_default_notes: string | null
  estimate_tax_enabled: boolean
  estimate_default_tax_percent: number
  invoice_number_prefix: string
  invoice_due_days: number
  roof_measurement_provider: string
  online_payments_enabled: boolean
  allowed_payment_methods: string[]
  schedule_work_days: number[]
  costs_visible_to_pm: boolean
  profit_visible_to_pm: boolean
  ai_copilot_enabled: boolean
  ai_coi_extraction_enabled: boolean
  ai_dashboard_brief_enabled: boolean
}

export interface Vendor {
  id: string
  legal_name: string
  dba: string | null
  vendor_type: VendorType
  primary_trade: string | null
  trades: string[]
  status: VendorStatus
  contact_first_name: string | null
  contact_last_name: string | null
  email: string | null
  phone: string | null
  secondary_contact: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  ein_last4: string | null
  license_number: string | null
  license_type: string | null
  license_expiration_date: string | null
  w9_status: string
  default_requirement_template_id: string | null
  notes: string | null
  compliance_status: ComplianceStatus
  compliance_checked_at: string | null
  earliest_expiration_date: string | null
  last_reviewed_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface InsurancePolicy {
  id: string
  certificate_id: string
  coverage_type: CoverageType
  carrier: string | null
  naic: string | null
  policy_number: string | null
  effective_date: string | null
  expiration_date: string | null
  limits_json: Record<string, number | boolean>
  additional_insured: boolean | null
  waiver_of_subrogation: boolean | null
  primary_noncontributory: boolean | null
  claims_made: boolean | null
  occurrence_form: boolean | null
  notes: string | null
}

export interface InsuranceCertificate {
  id: string
  vendor_id: string
  document_id: string | null
  received_at: string
  issue_date: string | null
  broker_name: string | null
  broker_contact_name: string | null
  broker_email: string | null
  broker_phone: string | null
  named_insured: string | null
  certificate_holder: string | null
  source: 'admin_upload' | 'vendor_portal' | 'email_manual'
  review_status: CertificateReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_notes: string | null
  replaced_certificate_id: string | null
  version: number
  created_at: string
  insurance_policies?: InsurancePolicy[]
}

export interface InsuranceRequirement {
  id: string
  template_id: string
  coverage_type: CoverageType
  required: boolean
  min_limit_each_occurrence: number | null
  min_limit_aggregate: number | null
  min_combined_single_limit: number | null
  min_workers_comp_el: number | null
  additional_insured_required: boolean
  waiver_of_subrogation_required: boolean
  primary_noncontributory_required: boolean
  endorsement_required: boolean
  notes: string | null
}

export interface RequirementTemplate {
  id: string
  name: string
  scope: 'global' | 'trade' | 'project'
  trade: string | null
  project_id: string | null
  active: boolean
  disclaimer: string | null
  insurance_requirements?: InsuranceRequirement[]
}

export interface ComplianceWaiver {
  id: string
  vendor_id: string
  project_id: string | null
  coverage_type: CoverageType | null
  requirement_id: string | null
  reason: string
  approved_by: string
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

export const COMPLIANCE_DISCLAIMER =
  'This system organizes insurance documentation and configured requirements. ' +
  'Final coverage/contract interpretation should be reviewed by the company’s insurance/risk professional.'

// ===========================================================================
// PHASE 2 — operations platform (estimating, scheduling, financials)
// ===========================================================================

export const ESTIMATE_STATUSES = [
  'draft', 'ai_draft', 'measuring', 'ready_for_review', 'sent', 'viewed',
  'approved', 'declined', 'expired', 'converted',
] as const
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number]

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft',
  ai_draft: 'AI Draft',
  measuring: 'Measuring',
  ready_for_review: 'Ready for Review',
  sent: 'Sent',
  viewed: 'Viewed',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  converted: 'Converted to Job',
}

/** Statuses that still count as live opportunity value on the dashboard. */
export const OPEN_ESTIMATE_STATUSES: EstimateStatus[] = [
  'draft', 'ai_draft', 'measuring', 'ready_for_review', 'sent', 'viewed',
]

/**
 * An AI draft can never jump straight to Sent. A person must move it through
 * Ready for Review first, which is the gate that guarantees human sign-off.
 */
export const HUMAN_REVIEW_REQUIRED_FROM: EstimateStatus[] = ['ai_draft', 'measuring']

export const UNITS = [
  'EA', 'SQ', 'SF', 'LF', 'HR', 'DAY', 'LS', 'CU YD', 'GAL', 'TON', 'ROLL', 'BDL', 'OTHER',
] as const
export type Unit = (typeof UNITS)[number]

export const UNIT_LABELS: Record<Unit, string> = {
  EA: 'each', SQ: 'square (100 sf)', SF: 'square foot', LF: 'linear foot',
  HR: 'hour', DAY: 'day', LS: 'lump sum', 'CU YD': 'cubic yard', GAL: 'gallon',
  TON: 'ton', ROLL: 'roll', BDL: 'bundle', OTHER: 'other',
}

export const COST_CATEGORIES = [
  'labor', 'materials', 'subcontractor', 'equipment', 'permit_fees', 'disposal', 'delivery', 'other',
] as const
export type CostCategory = (typeof COST_CATEGORIES)[number]

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  labor: 'Labor',
  materials: 'Materials',
  subcontractor: 'Subcontractor',
  equipment: 'Equipment',
  permit_fees: 'Permit / Fees',
  disposal: 'Disposal',
  delivery: 'Delivery',
  other: 'Other',
}

export const INVOICE_STATUSES = [
  'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void',
] as const
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatusValue, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

export const INVOICE_TYPES = ['standard', 'deposit', 'progress', 'final'] as const
export type InvoiceType = (typeof INVOICE_TYPES)[number]

export const PAYMENT_METHODS = ['card', 'ach', 'check', 'cash', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Card',
  ach: 'ACH / bank transfer',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
}

/** Methods the office records by hand — always available, provider or not. */
export const MANUAL_PAYMENT_METHODS: PaymentMethod[] = ['check', 'cash', 'other']

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'refunded', 'void'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PHOTO_PHASES = [
  'before', 'during', 'after', 'inspection', 'damage', 'progress', 'completion', 'other',
] as const
export type PhotoPhase = (typeof PHOTO_PHASES)[number]

export const PHOTO_PHASE_LABELS: Record<PhotoPhase, string> = {
  before: 'Before',
  during: 'During',
  after: 'After',
  inspection: 'Inspection',
  damage: 'Damage',
  progress: 'Progress',
  completion: 'Completion',
  other: 'Other',
}

export const ESTIMATE_PHOTO_TYPES = [
  'inspection', 'roof', 'interior', 'exterior', 'damage', 'measurement', 'other',
] as const
export type EstimatePhotoType = (typeof ESTIMATE_PHOTO_TYPES)[number]

export const AGREEMENT_STATUSES = ['missing', 'sent', 'signed', 'expired', 'superseded'] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  missing: 'Missing',
  sent: 'Sent — awaiting signature',
  signed: 'Signed',
  expired: 'Expired',
  superseded: 'Superseded',
}

export const MEASUREMENT_PROVIDERS = [
  'manual', 'uploaded_report', 'eagleview', 'nearmap', 'other',
] as const
export type MeasurementProviderName = (typeof MEASUREMENT_PROVIDERS)[number]

export const MEASUREMENT_PROVIDER_LABELS: Record<MeasurementProviderName, string> = {
  manual: 'Manual entry',
  uploaded_report: 'Uploaded third-party report',
  eagleview: 'EagleView',
  nearmap: 'Nearmap',
  other: 'Other provider',
}

export const MEASUREMENT_STATUSES = [
  'requested', 'processing', 'complete', 'failed', 'cancelled',
] as const
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number]

export const IMPORT_STATUSES = [
  'pending', 'validating', 'importing', 'completed', 'completed_with_errors', 'failed', 'cancelled',
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

export const DUPLICATE_STRATEGIES = ['skip', 'update', 'import_anyway'] as const
export type DuplicateStrategy = (typeof DUPLICATE_STRATEGIES)[number]

export const DUPLICATE_STRATEGY_LABELS: Record<DuplicateStrategy, string> = {
  skip: 'Skip duplicates — keep the existing lead untouched',
  update: 'Update existing — fill in blank fields on the existing lead',
  import_anyway: 'Import anyway — create a second record',
}

// ---------------------------------------------------------------------------
// Phase 2 row shapes
// ---------------------------------------------------------------------------

export interface PricebookItem {
  id: string
  name: string
  category: string | null
  service_type: string | null
  description: string | null
  unit: Unit
  default_unit_price_cents: number
  default_material_cost_cents: number | null
  default_labor_cost_cents: number | null
  active: boolean
  tags: string[]
}

export interface EstimateLineItem {
  id: string
  estimate_id: string
  sort_order: number
  category: string | null
  description: string
  quantity: number
  unit: string
  unit_price_cents: number
  labor_cost_cents: number | null
  material_cost_cents: number | null
  markup_percent: number | null
  line_total_cents: number
  pricebook_item_id: string | null
  source: 'manual' | 'pricebook' | 'ai' | 'measurement' | 'import'
  ai_generated: boolean
  needs_review: boolean
  notes: string | null
}

export interface Estimate {
  id: string
  estimate_number: string
  lead_id: string | null
  contact_id: string | null
  project_id: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  service_type: string | null
  title: string
  scope_summary: string | null
  status: EstimateStatus
  subtotal_cents: number
  discount_cents: number
  tax_percent: number
  tax_cents: number
  total_cents: number
  valid_until: string | null
  customer_notes: string | null
  internal_notes: string | null
  decline_reason: string | null
  created_by: string | null
  assigned_to: string | null
  sent_at: string | null
  viewed_at: string | null
  approved_at: string | null
  declined_at: string | null
  converted_project_id: string | null
  ai_metadata_json: Record<string, unknown>
  archived_at: string | null
  created_at: string
  updated_at: string
  estimate_line_items?: EstimateLineItem[]
}

export interface RoofMeasurement {
  id: string
  project_id: string | null
  estimate_id: string | null
  address: string
  provider: MeasurementProviderName
  external_request_id: string | null
  external_report_id: string | null
  status: MeasurementStatus
  failure_reason: string | null
  roof_area_sqft: number | null
  roof_area_squares: number | null
  primary_pitch: string | null
  facet_count: number | null
  ridge_lf: number | null
  hip_lf: number | null
  valley_lf: number | null
  eave_lf: number | null
  rake_lf: number | null
  waste_factor_percent: number | null
  notes: string | null
  source_document_id: string | null
  requested_at: string | null
  completed_at: string | null
  created_at: string
}

export interface Invoice {
  id: string
  invoice_number: string
  project_id: string
  contact_id: string | null
  estimate_id: string | null
  invoice_type: InvoiceType
  status: InvoiceStatusValue
  issue_date: string
  due_date: string | null
  subtotal_cents: number
  discount_cents: number
  tax_percent: number
  tax_cents: number
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  notes: string | null
  customer_message: string | null
  sent_at: string | null
  paid_at: string | null
  voided_at: string | null
  void_reason: string | null
  created_at: string
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  sort_order: number
  description: string
  quantity: number
  unit: string | null
  unit_price_cents: number
  line_total_cents: number
  estimate_line_item_id: string | null
}

export interface Payment {
  id: string
  invoice_id: string
  project_id: string
  amount_cents: number
  method: PaymentMethod
  status: PaymentStatus
  provider: string | null
  provider_payment_id: string | null
  check_number: string | null
  reference_number: string | null
  received_date: string | null
  recorded_by: string | null
  refunded_amount_cents: number
  notes: string | null
  created_at: string
}

export interface JobCost {
  id: string
  project_id: string
  category: CostCategory
  vendor_id: string | null
  description: string
  amount_cents: number
  cost_date: string
  document_id: string | null
  entered_by: string | null
  notes: string | null
  created_at: string
}

export interface SubcontractorAgreement {
  id: string
  vendor_id: string
  status: AgreementStatus
  effective_date: string | null
  expiration_date: string | null
  signed_date: string | null
  document_id: string | null
  version: number
  supersedes_id: string | null
  notes: string | null
  created_at: string
}

export const AI_ESTIMATE_DISCLAIMER =
  'AI drafts are a starting point, not a quote. Every line must be reviewed and ' +
  'priced by a person before this estimate can be sent to a customer.'

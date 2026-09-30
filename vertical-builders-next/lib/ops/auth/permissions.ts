import type { UserRole } from '../types'

/**
 * Role capability matrix (spec §7). Server-side only — the UI hides things it
 * cannot do, but every mutation re-checks with `assertCan` before it runs.
 */
export const CAPABILITIES = {
  manageUsers:            ['admin'],
  manageSettings:         ['admin', 'office'],
  manageRequirements:     ['admin', 'office'],   // system-wide insurance rules
  approveWaiver:          ['admin', 'office'],
  reviewCertificate:      ['admin', 'office'],
  requestRenewal:         ['admin', 'office'],
  generateAuditPackage:   ['admin', 'office'],
  manageAuditCycles:      ['admin', 'office'],
  writeRecords:           ['admin', 'office', 'project_manager'],
  uploadDocuments:        ['admin', 'office', 'project_manager'],
  assignVendorToProject:  ['admin', 'office', 'project_manager'],
  downloadDocuments:      ['admin', 'office', 'project_manager', 'read_only'],
  readRecords:            ['admin', 'office', 'project_manager', 'read_only'],

  // ---- Phase 2 -----------------------------------------------------------
  // Estimating. A PM can build and edit an estimate but not put it in front of
  // a customer — sending is a commercial commitment.
  estimatesView:          ['admin', 'office', 'project_manager', 'read_only'],
  estimatesCreate:        ['admin', 'office', 'project_manager'],
  estimatesEdit:          ['admin', 'office', 'project_manager'],
  estimatesSend:          ['admin', 'office'],
  estimatesBatchExport:   ['admin', 'office', 'project_manager'],
  estimatesConvert:       ['admin', 'office'],
  pricebookManage:        ['admin', 'office'],
  aiGenerate:             ['admin', 'office', 'project_manager'],

  measurementsView:       ['admin', 'office', 'project_manager', 'read_only'],
  measurementsCreate:     ['admin', 'office', 'project_manager'],
  measurementsOrder:      ['admin', 'office'],   // costs money per report

  leadsImport:            ['admin', 'office'],
  prospectingManage:      ['admin', 'office'],

  scheduleView:           ['admin', 'office', 'project_manager', 'read_only'],
  scheduleEdit:           ['admin', 'office', 'project_manager'],

  photosView:             ['admin', 'office', 'project_manager', 'read_only'],
  photosUpload:           ['admin', 'office', 'project_manager'],

  agreementsView:         ['admin', 'office', 'project_manager', 'read_only'],
  agreementsManage:       ['admin', 'office'],

  // Money. Creating and voiding invoices is office work, not field work.
  invoicesView:           ['admin', 'office', 'project_manager', 'read_only'],
  invoicesCreate:         ['admin', 'office'],
  invoicesEdit:           ['admin', 'office'],
  invoicesVoid:           ['admin', 'office'],
  paymentsRecord:         ['admin', 'office'],
  paymentsRefund:         ['admin'],

  // Cost entry and margin visibility are separate decisions: a PM may be
  // trusted to log a material receipt without being shown company margin.
  // Both are additionally gated by app_settings and enforced in RLS.
  // The auditor/read-only role is deliberately blind to money the company makes.
  // It exists so an insurance auditor or an outside reviewer can verify COIs and
  // compliance history without also being handed the job margins. Removing
  // 'read_only' here is only half the control — can_view_costs() and
  // can_view_profit() in migration 0009 are the enforcement boundary.
  costsView:              ['admin', 'office', 'project_manager'],
  costsEdit:              ['admin', 'office', 'project_manager'],
  profitabilityView:      ['admin', 'office', 'project_manager'],
} as const satisfies Record<string, readonly UserRole[]>

export type Capability = keyof typeof CAPABILITIES

export function can(role: UserRole | null | undefined, capability: Capability): boolean {
  if (!role) return false
  return (CAPABILITIES[capability] as readonly string[]).includes(role)
}

export class PermissionError extends Error {
  constructor(capability: Capability) {
    super(`Your role does not allow this action (${capability}).`)
    this.name = 'PermissionError'
  }
}

export function assertCan(role: UserRole | null | undefined, capability: Capability): void {
  if (!can(role, capability)) throw new PermissionError(capability)
}


/**
 * Two capabilities are not decided by role alone — the company chooses whether
 * project managers see costs and margin. The role matrix above is the ceiling;
 * these settings can only narrow it, never widen it.
 *
 * This mirrors can_view_costs() / can_view_profit() in migration 0006, so the
 * UI and the database agree. RLS remains the enforcement point.
 */
export interface FinancialVisibilitySettings {
  costs_visible_to_pm: boolean
  profit_visible_to_pm: boolean
}

export function canViewCosts(
  role: UserRole | null | undefined,
  settings: FinancialVisibilitySettings,
): boolean {
  if (!can(role, 'costsView')) return false
  if (role === 'project_manager') return settings.costs_visible_to_pm
  return true
}

export function canViewProfit(
  role: UserRole | null | undefined,
  settings: FinancialVisibilitySettings,
): boolean {
  if (!can(role, 'profitabilityView')) return false
  if (role === 'project_manager') return settings.profit_visible_to_pm
  return true
}

import 'server-only'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COMPLIANCE_LABELS,
  COVERAGE_LABELS,
  DOCUMENT_TYPE_LABELS,
  type CoverageType,
  type DocumentType,
  type InsuranceCertificate,
  type InsurancePolicy,
  type Vendor,
} from '../types'
import { overlapsPeriod, toIsoDate } from '../utils/dates'
import { formatLimit } from '../utils/money'
import { toCsv, yesNo } from '../utils/csv'
import { sanitizeFilename, sanitizeFolderName } from '../utils/files'
import type { AuditFilters } from '../validations/audit'
import { evaluateVendorContext, loadVendorComplianceContext } from './compliance'
import { downloadToBuffer, uploadGeneratedFile } from './documents'
import { ACTION_LABELS, logActivity } from './activity'

/**
 * ============================================================================
 * AUDIT CENTER
 * ----------------------------------------------------------------------------
 * The company is audited roughly every six months. The question an auditor
 * actually asks is not "is this vendor insured today?" but "was this vendor
 * insured while they were on your job, during this window?".
 *
 * So every query here is period-aware:
 *   * a certificate counts if any of its policy lines OVERLAPPED the window
 *   * a vendor counts if they were assigned to a project during the window
 *   * compliance is re-evaluated AS OF the end of the window, not as of today
 *
 * Old exports are never overwritten. Each generation writes a new object and a
 * new audit_exports row, so a package handed to an auditor in March still
 * downloads byte-identical in September.
 * ============================================================================
 */

export interface AuditCycle {
  id: string
  name: string
  audit_period_start: string
  audit_period_end: string
  due_date: string | null
  status: string
  notes: string | null
  created_at: string
}

export interface AuditVendorRow {
  vendor: Vendor
  certificates: InsuranceCertificate[]
  policiesInPeriod: InsurancePolicy[]
  projects: { id: string; project_number: string; project_name: string; scope: string | null; start: string | null; end: string | null }[]
  documents: { id: string; document_type: DocumentType; original_filename: string; storage_path: string; document_date: string | null; expiration_date: string | null }[]
  statusAtPeriodEnd: string
  statusToday: string
  gaps: string[]
  reviewer: string | null
  exceptions: { reason: string; expires_at: string | null; coverage_type: string | null }[]
  coverageSummary: Partial<Record<CoverageType, { carrier: string | null; policy: string | null; effective: string | null; expiration: string | null; limits: string; covered: boolean }>>
}

export interface AuditPackageSummary {
  vendorsIncluded: number
  projectsIncluded: number
  compliant: number
  expired: number
  missing: number
  needsReview: number
  waived: number
  certificatesIncluded: number
  policyLinesIncluded: number
  documentsIncluded: number
  documentsUnavailable: number
}

// Serverless memory guards.
const MAX_DOCUMENTS_IN_PACKAGE = 400
const MAX_PACKAGE_BYTES = 180 * 1024 * 1024

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

export async function getAuditCycle(
  supabase: SupabaseClient,
  auditCycleId: string,
): Promise<AuditCycle | null> {
  const { data } = await supabase.from('audit_cycles').select('*').eq('id', auditCycleId).maybeSingle()
  return (data as AuditCycle | null) ?? null
}

/**
 * Which vendors are relevant to this window?
 *
 * A vendor is in scope if EITHER
 *   a) they were assigned to a project overlapping the period, OR
 *   b) they hold a certificate whose coverage overlapped the period,
 * because an auditor cares about both "who worked" and "what was on file".
 */
export async function getVendorsRelevantToPeriod(
  supabase: SupabaseClient,
  period: { start: string; end: string },
  filters: Partial<AuditFilters> = {},
): Promise<string[]> {
  const ids = new Set<string>()

  // (a) assignments overlapping the window
  const { data: assignments } = await supabase
    .from('project_vendors')
    .select('vendor_id, project_id, start_date, end_date')

  for (const row of assignments ?? []) {
    if (filters.projectIds?.length && !filters.projectIds.includes(row.project_id as string)) continue
    // A null start/end means "no bounds recorded" — treat as overlapping so a
    // vendor is never silently dropped from an audit because of missing dates.
    if (overlapsPeriod(row.start_date as string | null, row.end_date as string | null, period.start, period.end)) {
      ids.add(row.vendor_id as string)
    }
  }

  // (b) coverage overlapping the window
  const { data: policies } = await supabase
    .from('insurance_policies')
    .select('effective_date, expiration_date, insurance_certificates!inner(vendor_id)')
    .lte('effective_date', period.end)
    .gte('expiration_date', period.start)

  for (const row of (policies ?? []) as unknown as { insurance_certificates: { vendor_id: string } | null }[]) {
    const vendorId = row.insurance_certificates?.vendor_id
    if (vendorId) ids.add(vendorId)
  }

  let list = Array.from(ids)
  if (filters.vendorIds?.length) list = list.filter(id => filters.vendorIds!.includes(id))
  return list
}

export async function buildAuditRows(
  supabase: SupabaseClient,
  cycle: AuditCycle,
  filters: Partial<AuditFilters> = {},
): Promise<AuditVendorRow[]> {
  const period = { start: cycle.audit_period_start, end: cycle.audit_period_end }
  const vendorIds = await getVendorsRelevantToPeriod(supabase, period, filters)
  const asOfPeriodEnd = new Date(`${period.end}T00:00:00Z`)

  const rows: AuditVendorRow[] = []

  for (const vendorId of vendorIds) {
    // includeHistorical: replaced/archived certificates are exactly what an
    // audit needs — they are the record of what was on file at the time.
    const ctx = await loadVendorComplianceContext(supabase, vendorId, { includeHistorical: true })
    if (!ctx) continue
    const vendor = ctx.vendor

    if (filters.trades?.length && !filters.trades.includes(vendor.primary_trade ?? '')) continue
    if (filters.vendorStatuses?.length && !filters.vendorStatuses.includes(vendor.status)) continue

    const certificates = ctx.certificates.filter(cert =>
      (cert.insurance_policies ?? []).some(p =>
        overlapsPeriod(p.effective_date, p.expiration_date, period.start, period.end)),
    )

    let policiesInPeriod = ctx.certificates
      .flatMap(c => c.insurance_policies ?? [])
      .filter(p => overlapsPeriod(p.effective_date, p.expiration_date, period.start, period.end))

    if (filters.coverageTypes?.length) {
      policiesInPeriod = policiesInPeriod.filter(p => filters.coverageTypes!.includes(p.coverage_type))
    }

    // Compliance as of the END of the audit period — the honest answer to
    // "were they covered during the window", not "are they covered now".
    const atPeriodEnd = evaluateVendorContext(
      { ...ctx, policies: ctx.certificates.flatMap(c => c.insurance_policies ?? []) },
      { asOfDate: asOfPeriodEnd },
    )
    const today = evaluateVendorContext(ctx, {})

    if (filters.complianceStatuses?.length && !filters.complianceStatuses.includes(atPeriodEnd.status)) continue

    const { data: assignments } = await supabase
      .from('project_vendors')
      .select('scope_of_work, start_date, end_date, projects(id, project_number, project_name)')
      .eq('vendor_id', vendorId)

    const projects: AuditVendorRow['projects'] = []
    for (const a of (assignments ?? []) as unknown as RawAssignment[]) {
      if (!overlapsPeriod(a.start_date, a.end_date, period.start, period.end)) continue
      const project = Array.isArray(a.projects) ? a.projects[0] : a.projects
      if (!project) continue
      if (filters.projectIds?.length && !filters.projectIds.includes(project.id)) continue
      projects.push({
        id: project.id,
        project_number: project.project_number,
        project_name: project.project_name,
        scope: a.scope_of_work,
        start: a.start_date,
        end: a.end_date,
      })
    }

    const { data: docs } = await supabase
      .from('documents')
      .select('id, document_type, original_filename, storage_path, document_date, expiration_date')
      .eq('entity_type', 'vendor')
      .eq('entity_id', vendorId)
      .order('uploaded_at', { ascending: false })

    const reviewedCert = ctx.certificates.find(c => c.reviewed_at)

    rows.push({
      vendor,
      certificates,
      policiesInPeriod,
      projects,
      documents: (docs ?? []) as AuditVendorRow['documents'],
      statusAtPeriodEnd: atPeriodEnd.status,
      statusToday: today.status,
      gaps: atPeriodEnd.checks
        .filter(c => c.status !== 'pass')
        .flatMap(c => c.reasons.map(r => `${c.coverageLabel}: ${r}`)),
      reviewer: reviewedCert?.reviewed_at ? toIsoDate(reviewedCert.reviewed_at) : null,
      exceptions: ctx.waivers.map(w => ({
        reason: w.reason,
        expires_at: w.expires_at,
        coverage_type: w.coverage_type,
      })),
      coverageSummary: summarizeCoverage(policiesInPeriod, period),
    })
  }

  rows.sort((a, b) => a.vendor.legal_name.localeCompare(b.vendor.legal_name))
  return rows
}

interface RawAssignment {
  scope_of_work: string | null
  start_date: string | null
  end_date: string | null
  projects:
    | { id: string; project_number: string; project_name: string }
    | { id: string; project_number: string; project_name: string }[]
    | null
}

function summarizeCoverage(
  policies: InsurancePolicy[],
  period: { start: string; end: string },
): AuditVendorRow['coverageSummary'] {
  const out: AuditVendorRow['coverageSummary'] = {}
  for (const p of policies) {
    const existing = out[p.coverage_type]
    // Keep the policy that covers the most of the window (latest expiration).
    if (existing && existing.expiration && p.expiration_date && existing.expiration >= p.expiration_date) continue
    out[p.coverage_type] = {
      carrier: p.carrier,
      policy: p.policy_number,
      effective: p.effective_date,
      expiration: p.expiration_date,
      limits: describeLimits(p),
      covered: overlapsPeriod(p.effective_date, p.expiration_date, period.start, period.end),
    }
  }
  return out
}

export function describeLimits(policy: InsurancePolicy): string {
  const l = policy.limits_json ?? {}
  const bits: string[] = []
  const push = (label: string, key: string) => {
    const v = l[key]
    if (typeof v === 'number') bits.push(`${label} ${formatLimit(v)}`)
  }
  push('Each occ.', 'each_occurrence')
  push('Aggregate', 'general_aggregate')
  push('Aggregate', 'aggregate')
  push('Products/Comp-Ops', 'products_completed_ops_aggregate')
  push('CSL', 'combined_single_limit')
  push('EL each accident', 'el_each_accident')
  push('EL disease/employee', 'el_disease_each_employee')
  push('EL disease/policy', 'el_disease_policy_limit')
  if (l.statutory === true) bits.unshift('Statutory')
  return bits.join(' · ') || 'Not recorded'
}

// ---------------------------------------------------------------------------
// Register / exception / activity tables
// ---------------------------------------------------------------------------

const REGISTER_HEADERS = [
  'Subcontractor', 'DBA', 'Trade', 'Vendor Status', 'Projects In Period',
  'Status At Period End', 'Status Today',
  'GL Carrier', 'GL Policy #', 'GL Effective', 'GL Expiration', 'GL Limits', 'GL Covered Period',
  'WC Carrier', 'WC Policy #', 'WC Effective', 'WC Expiration', 'WC Limits', 'WC Covered Period',
  'Auto Carrier', 'Auto Policy #', 'Auto Effective', 'Auto Expiration', 'Auto Limits', 'Auto Covered Period',
  'Umbrella Carrier', 'Umbrella Policy #', 'Umbrella Effective', 'Umbrella Expiration', 'Umbrella Limits', 'Umbrella Covered Period',
  'Additional Insured (GL)', 'Waiver of Subrogation (GL)', 'Primary / Non-Contributory (GL)',
  'License #', 'License Expiration', 'W-9 On File',
  'Certificates In Period', 'Policy Lines In Period', 'Documents On File',
  'Last Reviewed', 'Exceptions', 'Gaps / Notes',
]

export function buildRegisterRows(rows: AuditVendorRow[]): unknown[][] {
  return rows.map(row => {
    const cov = (type: CoverageType) => row.coverageSummary[type]
    const gl = cov('general_liability')
    const glPolicy = row.policiesInPeriod.find(p => p.coverage_type === 'general_liability')
    const cells: unknown[] = [
      row.vendor.legal_name,
      row.vendor.dba ?? '',
      row.vendor.primary_trade ?? '',
      row.vendor.status,
      row.projects.map(p => `${p.project_number} ${p.project_name}`).join(' | '),
      COMPLIANCE_LABELS[row.statusAtPeriodEnd as keyof typeof COMPLIANCE_LABELS] ?? row.statusAtPeriodEnd,
      COMPLIANCE_LABELS[row.statusToday as keyof typeof COMPLIANCE_LABELS] ?? row.statusToday,
    ]
    for (const type of ['general_liability', 'workers_compensation', 'commercial_auto', 'umbrella'] as CoverageType[]) {
      const c = cov(type)
      cells.push(c?.carrier ?? '', c?.policy ?? '', c?.effective ?? '', c?.expiration ?? '', c?.limits ?? 'Not on file', c ? yesNo(c.covered) : 'No')
    }
    cells.push(
      yesNo(glPolicy?.additional_insured ?? null),
      yesNo(glPolicy?.waiver_of_subrogation ?? null),
      yesNo(glPolicy?.primary_noncontributory ?? null),
      row.vendor.license_number ?? '',
      row.vendor.license_expiration_date ?? '',
      row.vendor.w9_status === 'on_file' ? 'Yes' : 'No',
      row.certificates.length,
      row.policiesInPeriod.length,
      row.documents.length,
      row.reviewer ?? 'Not reviewed',
      row.exceptions.map(e => e.reason).join(' | '),
      row.gaps.join(' | '),
    )
    void gl
    return cells
  })
}

export function buildExceptionRows(rows: AuditVendorRow[]): { headers: string[]; rows: unknown[][] } {
  const headers = ['Subcontractor', 'Trade', 'Issue Type', 'Coverage', 'Detail', 'Projects In Period', 'Status At Period End']
  const out: unknown[][] = []
  for (const row of rows) {
    for (const gap of row.gaps) {
      const [coverage, ...rest] = gap.split(': ')
      out.push([
        row.vendor.legal_name,
        row.vendor.primary_trade ?? '',
        'Gap',
        coverage,
        rest.join(': '),
        row.projects.map(p => p.project_number).join(' | '),
        COMPLIANCE_LABELS[row.statusAtPeriodEnd as keyof typeof COMPLIANCE_LABELS] ?? row.statusAtPeriodEnd,
      ])
    }
    for (const exception of row.exceptions) {
      out.push([
        row.vendor.legal_name,
        row.vendor.primary_trade ?? '',
        'Documented exception',
        exception.coverage_type ? COVERAGE_LABELS[exception.coverage_type as CoverageType] : 'All',
        exception.reason + (exception.expires_at ? ` (expires ${exception.expires_at})` : ''),
        row.projects.map(p => p.project_number).join(' | '),
        COMPLIANCE_LABELS[row.statusAtPeriodEnd as keyof typeof COMPLIANCE_LABELS] ?? row.statusAtPeriodEnd,
      ])
    }
  }
  return { headers, rows: out }
}

async function buildActivityCsv(supabase: SupabaseClient, cycle: AuditCycle): Promise<string> {
  const { data } = await supabase
    .from('activity_log')
    .select('created_at, action, entity_type, entity_id, actor_label, metadata_json, profiles:actor_user_id(full_name, email)')
    .gte('created_at', `${cycle.audit_period_start}T00:00:00Z`)
    .lte('created_at', `${cycle.audit_period_end}T23:59:59Z`)
    .order('created_at', { ascending: true })
    .limit(5000)

  const rows = (data ?? []).map(r => {
    const profile = (r as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles
    return [
      r.created_at,
      ACTION_LABELS[r.action as string] ?? r.action,
      r.entity_type,
      r.entity_id,
      profile?.full_name ?? profile?.email ?? (r.actor_label as string | null) ?? 'System',
      JSON.stringify(r.metadata_json ?? {}),
    ]
  })
  return toCsv(['Timestamp (UTC)', 'Action', 'Entity Type', 'Entity Id', 'Actor', 'Details'], rows)
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/**
 * Excel workbook via ExcelJS.
 *
 * The spec suggested the `xlsx` npm package; ExcelJS is used instead because
 * the SheetJS npm distribution is deprecated and carries a published advisory.
 * The output is the same .xlsx file an auditor expects.
 */
async function buildWorkbook(
  cycle: AuditCycle,
  rows: AuditVendorRow[],
  summary: AuditPackageSummary,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Vertical Ops — Vertical Builders & Commercial'
  wb.created = new Date()

  // --- Summary sheet -------------------------------------------------------
  const overview = wb.addWorksheet('Summary')
  overview.columns = [{ width: 38 }, { width: 60 }]
  const title = overview.addRow(['Vertical Builders & Commercial'])
  title.font = { bold: true, size: 16 }
  overview.addRow([cycle.name]).font = { bold: true, size: 12 }
  overview.addRow([])
  const facts: [string, string | number][] = [
    ['Audit period', `${cycle.audit_period_start} to ${cycle.audit_period_end}`],
    ['Generated', new Date().toISOString()],
    ['Subcontractors included', summary.vendorsIncluded],
    ['Projects included', summary.projectsIncluded],
    ['Compliant at period end', summary.compliant],
    ['Non-compliant / expired', summary.expired],
    ['Missing coverage', summary.missing],
    ['Needs review', summary.needsReview],
    ['Documented exceptions (waived)', summary.waived],
    ['Certificates included', summary.certificatesIncluded],
    ['Policy lines included', summary.policyLinesIncluded],
    ['Documents included', summary.documentsIncluded],
  ]
  for (const [k, v] of facts) {
    const r = overview.addRow([k, v])
    r.getCell(1).font = { bold: true }
  }
  overview.addRow([])
  const disclaimer = overview.addRow([
    'Note',
    'This package organizes insurance documentation and the requirements configured in Vertical Ops. ' +
    'Final coverage and contract interpretation should be reviewed by the company’s insurance/risk professional.',
  ])
  disclaimer.getCell(1).font = { bold: true }
  disclaimer.getCell(2).alignment = { wrapText: true }

  // --- Register sheet ------------------------------------------------------
  const register = wb.addWorksheet('Compliance Register', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  register.addRow(REGISTER_HEADERS)
  register.getRow(1).font = { bold: true }
  register.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10161D' } }
  register.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  for (const row of buildRegisterRows(rows)) register.addRow(row)
  register.columns.forEach(col => { col.width = 22 })
  register.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: REGISTER_HEADERS.length } }

  // --- Exceptions sheet ----------------------------------------------------
  const exceptions = wb.addWorksheet('Missing & Expired')
  const ex = buildExceptionRows(rows)
  exceptions.addRow(ex.headers)
  exceptions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  exceptions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8C2317' } }
  for (const row of ex.rows) exceptions.addRow(row)
  exceptions.columns.forEach(col => { col.width = 28 })

  // --- Policy detail sheet -------------------------------------------------
  const detail = wb.addWorksheet('Policy Lines')
  detail.addRow([
    'Subcontractor', 'Coverage', 'Carrier', 'NAIC', 'Policy #', 'Effective', 'Expiration',
    'Limits', 'Additional Insured', 'Waiver of Subrogation', 'Primary / Non-Contributory',
    'Occurrence Form', 'Claims Made', 'Overlapped Audit Period',
  ])
  detail.getRow(1).font = { bold: true }
  for (const row of rows) {
    for (const p of row.policiesInPeriod) {
      detail.addRow([
        row.vendor.legal_name,
        COVERAGE_LABELS[p.coverage_type],
        p.carrier ?? '',
        p.naic ?? '',
        p.policy_number ?? '',
        p.effective_date ?? '',
        p.expiration_date ?? '',
        describeLimits(p),
        yesNo(p.additional_insured),
        yesNo(p.waiver_of_subrogation),
        yesNo(p.primary_noncontributory),
        yesNo(p.occurrence_form),
        yesNo(p.claims_made),
        yesNo(overlapsPeriod(p.effective_date, p.expiration_date, cycle.audit_period_start, cycle.audit_period_end)),
      ])
    }
  }
  detail.columns.forEach(col => { col.width = 20 })

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}

// ---------------------------------------------------------------------------
// Summary PDF (stretch goal — never blocks the package)
// ---------------------------------------------------------------------------

async function buildSummaryPdf(
  cycle: AuditCycle,
  rows: AuditVendorRow[],
  summary: AuditPackageSummary,
): Promise<Buffer | null> {
  try {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const navy = rgb(0.06, 0.09, 0.11)
    const accent = rgb(0.94, 0.29, 0.17)
    const grey = rgb(0.29, 0.33, 0.38)

    let page = pdf.addPage([612, 792])
    let y = 742
    const margin = 48

    const line = (text: string, opts: { size?: number; bold?: boolean; color?: typeof navy } = {}) => {
      const size = opts.size ?? 10
      if (y < 60) { page = pdf.addPage([612, 792]); y = 742 }
      page.drawText(text.slice(0, 110), {
        x: margin, y, size, font: opts.bold ? bold : font, color: opts.color ?? navy,
      })
      y -= size + 6
    }

    line('VERTICAL BUILDERS & COMMERCIAL', { size: 16, bold: true })
    line('Subcontractor Insurance & Compliance Audit Summary', { size: 12, bold: true, color: accent })
    y -= 6
    line(cycle.name, { size: 11, bold: true })
    line(`Audit period: ${cycle.audit_period_start} to ${cycle.audit_period_end}`, { color: grey })
    line(`Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, { color: grey })
    y -= 10

    line('SUMMARY', { size: 11, bold: true })
    const facts: [string, number][] = [
      ['Subcontractors included', summary.vendorsIncluded],
      ['Projects included', summary.projectsIncluded],
      ['Compliant at period end', summary.compliant],
      ['Non-compliant / expired', summary.expired],
      ['Missing required coverage', summary.missing],
      ['Awaiting review', summary.needsReview],
      ['Documented exceptions', summary.waived],
      ['Certificates included', summary.certificatesIncluded],
      ['Policy lines included', summary.policyLinesIncluded],
      ['Documents included', summary.documentsIncluded],
    ]
    for (const [k, v] of facts) line(`${k.padEnd(40, '.')} ${v}`, { color: grey })
    y -= 10

    line('SUBCONTRACTORS', { size: 11, bold: true })
    for (const row of rows) {
      line(`${row.vendor.legal_name}  —  ${row.vendor.primary_trade ?? 'Trade not recorded'}`, { bold: true })
      line(`   Status at period end: ${COMPLIANCE_LABELS[row.statusAtPeriodEnd as keyof typeof COMPLIANCE_LABELS] ?? row.statusAtPeriodEnd}`, { color: grey })
      if (row.projects.length) {
        line(`   Projects: ${row.projects.map(p => p.project_number).join(', ')}`, { color: grey })
      }
      for (const gap of row.gaps.slice(0, 4)) line(`   • ${gap}`, { size: 9, color: accent })
      y -= 4
    }

    y -= 8
    line('This package organizes insurance documentation and the requirements configured', { size: 8, color: grey })
    line('in Vertical Ops. Final coverage and contract interpretation should be reviewed by', { size: 8, color: grey })
    line('the company’s insurance/risk professional.', { size: 8, color: grey })

    return Buffer.from(await pdf.save())
  } catch (error) {
    // A PDF failure must never cost the office their audit package.
    console.error('[audits] summary PDF generation failed — continuing without it', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// The package
// ---------------------------------------------------------------------------

export interface BuildPackageResult {
  ok: boolean
  exportId?: string
  storagePath?: string
  filename?: string
  summary?: AuditPackageSummary
  warnings?: string[]
  error?: string
}

export async function buildAuditPackage(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: { auditCycleId: string; filters?: Partial<AuditFilters>; actorUserId: string },
): Promise<BuildPackageResult> {
  const cycle = await getAuditCycle(supabase, params.auditCycleId)
  if (!cycle) return { ok: false, error: 'Audit cycle not found.' }

  const filters = params.filters ?? {}
  const rows = await buildAuditRows(supabase, cycle, filters)
  const warnings: string[] = []

  const projectIds = new Set<string>()
  let certificateCount = 0
  let policyCount = 0
  const counts = { compliant: 0, expired: 0, missing: 0, needsReview: 0, waived: 0 }

  for (const row of rows) {
    row.projects.forEach(p => projectIds.add(p.id))
    certificateCount += row.certificates.length
    policyCount += row.policiesInPeriod.length
    switch (row.statusAtPeriodEnd) {
      case 'compliant': case 'expiring_soon': counts.compliant += 1; break
      case 'non_compliant': counts.expired += 1; break
      case 'missing': counts.missing += 1; break
      case 'needs_review': counts.needsReview += 1; break
      case 'waived': counts.waived += 1; break
    }
  }

  const summary: AuditPackageSummary = {
    vendorsIncluded: rows.length,
    projectsIncluded: projectIds.size,
    ...counts,
    certificatesIncluded: certificateCount,
    policyLinesIncluded: policyCount,
    documentsIncluded: 0,
    documentsUnavailable: 0,
  }

  const zip = new JSZip()
  const folderName = `Vertical_Builders_${sanitizeFolderName(cycle.name)}`
  const root = zip.folder(folderName)!

  // ---- 01/02 register -----------------------------------------------------
  const registerRows = buildRegisterRows(rows)
  root.file('02_Compliance_Register.csv', toCsv(REGISTER_HEADERS, registerRows))

  const exceptions = buildExceptionRows(rows)
  root.file('03_Missing_Expired_Exceptions.csv', toCsv(exceptions.headers, exceptions.rows))

  root.file('04_Activity_Log.csv', await buildActivityCsv(supabase, cycle))

  // ---- 05 vendor folders with source documents ----------------------------
  if (filters.includeDocuments !== false) {
    const vendorRoot = root.folder('05_Subcontractors')!
    let bytes = 0
    let fileCount = 0

    for (const row of rows) {
      const vendorFolder = vendorRoot.folder(sanitizeFolderName(row.vendor.legal_name))!
      vendorFolder.file('Vendor_Summary.txt', vendorSummaryText(row, cycle))

      for (const doc of row.documents) {
        if (fileCount >= MAX_DOCUMENTS_IN_PACKAGE) {
          warnings.push(`Document limit reached (${MAX_DOCUMENTS_IN_PACKAGE}). Narrow the filters and generate again for the rest.`)
          break
        }
        if (bytes >= MAX_PACKAGE_BYTES) {
          warnings.push('Package size limit reached. Narrow the filters and generate again for the rest.')
          break
        }
        const buffer = await downloadToBuffer(admin, doc.storage_path)
        if (!buffer) {
          summary.documentsUnavailable += 1
          warnings.push(`Could not read "${doc.original_filename}" for ${row.vendor.legal_name}.`)
          continue
        }
        const label = DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type
        const prefix = sanitizeFolderName(label)
        const dated = doc.document_date ? `_${doc.document_date}` : ''
        vendorFolder.file(`${prefix}${dated}_${sanitizeFilename(doc.original_filename)}`, buffer)
        bytes += buffer.byteLength
        fileCount += 1
        summary.documentsIncluded += 1
      }
    }
  }

  // ---- 01 xlsx + 00 pdf (after counts are final) --------------------------
  try {
    const workbook = await buildWorkbook(cycle, rows, summary)
    root.file('01_Compliance_Register.xlsx', workbook)
  } catch (error) {
    console.error('[audits] workbook generation failed', error)
    warnings.push('The Excel workbook could not be generated; the CSV register is included and complete.')
  }

  const pdf = await buildSummaryPdf(cycle, rows, summary)
  if (pdf) root.file('00_Audit_Summary.pdf', pdf)
  else warnings.push('The PDF summary could not be generated; the CSV and Excel registers are included and complete.')

  root.file('README.txt', packageReadme(cycle, summary, warnings))

  // ---- write it -----------------------------------------------------------
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `${folderName}_${stamp}.zip`
  const storagePath = `audit-exports/${cycle.id}/${filename}`

  const upload = await uploadGeneratedFile(admin, {
    buffer: archive,
    storagePath,
    contentType: 'application/zip',
  })
  if (!upload.ok) return { ok: false, error: upload.error }

  // A NEW export row every time. Old packages are never overwritten.
  const { data: exportRow, error } = await supabase
    .from('audit_exports')
    .insert({
      audit_cycle_id: cycle.id,
      filters_json: filters as object,
      snapshot_json: {
        summary,
        warnings,
        vendors: rows.map(r => ({
          id: r.vendor.id,
          legal_name: r.vendor.legal_name,
          trade: r.vendor.primary_trade,
          status_at_period_end: r.statusAtPeriodEnd,
          projects: r.projects.map(p => p.project_number),
          policy_lines: r.policiesInPeriod.length,
        })),
      },
      storage_path: storagePath,
      filename,
      size_bytes: archive.byteLength,
      generated_by: params.actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[audits] export record failed', error)
    return { ok: false, error: 'The package was generated but could not be recorded.' }
  }

  await logActivity(supabase, {
    action: 'audit.package_generated',
    entityType: 'audit_cycle',
    entityId: cycle.id,
    actorUserId: params.actorUserId,
    metadata: {
      export_id: exportRow.id,
      vendors: summary.vendorsIncluded,
      documents: summary.documentsIncluded,
      size_bytes: archive.byteLength,
    },
  })

  return {
    ok: true,
    exportId: exportRow.id as string,
    storagePath,
    filename,
    summary,
    warnings,
  }
}

function vendorSummaryText(row: AuditVendorRow, cycle: AuditCycle): string {
  const lines: string[] = [
    row.vendor.legal_name,
    '='.repeat(row.vendor.legal_name.length),
    '',
    `Audit period:      ${cycle.audit_period_start} to ${cycle.audit_period_end}`,
    `Trade:             ${row.vendor.primary_trade ?? 'Not recorded'}`,
    `Vendor status:     ${row.vendor.status}`,
    `Status at period end: ${COMPLIANCE_LABELS[row.statusAtPeriodEnd as keyof typeof COMPLIANCE_LABELS] ?? row.statusAtPeriodEnd}`,
    `Status today:      ${COMPLIANCE_LABELS[row.statusToday as keyof typeof COMPLIANCE_LABELS] ?? row.statusToday}`,
    `License:           ${row.vendor.license_number ?? 'Not recorded'}${row.vendor.license_expiration_date ? ` (expires ${row.vendor.license_expiration_date})` : ''}`,
    `W-9:               ${row.vendor.w9_status}`,
    '',
    'PROJECTS DURING THE AUDIT PERIOD',
  ]
  if (row.projects.length === 0) lines.push('  (none recorded)')
  for (const p of row.projects) {
    lines.push(`  ${p.project_number}  ${p.project_name}${p.scope ? ` — ${p.scope}` : ''}`)
  }

  lines.push('', 'POLICY LINES OVERLAPPING THE AUDIT PERIOD')
  if (row.policiesInPeriod.length === 0) lines.push('  (none on file)')
  for (const p of row.policiesInPeriod) {
    lines.push(
      `  ${COVERAGE_LABELS[p.coverage_type]}`,
      `    Carrier:    ${p.carrier ?? 'Not recorded'}`,
      `    Policy #:   ${p.policy_number ?? 'Not recorded'}`,
      `    Effective:  ${p.effective_date ?? 'Not recorded'}`,
      `    Expiration: ${p.expiration_date ?? 'Not recorded'}`,
      `    Limits:     ${describeLimits(p)}`,
      `    AI / WOS / P-NC: ${yesNo(p.additional_insured)} / ${yesNo(p.waiver_of_subrogation)} / ${yesNo(p.primary_noncontributory)}`,
    )
  }

  if (row.gaps.length) {
    lines.push('', 'GAPS AND FINDINGS')
    for (const gap of row.gaps) lines.push(`  - ${gap}`)
  }
  if (row.exceptions.length) {
    lines.push('', 'DOCUMENTED EXCEPTIONS')
    for (const e of row.exceptions) {
      lines.push(`  - ${e.reason}${e.expires_at ? ` (expires ${e.expires_at})` : ''}`)
    }
  }

  lines.push('', 'DOCUMENTS INCLUDED IN THIS FOLDER')
  if (row.documents.length === 0) lines.push('  (none on file)')
  for (const d of row.documents) {
    lines.push(`  ${DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type}: ${d.original_filename}`)
  }

  lines.push(
    '',
    '---',
    'Generated by Vertical Ops. This summary organizes documentation and configured',
    'requirements; it is not an insurance or legal opinion.',
  )
  return lines.join('\n')
}

function packageReadme(cycle: AuditCycle, summary: AuditPackageSummary, warnings: string[]): string {
  return [
    'VERTICAL BUILDERS & COMMERCIAL',
    'Subcontractor Insurance & Compliance Audit Package',
    '',
    `Audit cycle:   ${cycle.name}`,
    `Audit period:  ${cycle.audit_period_start} to ${cycle.audit_period_end}`,
    `Generated:     ${new Date().toISOString()}`,
    '',
    'CONTENTS',
    '  00_Audit_Summary.pdf ............ One-page overview and per-vendor findings',
    '  01_Compliance_Register.xlsx ..... Full register (Summary / Register / Missing & Expired / Policy Lines)',
    '  02_Compliance_Register.csv ...... Same register as plain CSV',
    '  03_Missing_Expired_Exceptions.csv Gaps and documented exceptions only',
    '  04_Activity_Log.csv ............. Who did what to compliance records during the period',
    '  05_Subcontractors/ .............. One folder per subcontractor with their source documents',
    '',
    'HOW COVERAGE WAS DETERMINED',
    '  A policy line is included when it overlapped the audit period:',
    '    effective_date <= period_end AND expiration_date >= period_start',
    '  Compliance status is evaluated AS OF THE END of the audit period, which is',
    '  the question an auditor is asking — not whether coverage is valid today.',
    '  "Status Today" is shown alongside it for context.',
    '',
    'COUNTS',
    `  Subcontractors: ${summary.vendorsIncluded}`,
    `  Projects:       ${summary.projectsIncluded}`,
    `  Certificates:   ${summary.certificatesIncluded}`,
    `  Policy lines:   ${summary.policyLinesIncluded}`,
    `  Documents:      ${summary.documentsIncluded}`,
    ...(warnings.length ? ['', 'NOTES', ...warnings.map(w => `  ! ${w}`)] : []),
    '',
    'This package organizes insurance documentation and the requirements configured',
    'in Vertical Ops. Final coverage and contract interpretation should be reviewed',
    'by the company’s insurance/risk professional.',
  ].join('\n')
}

export { REGISTER_HEADERS }

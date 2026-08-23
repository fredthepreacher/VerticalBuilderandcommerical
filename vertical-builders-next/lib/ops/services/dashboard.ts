import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACTIVE_PROJECT_STATUSES, OPEN_LEAD_STAGES, type ComplianceStatus } from '../types'
import { buildComplianceRegister, calculateReadiness, type ComplianceRow } from './compliance'
import { findExpiringPolicies, type ExpiringPolicy } from './certificates'
import { getSettings } from './settings'

export interface DashboardData {
  kpis: {
    newLeadsThisMonth: number
    openOpportunities: number
    activeProjects: number
    activeSubcontractors: number
    coisExpiring30: number
    nonCompliantVendors: number
    missingDocuments: number
    readinessPercentage: number
  }
  readiness: ReturnType<typeof calculateReadiness>
  leadsNeedingFollowUp: {
    id: string; first_name: string; last_name: string | null; phone: string | null
    service_type: string | null; pipeline_stage: string; created_at: string; next_follow_up_at: string | null
  }[]
  expiringSoon: ExpiringPolicy[]
  attentionVendors: ComplianceRow[]
  recentUploads: {
    id: string; original_filename: string; document_type: string; uploaded_at: string; entity_id: string
  }[]
  upcomingTasks: {
    id: string; title: string; due_date: string | null; priority: string; status: string
  }[]
  recentActivity: {
    id: string; action: string; entity_type: string; entity_id: string | null
    created_at: string; actor_label: string | null
  }[]
  warningWindowDays: number
}

const ATTENTION_STATUSES: ComplianceStatus[] = ['non_compliant', 'missing', 'needs_review', 'expiring_soon']

export async function loadDashboard(supabase: SupabaseClient): Promise<DashboardData> {
  const settings = await getSettings(supabase)
  const startOfMonth = new Date()
  startOfMonth.setUTCDate(1)
  startOfMonth.setUTCHours(0, 0, 0, 0)

  const [
    newLeads, openLeads, activeProjects, activeVendors,
    register, expiring, followUps, uploads, tasks, activity,
  ] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString()).is('archived_at', null),
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .in('pipeline_stage', OPEN_LEAD_STAGES).is('archived_at', null),
    supabase.from('projects').select('id', { count: 'exact', head: true })
      .in('status', ACTIVE_PROJECT_STATUSES).is('archived_at', null),
    supabase.from('vendors').select('id', { count: 'exact', head: true })
      .eq('status', 'active').is('archived_at', null),
    buildComplianceRegister(supabase),
    findExpiringPolicies(supabase, settings.warning_window_days),
    supabase.from('leads')
      .select('id, first_name, last_name, phone, service_type, pipeline_stage, created_at, next_follow_up_at')
      .in('pipeline_stage', OPEN_LEAD_STAGES).is('archived_at', null)
      .order('created_at', { ascending: true }).limit(8),
    supabase.from('documents')
      .select('id, original_filename, document_type, uploaded_at, entity_id')
      .is('archived_at', null).order('uploaded_at', { ascending: false }).limit(6),
    supabase.from('tasks')
      .select('id, title, due_date, priority, status')
      .in('status', ['open', 'in_progress']).order('due_date', { ascending: true, nullsFirst: false }).limit(8),
    supabase.from('activity_log')
      .select('id, action, entity_type, entity_id, created_at, actor_label')
      .order('created_at', { ascending: false }).limit(10),
  ])

  // Documentation Readiness only counts vendors on live projects — a dormant
  // vendor with no current work should not drag the score down.
  const activeIds = new Set<string>()
  for (const row of register) {
    if (row.projects.some(p => (ACTIVE_PROJECT_STATUSES as string[]).includes(p.status))) {
      activeIds.add(row.vendor.id)
    }
  }
  const scopedRows = register.filter(r => activeIds.has(r.vendor.id))
  const readiness = calculateReadiness(scopedRows)

  const attention = register
    .filter(r => ATTENTION_STATUSES.includes(r.evaluation.status))
    .sort((a, b) =>
      ATTENTION_STATUSES.indexOf(a.evaluation.status) - ATTENTION_STATUSES.indexOf(b.evaluation.status))
    .slice(0, 8)

  const missingDocs = register.filter(r =>
    r.evaluation.status === 'missing' || r.vendor.w9_status !== 'on_file' || !r.vendor.license_number,
  ).length

  return {
    kpis: {
      newLeadsThisMonth: newLeads.count ?? 0,
      openOpportunities: openLeads.count ?? 0,
      activeProjects: activeProjects.count ?? 0,
      activeSubcontractors: activeVendors.count ?? 0,
      coisExpiring30: expiring.filter(e => e.days_out <= 30).length,
      nonCompliantVendors: register.filter(r =>
        r.evaluation.status === 'non_compliant' || r.evaluation.status === 'missing').length,
      missingDocuments: missingDocs,
      readinessPercentage: readiness.percentage,
    },
    readiness,
    leadsNeedingFollowUp: (followUps.data ?? []) as DashboardData['leadsNeedingFollowUp'],
    expiringSoon: expiring.slice(0, 10),
    attentionVendors: attention,
    recentUploads: (uploads.data ?? []) as DashboardData['recentUploads'],
    upcomingTasks: (tasks.data ?? []) as DashboardData['upcomingTasks'],
    recentActivity: (activity.data ?? []) as DashboardData['recentActivity'],
    warningWindowDays: settings.warning_window_days,
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — operations and money snapshot
// ---------------------------------------------------------------------------

export interface OperationsSnapshot {
  estimates: {
    draft: number
    awaitingReview: number
    sent: number
    approvedNotConverted: number
    sentValueCents: number
  }
  schedule: {
    startingThisWeek: { id: string; name: string; number: string; date: string }[]
    finishingThisWeek: { id: string; name: string; number: string; date: string }[]
    unscheduledActive: number
  }
  agreements: {
    missing: number
    expiringSoon: number
  }
  measurementsPending: number
}

export interface FinancialSnapshot {
  outstandingCents: number
  overdueCents: number
  overdueCount: number
  paidThisMonthCents: number
  draftInvoiceCount: number
  unpricedPricebookItems: number
  recentInvoices: {
    id: string; number: string; status: string; dueDate: string | null
    totalCents: number; balanceCents: number; projectName: string | null
  }[]
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Deliberately separate from loadDashboard: the operations panel is a Phase 2
 * addition and a failure here must not take the compliance dashboard down with
 * it. Each query is independent and a missing table degrades to a zero rather
 * than an error page.
 */
export async function loadOperationsSnapshot(supabase: SupabaseClient): Promise<OperationsSnapshot> {
  const today = new Date()
  const weekEnd = new Date(today.getTime() + 7 * 86_400_000)
  const from = isoDay(today)
  const to = isoDay(weekEnd)

  const count = (q: { count: number | null }) => q.count ?? 0

  const [
    draft, awaitingReview, sent, approved, sentValue,
    starting, finishing, unscheduled,
    agreementsMissing, agreementsExpiring, measurements,
  ] = await Promise.all([
    supabase.from('estimates').select('id', { count: 'exact', head: true }).in('status', ['draft', 'ai_draft']),
    supabase.from('estimates').select('id', { count: 'exact', head: true }).eq('status', 'ready_for_review'),
    supabase.from('estimates').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
    supabase.from('estimates').select('id', { count: 'exact', head: true })
      .eq('status', 'approved').is('converted_project_id', null),
    supabase.from('estimates').select('total_cents').eq('status', 'sent'),
    supabase.from('projects')
      .select('id, project_name, project_number, scheduled_start_date')
      .gte('scheduled_start_date', from).lte('scheduled_start_date', to)
      .order('scheduled_start_date').limit(10),
    supabase.from('projects')
      .select('id, project_name, project_number, scheduled_end_date')
      .gte('scheduled_end_date', from).lte('scheduled_end_date', to)
      .order('scheduled_end_date').limit(10),
    supabase.from('projects').select('id', { count: 'exact', head: true })
      .in('status', ACTIVE_PROJECT_STATUSES).is('scheduled_start_date', null),
    supabase.from('vendors').select('id, subcontractor_agreements(id)').is('archived_at', null).neq('status', 'blocked'),
    supabase.from('subcontractor_agreements').select('id', { count: 'exact', head: true })
      .eq('status', 'signed').gte('expiration_date', from).lte('expiration_date', isoDay(new Date(today.getTime() + 60 * 86_400_000))),
    supabase.from('roof_measurements').select('id', { count: 'exact', head: true })
      .in('status', ['requested', 'processing']),
  ])

  const missingAgreements = (agreementsMissing.data ?? []).filter(v => {
    const list = (v as unknown as { subcontractor_agreements: unknown[] | null }).subcontractor_agreements
    return !list || list.length === 0
  }).length

  return {
    estimates: {
      draft: count(draft),
      awaitingReview: count(awaitingReview),
      sent: count(sent),
      approvedNotConverted: count(approved),
      sentValueCents: (sentValue.data ?? []).reduce((sum, e) => sum + ((e.total_cents as number) ?? 0), 0),
    },
    schedule: {
      startingThisWeek: (starting.data ?? []).map(p => ({
        id: p.id as string,
        name: p.project_name as string,
        number: p.project_number as string,
        date: p.scheduled_start_date as string,
      })),
      finishingThisWeek: (finishing.data ?? []).map(p => ({
        id: p.id as string,
        name: p.project_name as string,
        number: p.project_number as string,
        date: p.scheduled_end_date as string,
      })),
      unscheduledActive: count(unscheduled),
    },
    agreements: { missing: missingAgreements, expiringSoon: count(agreementsExpiring) },
    measurementsPending: count(measurements),
  }
}

/**
 * Money on the dashboard.
 *
 * "Outstanding" counts only invoices that were actually issued — drafts and
 * voided invoices are excluded, because neither is money anyone owes.
 */
export async function loadFinancialSnapshot(supabase: SupabaseClient): Promise<FinancialSnapshot> {
  const today = new Date()
  const from = isoDay(today)
  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  const [live, drafts, paidThisMonth, unpriced, recent] = await Promise.all([
    supabase.from('invoices').select('total_cents, balance_due_cents, due_date, status')
      .not('status', 'in', '(draft,void)'),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('payments').select('amount_cents')
      .eq('status', 'succeeded').gte('received_at', startOfMonth.toISOString()),
    supabase.from('pricebook_items').select('id', { count: 'exact', head: true })
      .eq('active', true).eq('default_unit_price_cents', 0),
    supabase.from('invoices')
      .select('id, invoice_number, status, due_date, total_cents, balance_due_cents, projects(project_name)')
      .not('status', 'in', '(draft,void)')
      .order('issue_date', { ascending: false }).limit(6),
  ])

  const liveRows = (live.data ?? []) as { total_cents: number; balance_due_cents: number; due_date: string | null; status: string }[]
  const owing = liveRows.filter(i => i.balance_due_cents > 0)
  const overdue = owing.filter(i => i.due_date !== null && i.due_date < from)

  return {
    outstandingCents: owing.reduce((sum, i) => sum + i.balance_due_cents, 0),
    overdueCents: overdue.reduce((sum, i) => sum + i.balance_due_cents, 0),
    overdueCount: overdue.length,
    paidThisMonthCents: (paidThisMonth.data ?? []).reduce((sum, p) => sum + ((p.amount_cents as number) ?? 0), 0),
    draftInvoiceCount: drafts.count ?? 0,
    unpricedPricebookItems: unpriced.count ?? 0,
    recentInvoices: (recent.data ?? []).map(row => {
      const embedded = (row as unknown as { projects: unknown }).projects
      const project = (Array.isArray(embedded) ? embedded[0] : embedded) as { project_name: string } | null
      return {
        id: row.id as string,
        number: row.invoice_number as string,
        status: row.status as string,
        dueDate: (row.due_date as string | null) ?? null,
        totalCents: row.total_cents as number,
        balanceCents: row.balance_due_cents as number,
        projectName: project?.project_name ?? null,
      }
    }),
  }
}

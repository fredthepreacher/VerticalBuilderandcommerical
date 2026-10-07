import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchCounts, ProspectStatus } from './constants'

/**
 * ============================================================================
 * ROOF PROSPECTS + IMPORT BATCHES — data access
 * ----------------------------------------------------------------------------
 * A "batch" is a lead_import_jobs row with kind='roof_prospect'. Its counts come
 * from the job's own counters (rows processed, rejected, errors) combined with a
 * live aggregation of the roof_prospects it produced (qualified, disqualified,
 * CRM-created, estimates, mailed) — so the dashboard reflects the real current
 * state of the prospects, not just what happened at import time.
 * ============================================================================
 */

export interface ImportBatch {
  id: string
  original_filename: string
  status: string
  status_reason: string | null
  county: string | null
  campaign_id: string | null
  campaign_name: string | null
  total_rows: number
  imported_rows: number
  failed_rows: number
  skipped_rows: number
  needs_review_rows: number
  created_at: string
  completed_at: string | null
  counts: BatchCounts
}

const DISQUALIFIED: ProspectStatus[] = [
  'disqualified_new_roof', 'disqualified_wrong_roof_type', 'disqualified_bad_address',
]
const ESTIMATE_STATES: ProspectStatus[] = ['estimate_ready', 'document_ready', 'printed', 'mailed', 'responded', 'appointment', 'sold']
const CRM_STATES: ProspectStatus[] = ['crm_created', ...ESTIMATE_STATES]
const MAILED_STATES: ProspectStatus[] = ['mailed', 'responded', 'appointment', 'sold']

function emptyCounts(): BatchCounts {
  return {
    totalRows: 0, validRows: 0, duplicates: 0, rejected: 0, needsReview: 0, imported: 0,
    qualified: 0, disqualified: 0, crmCreated: 0, estimatesGenerated: 0, mailed: 0, errors: 0,
  }
}

/** Fold a status histogram into the dashboard counters for one batch. */
function foldCounts(job: Record<string, unknown>, statusCounts: Map<ProspectStatus, number>): BatchCounts {
  const c = emptyCounts()
  c.totalRows = (job.total_rows as number) ?? 0
  c.rejected = (job.failed_rows as number) ?? 0
  c.errors = (job.failed_rows as number) ?? 0
  c.needsReview = 0
  for (const [status, n] of statusCounts) {
    c.imported += n
    if (status === 'review_required') c.needsReview += n
    if (status === 'duplicate') c.duplicates += n
    if (status === 'qualified') c.qualified += n
    if (DISQUALIFIED.includes(status)) c.disqualified += n
    if (CRM_STATES.includes(status)) c.crmCreated += n
    if (ESTIMATE_STATES.includes(status)) c.estimatesGenerated += n
    if (MAILED_STATES.includes(status)) c.mailed += n
  }
  c.validRows = c.imported - c.needsReview - c.duplicates
  if (c.validRows < 0) c.validRows = 0
  return c
}

export async function listBatches(supabase: SupabaseClient, limit = 100): Promise<ImportBatch[]> {
  const { data: jobs, error } = await supabase
    .from('lead_import_jobs')
    .select('*, prospecting_campaigns(name)')
    .eq('kind', 'roof_prospect')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[prospecting] listBatches failed', error)
    return []
  }
  const rows = jobs ?? []
  const ids = rows.map(j => j.id as string)

  // One aggregation query for all listed batches, folded per job.
  const byJob = new Map<string, Map<ProspectStatus, number>>()
  if (ids.length > 0) {
    const { data: prospects } = await supabase
      .from('roof_prospects').select('import_job_id, status').in('import_job_id', ids).limit(100_000)
    for (const p of prospects ?? []) {
      const jid = p.import_job_id as string
      const st = p.status as ProspectStatus
      if (!byJob.has(jid)) byJob.set(jid, new Map())
      const m = byJob.get(jid)!
      m.set(st, (m.get(st) ?? 0) + 1)
    }
  }

  return rows.map(job => {
    const campaign = Array.isArray(job.prospecting_campaigns)
      ? job.prospecting_campaigns[0] : job.prospecting_campaigns
    return {
      id: job.id as string,
      original_filename: job.original_filename as string,
      status: job.status as string,
      status_reason: (job.status_reason as string | null) ?? null,
      county: (job.county as string | null) ?? null,
      campaign_id: (job.campaign_id as string | null) ?? null,
      campaign_name: (campaign?.name as string | undefined) ?? null,
      total_rows: (job.total_rows as number) ?? 0,
      imported_rows: (job.imported_rows as number) ?? 0,
      failed_rows: (job.failed_rows as number) ?? 0,
      skipped_rows: (job.skipped_rows as number) ?? 0,
      needs_review_rows: (job.needs_review_rows as number) ?? 0,
      created_at: job.created_at as string,
      completed_at: (job.completed_at as string | null) ?? null,
      counts: foldCounts(job, byJob.get(job.id as string) ?? new Map()),
    }
  })
}

export interface ProspectRow {
  id: string
  status: ProspectStatus
  owner_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  mailing_address: string | null
  parcel_apn: string | null
  permit_number: string | null
  permit_date: string | null
  permit_type: string | null
  roof_type: string | null
  contractor: string | null
  final_squares: number | null
  confidence_band: string | null
  screening_reason: string | null
  converted_lead_id: string | null
  estimate_id: string | null
  created_at: string
}

export async function loadBatch(supabase: SupabaseClient, id: string): Promise<ImportBatch | null> {
  const batches = await listBatches(supabase, 1000)
  return batches.find(b => b.id === id) ?? null
}

export async function listProspectsForBatch(
  supabase: SupabaseClient, importJobId: string, limit = 500,
): Promise<ProspectRow[]> {
  const { data } = await supabase
    .from('roof_prospects')
    .select('id, status, owner_name, property_address, city, state, zip, mailing_address, parcel_apn, permit_number, permit_date, permit_type, roof_type, contractor, final_squares, confidence_band, screening_reason, converted_lead_id, estimate_id, created_at')
    .eq('import_job_id', importJobId)
    .order('created_at', { ascending: true })
    .limit(limit)
  return (data ?? []) as ProspectRow[]
}

/** Workspace overview: prospect status histogram across every batch. */
export async function prospectingOverview(supabase: SupabaseClient): Promise<{
  totalProspects: number
  byStatus: Record<string, number>
}> {
  const { data } = await supabase.from('roof_prospects').select('status').limit(100_000)
  const byStatus: Record<string, number> = {}
  for (const r of data ?? []) {
    const s = r.status as string
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }
  return { totalProspects: (data ?? []).length, byStatus }
}

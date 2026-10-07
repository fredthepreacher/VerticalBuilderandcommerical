import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchStatus, ItemGenerationStatus } from './mail-batch'

/**
 * Read side of mail batches: list, load one, load its items, and a PURE manifest
 * builder (unit-tested) so the CSV shape is stable and never leaks fields it
 * should not (spec §10 — "do not expose unnecessary sensitive data").
 */

export interface MailBatchSummary {
  id: string
  name: string
  status: BatchStatus
  campaignId: string | null
  campaignName: string | null
  recordCount: number
  batchVersion: number
  mailTag: string | null
  createdAt: string
  exportedAt: string | null
  printedAt: string | null
  mailedAt: string | null
  generatedCount: number
  blockedCount: number
  failedCount: number
}

export interface MailBatchItem {
  id: string
  prospectId: string | null
  leadId: string | null
  estimateId: string | null
  documentId: string | null
  generationStatus: ItemGenerationStatus
  blockReason: string | null
  errorMessage: string | null
  recipientName: string | null
  propertyAddress: string | null
  mailingAddress: string | null
  mailingFallback: boolean
  finalSquares: number | null
  estimateTotalCents: number | null
  estimateNumber: string | null
  printedAt: string | null
  mailedAt: string | null
  sortOrder: number
}

export async function listMailBatches(
  supabase: SupabaseClient,
  filters: { campaignId?: string | null; limit?: number } = {},
): Promise<MailBatchSummary[]> {
  let q = supabase
    .from('mail_batches')
    .select(`id, name, status, campaign_id, record_count, batch_version, mail_tag,
             created_at, exported_at, printed_at, mailed_at,
             prospecting_campaigns(name)`)
    .order('created_at', { ascending: false })
    .limit(Math.min(filters.limit ?? 100, 200))
  if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId)
  const { data } = await q
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  if (rows.length === 0) return []

  // Per-batch item tallies in one pass.
  const ids = rows.map(r => r.id as string)
  const tally = new Map<string, { generated: number; blocked: number; failed: number }>()
  const { data: items } = await supabase
    .from('mail_batch_items').select('batch_id, generation_status').in('batch_id', ids).limit(100000)
  for (const it of (items ?? []) as { batch_id: string; generation_status: string }[]) {
    const t = tally.get(it.batch_id) ?? { generated: 0, blocked: 0, failed: 0 }
    if (it.generation_status === 'generated') t.generated += 1
    else if (it.generation_status === 'blocked') t.blocked += 1
    else if (it.generation_status === 'failed') t.failed += 1
    tally.set(it.batch_id, t)
  }

  return rows.map(r => {
    const camp = Array.isArray(r.prospecting_campaigns) ? r.prospecting_campaigns[0] : r.prospecting_campaigns
    const t = tally.get(r.id as string) ?? { generated: 0, blocked: 0, failed: 0 }
    return {
      id: r.id as string,
      name: r.name as string,
      status: r.status as BatchStatus,
      campaignId: (r.campaign_id as string | null) ?? null,
      campaignName: ((camp as Record<string, unknown> | null)?.name as string | null) ?? null,
      recordCount: (r.record_count as number | null) ?? 0,
      batchVersion: (r.batch_version as number | null) ?? 0,
      mailTag: (r.mail_tag as string | null) ?? null,
      createdAt: r.created_at as string,
      exportedAt: (r.exported_at as string | null) ?? null,
      printedAt: (r.printed_at as string | null) ?? null,
      mailedAt: (r.mailed_at as string | null) ?? null,
      generatedCount: t.generated,
      blockedCount: t.blocked,
      failedCount: t.failed,
    }
  })
}

export interface LoadedBatch extends MailBatchSummary {
  proposalTemplateId: string | null
  county: string | null
  batchSizeLimit: number | null
  createdBy: string | null
}

export async function loadMailBatch(supabase: SupabaseClient, batchId: string): Promise<LoadedBatch | null> {
  const { data } = await supabase
    .from('mail_batches')
    .select(`id, name, status, campaign_id, record_count, batch_version, mail_tag, batch_size_limit,
             proposal_template_id, created_by, created_at, exported_at, printed_at, mailed_at,
             prospecting_campaigns(name, county)`)
    .eq('id', batchId).maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  const camp = (Array.isArray(r.prospecting_campaigns) ? r.prospecting_campaigns[0] : r.prospecting_campaigns) as Record<string, unknown> | null

  const { data: items } = await supabase
    .from('mail_batch_items').select('generation_status').eq('batch_id', batchId).limit(100000)
  let generated = 0, blocked = 0, failed = 0
  for (const it of (items ?? []) as { generation_status: string }[]) {
    if (it.generation_status === 'generated') generated += 1
    else if (it.generation_status === 'blocked') blocked += 1
    else if (it.generation_status === 'failed') failed += 1
  }

  return {
    id: r.id as string,
    name: r.name as string,
    status: r.status as BatchStatus,
    campaignId: (r.campaign_id as string | null) ?? null,
    campaignName: (camp?.name as string | null) ?? null,
    county: (camp?.county as string | null) ?? null,
    recordCount: (r.record_count as number | null) ?? 0,
    batchVersion: (r.batch_version as number | null) ?? 0,
    mailTag: (r.mail_tag as string | null) ?? null,
    batchSizeLimit: (r.batch_size_limit as number | null) ?? null,
    proposalTemplateId: (r.proposal_template_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
    exportedAt: (r.exported_at as string | null) ?? null,
    printedAt: (r.printed_at as string | null) ?? null,
    mailedAt: (r.mailed_at as string | null) ?? null,
    generatedCount: generated,
    blockedCount: blocked,
    failedCount: failed,
  }
}

export async function loadMailBatchItems(supabase: SupabaseClient, batchId: string): Promise<MailBatchItem[]> {
  const { data } = await supabase
    .from('mail_batch_items')
    .select(`id, roof_prospect_id, lead_id, estimate_id, document_id, generation_status, block_reason,
             error_message, recipient_name, property_address, mailing_address, mailing_fallback,
             final_squares, estimate_total_cents, estimate_number, printed_at, mailed_at, sort_order`)
    .eq('batch_id', batchId)
    .order('sort_order', { ascending: true })
    .limit(2000)
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: r.id as string,
    prospectId: (r.roof_prospect_id as string | null) ?? null,
    leadId: (r.lead_id as string | null) ?? null,
    estimateId: (r.estimate_id as string | null) ?? null,
    documentId: (r.document_id as string | null) ?? null,
    generationStatus: r.generation_status as ItemGenerationStatus,
    blockReason: (r.block_reason as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    recipientName: (r.recipient_name as string | null) ?? null,
    propertyAddress: (r.property_address as string | null) ?? null,
    mailingAddress: (r.mailing_address as string | null) ?? null,
    mailingFallback: Boolean(r.mailing_fallback),
    finalSquares: (r.final_squares as number | null) ?? null,
    estimateTotalCents: (r.estimate_total_cents as number | null) ?? null,
    estimateNumber: (r.estimate_number as string | null) ?? null,
    printedAt: (r.printed_at as string | null) ?? null,
    mailedAt: (r.mailed_at as string | null) ?? null,
    sortOrder: (r.sort_order as number | null) ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// Manifest (PURE, unit-tested)
// ---------------------------------------------------------------------------

export const MANIFEST_COLUMNS = [
  'batch_id', 'item_id', 'prospect_id', 'lead_id', 'estimate_id', 'document_id',
  'estimate_number', 'recipient_name', 'property_address', 'mailing_address',
  'mailing_fallback', 'campaign', 'county', 'final_squares', 'estimate_total',
  'generation_status', 'block_reason', 'printed', 'mailed',
] as const

const dollars = (cents: number | null): string =>
  cents == null ? '' : (cents / 100).toFixed(2)

/** RFC-4180-ish CSV cell: quote when it contains a comma, quote or newline. */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildManifestCsv(
  batch: { id: string; campaignName: string | null; county: string | null },
  items: MailBatchItem[],
): string {
  const header = MANIFEST_COLUMNS.join(',')
  const lines = items.map(it => [
    batch.id, it.id, it.prospectId ?? '', it.leadId ?? '', it.estimateId ?? '', it.documentId ?? '',
    it.estimateNumber ?? '', it.recipientName ?? '', it.propertyAddress ?? '', it.mailingAddress ?? '',
    it.mailingFallback ? 'yes' : 'no', batch.campaignName ?? '', batch.county ?? '',
    it.finalSquares ?? '', dollars(it.estimateTotalCents),
    it.generationStatus, it.blockReason ?? '',
    it.printedAt ? 'yes' : 'no', it.mailedAt ? 'yes' : 'no',
  ].map(csvCell).join(','))
  return [header, ...lines].join('\n')
}

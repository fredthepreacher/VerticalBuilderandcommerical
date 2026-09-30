import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '../services/activity'
import { getSettings } from '../services/settings'
import { downloadToBuffer } from '../services/documents'
import { estimatePdfFilename, renderEstimatePdf } from '../estimating/pdf'
import { buildPdfInput } from '../estimating/render-input'
import { storeProposalDocument } from './proposal-document'
import {
  evaluateProductionEligibility, recipientNameFor, activeBatchedProspectIds,
  type EligibilityCode,
} from './production'

/**
 * ============================================================================
 * MAIL BATCH — create, generate (resumable + idempotent), export, mark (Phase 3B)
 * ----------------------------------------------------------------------------
 * Reuses the existing estimate PDF engine and document vault; builds no second
 * pipeline. Guarantees the spec is strict about:
 *
 *   · IDEMPOTENT. An item is unique per (batch, prospect); generation keys off
 *     document_id, so a retry after a partial run never produces a duplicate
 *     proposal, and re-running a completed batch is a no-op.
 *   · RESUMABLE. Generation is state-driven: it picks up pending/failed items in
 *     bounded chunks. Stopping at 37/60 loses nothing; the next call does 38..60.
 *   · NEVER $0. A row whose estimate total is $0 is blocked, never mailed.
 *   · MARK ≠ GENERATE. Printed/Mailed are explicit human acts (optimistic-
 *     concurrency guarded); they are never inferred from PDFs existing.
 * ============================================================================
 */

export const GENERATE_CHUNK = 20
const DEFAULT_BATCH_SIZE = 60
const MAX_BATCH_SIZE = 1000

export type BatchStatus =
  | 'draft' | 'generating' | 'ready' | 'partial'
  | 'exported' | 'printed' | 'mailed' | 'cancelled' | 'error'

export type ItemGenerationStatus = 'pending' | 'generating' | 'generated' | 'blocked' | 'failed'

/**
 * PURE: derive a batch's status from its items' generation states, AFTER a
 * generation pass. Export/print/mail/cancel are explicit transitions handled
 * elsewhere and are never overwritten by this.
 */
export function deriveBatchStatus(
  items: { generation_status: ItemGenerationStatus }[],
): BatchStatus {
  if (items.length === 0) return 'draft'
  let generated = 0, failed = 0, blocked = 0, active = 0
  for (const it of items) {
    if (it.generation_status === 'generated') generated += 1
    else if (it.generation_status === 'failed') failed += 1
    else if (it.generation_status === 'blocked') blocked += 1
    else active += 1 // pending | generating
  }
  if (active > 0) return 'generating'
  if (generated === 0) return 'error'          // nothing produced
  if (failed > 0 || blocked > 0) return 'partial'
  return 'ready'
}

const BLOCK_CODES: EligibilityCode[] = [
  'ESTIMATE_REQUIRED', 'MEASUREMENT_REQUIRED', 'PRICING_CONFIGURATION_REQUIRED',
  'TEMPLATE_REQUIRED', 'BAD_ADDRESS', 'ALREADY_BATCHED', 'ERROR',
]

interface ProspectSnapshotRow {
  id: string
  owner_name: string | null
  property_address: string | null
  mailing_address: string | null
  final_squares: number | null
  campaign_id: string | null
  estimate_id: string | null
  converted_lead_id: string | null
  prospecting_campaigns: unknown
  estimates: unknown
}

const firstOf = (v: unknown): Record<string, unknown> | null =>
  (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as Record<string, unknown> | null

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateBatchResult {
  ok: boolean
  batchId?: string
  summary?: { total: number; ready: number; blocked: number }
  error?: string
}

/**
 * Creates a mail batch from an explicit prospect selection (or the campaign's
 * ready pool), snapshotting each record and marking blocked rows with a reason.
 * A mixed selection is safe: valid rows are 'pending', blocked rows are 'blocked'
 * and clearly identified — valid rows still proceed to generation (spec §7).
 */
export async function createMailBatch(
  supabase: SupabaseClient,
  input: {
    name: string
    campaignId?: string | null
    prospectIds?: string[]
    limit?: number
    allowRebatch?: boolean
  },
  userId: string,
): Promise<CreateBatchResult> {
  const name = (input.name ?? '').trim()
  if (name.length < 1) return { ok: false, error: 'Give the batch a name.' }

  // Campaign config (template, mail tag, default size, price item).
  let campaign: Record<string, unknown> | null = null
  if (input.campaignId) {
    const { data } = await supabase
      .from('prospecting_campaigns')
      .select('id, name, county, proposal_template_id, mail_tag, default_batch_size')
      .eq('id', input.campaignId).maybeSingle()
    campaign = (data as Record<string, unknown> | null) ?? null
  }

  const cap = Math.min(
    input.limit ?? (campaign?.default_batch_size as number | undefined) ?? DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
  )

  // Resolve the candidate prospects.
  let q = supabase
    .from('roof_prospects')
    .select(`id, owner_name, property_address, mailing_address, final_squares, campaign_id, estimate_id, converted_lead_id,
             prospecting_campaigns(name, county, proposal_template_id),
             estimates(estimate_number, total_cents)`)
    .in('status', ['estimate_ready', 'document_ready'])
    .order('created_at', { ascending: true })
    .limit(cap)
  if (input.prospectIds && input.prospectIds.length > 0) q = q.in('id', input.prospectIds.slice(0, MAX_BATCH_SIZE))
  if (input.campaignId) q = q.eq('campaign_id', input.campaignId)

  const { data, error } = await q
  if (error) return { ok: false, error: 'Could not load the selected prospects.' }
  const prospects = (data ?? []) as unknown as ProspectSnapshotRow[]
  if (prospects.length === 0) return { ok: false, error: 'No eligible prospects in the selection.' }

  const batched = await activeBatchedProspectIds(supabase, input.campaignId)

  // Create the batch header first (draft).
  const { data: batch, error: batchErr } = await supabase
    .from('mail_batches')
    .insert({
      name,
      campaign_id: input.campaignId ?? null,
      proposal_template_id: (campaign?.proposal_template_id as string | null) ?? null,
      status: 'draft',
      batch_size_limit: cap,
      mail_tag: (campaign?.mail_tag as string | null) ?? null,
      created_by: userId,
    })
    .select('id').single()
  if (batchErr || !batch) return { ok: false, error: 'The batch could not be created.' }
  const batchId = batch.id as string

  let ready = 0, blocked = 0
  const items = prospects.map((p, index) => {
    const camp = firstOf(p.prospecting_campaigns)
    const est = firstOf(p.estimates)
    const elig = evaluateProductionEligibility({
      estimateId: p.estimate_id,
      estimateTotalCents: (est?.total_cents as number | null) ?? null,
      finalSquares: p.final_squares,
      propertyAddress: p.property_address,
      mailingAddress: p.mailing_address,
      campaignPresent: Boolean(p.campaign_id),
      proposalTemplateId: (camp?.proposal_template_id as string | null) ?? null,
      alreadyInActiveBatch: batched.has(p.id),
    }, { allowRebatch: input.allowRebatch })

    const isBlocked = !elig.ready
    if (isBlocked) blocked += 1; else ready += 1

    return {
      batch_id: batchId,
      roof_prospect_id: p.id,
      lead_id: p.converted_lead_id,
      estimate_id: p.estimate_id,
      generation_status: isBlocked ? 'blocked' : 'pending',
      block_reason: isBlocked ? elig.code : null,
      error_message: isBlocked ? elig.reason : null,
      recipient_name: recipientNameFor(p.owner_name),
      property_address: p.property_address,
      mailing_address: elig.mailingAddressUsed,
      mailing_fallback: elig.mailingFallback,
      final_squares: p.final_squares,
      estimate_total_cents: (est?.total_cents as number | null) ?? null,
      estimate_number: (est?.estimate_number as string | null) ?? null,
      sort_order: index,
    }
  })

  // Idempotent insert: unique (batch_id, roof_prospect_id). A fresh batch has no
  // collisions, but ignoreDuplicates keeps a double-submit from erroring.
  const { error: itemsErr } = await supabase
    .from('mail_batch_items')
    .upsert(items, { onConflict: 'batch_id,roof_prospect_id', ignoreDuplicates: true })
  if (itemsErr) {
    await supabase.from('mail_batches').delete().eq('id', batchId)
    return { ok: false, error: 'The batch items could not be saved.' }
  }

  await supabase.from('mail_batches').update({ record_count: items.length }).eq('id', batchId)
  await logActivity(supabase, {
    action: 'prospecting.mail_batch_created', entityType: 'mail_batch', entityId: batchId,
    actorUserId: userId, metadata: { name, total: items.length, ready, blocked },
  })

  return { ok: true, batchId, summary: { total: items.length, ready, blocked } }
}

// ---------------------------------------------------------------------------
// Generate (resumable, idempotent)
// ---------------------------------------------------------------------------

export interface GenerateResult {
  ok: boolean
  processed: number
  generated: number
  failed: number
  remaining: number
  status: BatchStatus
  error?: string
}

export async function generateBatchChunk(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  batchId: string,
  userId: string,
  chunkSize = GENERATE_CHUNK,
): Promise<GenerateResult> {
  const { data: batch } = await supabase
    .from('mail_batches').select('id, status').eq('id', batchId).maybeSingle()
  if (!batch) return { ok: false, processed: 0, generated: 0, failed: 0, remaining: 0, status: 'error', error: 'Batch not found.' }
  if ((batch as { status: string }).status === 'cancelled') {
    return { ok: false, processed: 0, generated: 0, failed: 0, remaining: 0, status: 'cancelled', error: 'Batch is cancelled.' }
  }

  const settings = await getSettings(supabase)

  // Reclaim items stranded 'generating' by a crashed prior chunk (a chunk runs
  // synchronously to completion within one request, so any 'generating' left over
  // is from an interrupted run). One that already produced a document is marked
  // generated; one that did not is returned to the queue. This is what makes a
  // killed 37/60 run fully resumable without duplicating a document.
  await supabase.from('mail_batch_items')
    .update({ generation_status: 'generated' })
    .eq('batch_id', batchId).eq('generation_status', 'generating').not('document_id', 'is', null)
  await supabase.from('mail_batch_items')
    .update({ generation_status: 'pending' })
    .eq('batch_id', batchId).eq('generation_status', 'generating').is('document_id', null)

  // Pick the next pending/failed items with an estimate. Blocked items stay blocked.
  const { data: itemRows } = await supabase
    .from('mail_batch_items')
    .select('id, roof_prospect_id, estimate_id, document_id, generation_status')
    .eq('batch_id', batchId)
    .in('generation_status', ['pending', 'failed'])
    .order('sort_order', { ascending: true })
    .limit(Math.min(chunkSize, GENERATE_CHUNK))
  const items = (itemRows ?? []) as {
    id: string; roof_prospect_id: string | null; estimate_id: string | null
    document_id: string | null; generation_status: string
  }[]

  let generated = 0, failed = 0
  for (const item of items) {
    // Idempotent: an item that already produced a document is never re-rendered.
    if (item.document_id) {
      await supabase.from('mail_batch_items').update({ generation_status: 'generated' }).eq('id', item.id)
      continue
    }
    if (!item.estimate_id) {
      await supabase.from('mail_batch_items')
        .update({ generation_status: 'blocked', block_reason: 'ESTIMATE_REQUIRED', error_message: 'No estimate linked.' })
        .eq('id', item.id)
      continue
    }
    // Claim the item so a second concurrent generator does not double-render it.
    await supabase.from('mail_batch_items').update({ generation_status: 'generating' }).eq('id', item.id)

    try {
      const prepared = await buildPdfInput(supabase, admin, item.estimate_id, {
        includePhotos: false, // mail proposals are text; photos would bloat the batch
        taxEnabled: settings.estimate_tax_enabled,
        downloadPhoto: (path: string) => downloadToBuffer(admin, path),
      })
      if (!prepared) throw new Error('Estimate could not be loaded for rendering.')

      const pdf = await renderEstimatePdf(prepared.input)
      const filename = estimatePdfFilename(prepared.input.estimate, prepared.customerName)
      const stored = await storeProposalDocument(admin, {
        estimateId: item.estimate_id, bytes: pdf, filename, uploadedBy: userId, sizeBytes: pdf.length,
      })
      if (!stored.ok) throw new Error(stored.error)

      await supabase.from('mail_batch_items')
        .update({ generation_status: 'generated', document_id: stored.document.documentId, error_message: null })
        .eq('id', item.id)
      if (item.roof_prospect_id) {
        // Advance the prospect lifecycle, but never downgrade one already further along.
        await supabase.from('roof_prospects')
          .update({ status: 'document_ready' })
          .eq('id', item.roof_prospect_id)
          .in('status', ['estimate_ready'])
      }
      generated += 1
    } catch (e) {
      await supabase.from('mail_batch_items')
        .update({ generation_status: 'failed', error_message: e instanceof Error ? e.message : 'Render failed.' })
        .eq('id', item.id)
      failed += 1
    }
  }

  // Remaining still-to-do, and the derived status over ALL items.
  const { count: remaining } = await supabase
    .from('mail_batch_items').select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId).in('generation_status', ['pending', 'failed', 'generating'])

  const { data: allItems } = await supabase
    .from('mail_batch_items').select('generation_status').eq('batch_id', batchId)
  const status = (remaining ?? 0) > 0
    ? 'generating'
    : deriveBatchStatus((allItems ?? []) as { generation_status: ItemGenerationStatus }[])

  // Only touch status if the batch is still in a generation phase (don't clobber
  // exported/printed/mailed set by a later human action).
  await supabase.from('mail_batches')
    .update({ status })
    .eq('id', batchId)
    .in('status', ['draft', 'generating', 'ready', 'partial', 'error'])

  if (generated > 0 || failed > 0) {
    await logActivity(supabase, {
      action: 'prospecting.mail_batch_generated', entityType: 'mail_batch', entityId: batchId,
      actorUserId: userId, metadata: { generated, failed, remaining: remaining ?? 0 },
    })
  }

  return { ok: true, processed: items.length, generated, failed, remaining: remaining ?? 0, status }
}

// ---------------------------------------------------------------------------
// Reprint / regenerate one item (a new PDF version, no new lead/estimate) §18
// ---------------------------------------------------------------------------

export async function regenerateBatchItem(
  supabase: SupabaseClient, batchId: string, itemId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('mail_batch_items')
    .update({ generation_status: 'pending', document_id: null, error_message: null })
    .eq('id', itemId).eq('batch_id', batchId)
    .in('generation_status', ['generated', 'failed'])
    .select('id')
  if (error) return { ok: false, error: 'Could not queue the reprint.' }
  if (!data || data.length === 0) return { ok: false, error: 'Item is not in a regenerable state.' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Explicit lifecycle transitions (optimistic-concurrency guarded)
// ---------------------------------------------------------------------------

export interface TransitionResult {
  ok: boolean
  conflict?: boolean
  status?: BatchStatus
  error?: string
}

/** update ... where id and batch_version match; 0 rows means someone else moved it. */
async function transition(
  supabase: SupabaseClient,
  batchId: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
  fromStatuses: BatchStatus[],
): Promise<{ ok: boolean; conflict: boolean; row?: Record<string, unknown> }> {
  const { data } = await supabase
    .from('mail_batches')
    .update({ ...patch, batch_version: expectedVersion + 1 })
    .eq('id', batchId)
    .eq('batch_version', expectedVersion)
    .in('status', fromStatuses)
    .select('id, status, batch_version')
  if (!data || data.length === 0) return { ok: false, conflict: true }
  return { ok: true, conflict: false, row: data[0] as Record<string, unknown> }
}

export async function markBatchExported(
  supabase: SupabaseClient, batchId: string, userId: string, expectedVersion: number,
): Promise<TransitionResult> {
  const r = await transition(supabase, batchId, expectedVersion,
    { status: 'exported', exported_at: new Date().toISOString() },
    ['ready', 'partial', 'exported'])
  if (!r.ok) return { ok: false, conflict: true, error: 'This batch changed since you loaded it. Reload and try again.' }
  await logActivity(supabase, { action: 'prospecting.mail_batch_exported', entityType: 'mail_batch', entityId: batchId, actorUserId: userId })
  return { ok: true, status: 'exported' }
}

export async function markBatchPrinted(
  supabase: SupabaseClient, batchId: string, userId: string, expectedVersion: number,
): Promise<TransitionResult> {
  const now = new Date().toISOString()
  const r = await transition(supabase, batchId, expectedVersion,
    { status: 'printed', printed_at: now, printed_by: userId },
    ['ready', 'partial', 'exported', 'printed'])
  if (!r.ok) return { ok: false, conflict: true, error: 'This batch changed since you loaded it. Reload and try again.' }
  // Stamp generated items + advance their prospects. Never auto-marks mailed.
  await supabase.from('mail_batch_items').update({ printed_at: now })
    .eq('batch_id', batchId).eq('generation_status', 'generated').is('printed_at', null)
  await advanceProspectsForBatch(supabase, batchId, 'printed', ['document_ready', 'estimate_ready'])
  await logActivity(supabase, { action: 'prospecting.mail_batch_printed', entityType: 'mail_batch', entityId: batchId, actorUserId: userId })
  return { ok: true, status: 'printed' }
}

export async function markBatchMailed(
  supabase: SupabaseClient, batchId: string, userId: string, expectedVersion: number,
): Promise<TransitionResult> {
  const now = new Date().toISOString()
  const r = await transition(supabase, batchId, expectedVersion,
    { status: 'mailed', mailed_at: now, mailed_by: userId },
    ['ready', 'partial', 'exported', 'printed', 'mailed'])
  if (!r.ok) return { ok: false, conflict: true, error: 'This batch changed since you loaded it. Reload and try again.' }
  await supabase.from('mail_batch_items').update({ mailed_at: now })
    .eq('batch_id', batchId).eq('generation_status', 'generated').is('mailed_at', null)
  await advanceProspectsForBatch(supabase, batchId, 'mailed', ['document_ready', 'estimate_ready', 'printed'])
  await logActivity(supabase, { action: 'prospecting.mail_batch_mailed', entityType: 'mail_batch', entityId: batchId, actorUserId: userId })
  return { ok: true, status: 'mailed' }
}

export async function cancelBatch(
  supabase: SupabaseClient, batchId: string, userId: string, expectedVersion: number,
): Promise<TransitionResult> {
  const r = await transition(supabase, batchId, expectedVersion, { status: 'cancelled' },
    ['draft', 'generating', 'ready', 'partial', 'error', 'exported'])
  if (!r.ok) return { ok: false, conflict: true, error: 'This batch changed since you loaded it. Reload and try again.' }
  // Prospect lifecycle is NOT reverted — any generated documents remain valid.
  await logActivity(supabase, { action: 'prospecting.mail_batch_cancelled', entityType: 'mail_batch', entityId: batchId, actorUserId: userId })
  return { ok: true, status: 'cancelled' }
}

/** Advance the prospects in a batch to a lifecycle status, never downgrading. */
async function advanceProspectsForBatch(
  supabase: SupabaseClient, batchId: string, status: string, fromStatuses: string[],
): Promise<void> {
  const { data } = await supabase.from('mail_batch_items')
    .select('roof_prospect_id').eq('batch_id', batchId).eq('generation_status', 'generated')
    .not('roof_prospect_id', 'is', null)
  const ids = (data ?? []).map(r => (r as { roof_prospect_id: string }).roof_prospect_id).filter(Boolean)
  for (let i = 0; i < ids.length; i += 200) {
    await supabase.from('roof_prospects').update({ status })
      .in('id', ids.slice(i, i + 200)).in('status', fromStatuses)
  }
}

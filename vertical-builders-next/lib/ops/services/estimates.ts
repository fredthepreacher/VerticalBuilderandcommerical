import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HUMAN_REVIEW_REQUIRED_FROM,
  type Estimate,
  type EstimateStatus,
  type PricebookItem,
} from '../types'
import { calculateTotals, lineTotalCents } from '../finance/calc'
import type { EstimateInput, EstimateLineInput } from '../validations/estimate'
import { logActivity } from './activity'
import { getSettings } from './settings'

/**
 * Estimate persistence.
 *
 * Totals are recomputed here from the line items on every save. The client
 * never sends a subtotal — if it did, a stale or tampered figure could end up
 * on a customer-facing PDF.
 */

export interface SaveEstimateResult {
  ok: boolean
  estimateId?: string
  error?: string
}

export async function saveEstimate(
  supabase: SupabaseClient,
  input: EstimateInput,
  actorUserId: string,
  estimateId?: string | null,
): Promise<SaveEstimateResult> {
  const settings = await getSettings(supabase)

  const totals = calculateTotals({
    lines: input.lines.map(l => ({ quantity: l.quantity, unitPriceCents: l.unit_price_cents })),
    discountCents: input.discount_cents ?? 0,
    taxPercent: input.tax_percent,
    taxEnabled: settings.estimate_tax_enabled,
  })

  const header = {
    title: input.title,
    contact_id: input.contact_id ?? null,
    lead_id: input.lead_id ?? null,
    project_id: input.project_id ?? null,
    property_address: input.property_address ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    zip: input.zip ?? null,
    service_type: input.service_type ?? null,
    scope_summary: input.scope_summary ?? null,
    status: input.status,
    subtotal_cents: totals.subtotalCents,
    discount_cents: totals.discountCents,
    tax_percent: settings.estimate_tax_enabled ? input.tax_percent : 0,
    tax_cents: totals.taxCents,
    total_cents: totals.totalCents,
    valid_until: input.valid_until ?? defaultValidUntil(settings.estimate_valid_days),
    customer_notes: input.customer_notes ?? settings.estimate_default_notes ?? null,
    internal_notes: input.internal_notes ?? null,
    assigned_to: input.assigned_to ?? null,
  }

  let id = estimateId ?? null

  if (id) {
    const { error } = await supabase.from('estimates').update(header).eq('id', id)
    if (error) {
      console.error('[estimates] update failed', error)
      return { ok: false, error: 'The estimate could not be saved.' }
    }
  } else {
    const { data, error } = await supabase
      .from('estimates')
      .insert({ ...header, created_by: actorUserId })
      .select('id, estimate_number')
      .single()
    if (error || !data) {
      console.error('[estimates] insert failed', error)
      return { ok: false, error: 'The estimate could not be created.' }
    }
    id = data.id as string
    await logActivity(supabase, {
      action: 'estimate.created',
      entityType: 'estimate',
      entityId: id,
      actorUserId,
      metadata: { estimate_number: data.estimate_number, total_cents: totals.totalCents },
    })
  }

  const lineResult = await replaceLines(supabase, id, input.lines)
  if (!lineResult.ok) return { ok: false, estimateId: id, error: lineResult.error }

  if (estimateId) {
    await logActivity(supabase, {
      action: 'record.updated',
      entityType: 'estimate',
      entityId: id,
      actorUserId,
      metadata: { total_cents: totals.totalCents, lines: input.lines.length },
    })
  }

  return { ok: true, estimateId: id }
}

/**
 * Lines are replaced wholesale rather than diffed. An estimate's lines are a
 * single edited document, not independently addressable records, and a delete
 * + insert inside one save is far easier to reason about than a three-way merge.
 */
async function replaceLines(
  supabase: SupabaseClient,
  estimateId: string,
  lines: EstimateLineInput[],
): Promise<{ ok: boolean; error?: string }> {
  const { error: deleteError } = await supabase
    .from('estimate_line_items').delete().eq('estimate_id', estimateId)
  if (deleteError) {
    console.error('[estimates] could not clear lines', deleteError)
    return { ok: false, error: 'The estimate lines could not be saved.' }
  }

  if (lines.length === 0) return { ok: true }

  const rows = lines.map((line, index) => ({
    estimate_id: estimateId,
    sort_order: line.sort_order ?? index,
    category: line.category ?? null,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unit_price_cents: line.unit_price_cents,
    labor_cost_cents: line.labor_cost_cents ?? null,
    material_cost_cents: line.material_cost_cents ?? null,
    markup_percent: line.markup_percent ?? null,
    line_total_cents: lineTotalCents({ quantity: line.quantity, unitPriceCents: line.unit_price_cents }),
    pricebook_item_id: line.pricebook_item_id ?? null,
    source: line.source,
    ai_generated: line.ai_generated,
    needs_review: line.needs_review,
    notes: line.notes ?? null,
  }))

  const { error } = await supabase.from('estimate_line_items').insert(rows)
  if (error) {
    console.error('[estimates] line insert failed', error)
    return { ok: false, error: 'The estimate saved but its lines did not. Please re-open and check it.' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/**
 * Legal status moves. The one that matters: an AI draft cannot go straight to
 * Sent — it has to pass through Ready for Review, which is where a person
 * takes responsibility for the numbers.
 */
const ALLOWED_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['draft', 'ai_draft', 'measuring', 'ready_for_review', 'sent', 'declined'],
  ai_draft: ['draft', 'measuring', 'ready_for_review', 'declined'],
  measuring: ['draft', 'ai_draft', 'ready_for_review', 'declined'],
  ready_for_review: ['draft', 'sent', 'approved', 'declined'],
  sent: ['viewed', 'approved', 'declined', 'expired', 'ready_for_review'],
  viewed: ['approved', 'declined', 'expired', 'sent'],
  approved: ['converted', 'declined'],
  declined: ['draft', 'ready_for_review'],
  expired: ['draft', 'ready_for_review'],
  converted: [],
}

export function canTransition(from: EstimateStatus, to: EstimateStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export function transitionError(from: EstimateStatus, to: EstimateStatus): string {
  if (HUMAN_REVIEW_REQUIRED_FROM.includes(from) && (to === 'sent' || to === 'approved')) {
    return 'An AI draft has to be reviewed by a person first. Move it to “Ready for Review”, check every line, then send it.'
  }
  if (from === 'converted') {
    return 'This estimate has already been converted to a job and cannot change.'
  }
  return `An estimate cannot go from ${from.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}.`
}

export async function setEstimateStatus(
  supabase: SupabaseClient,
  params: {
    estimateId: string
    to: EstimateStatus
    actorUserId: string
    declineReason?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data: estimate } = await supabase
    .from('estimates')
    .select('id, status, estimate_number, total_cents, estimate_line_items(needs_review)')
    .eq('id', params.estimateId)
    .maybeSingle()

  if (!estimate) return { ok: false, error: 'Estimate not found.' }

  const from = estimate.status as EstimateStatus
  if (from === params.to) return { ok: true }
  if (!canTransition(from, params.to)) {
    return { ok: false, error: transitionError(from, params.to) }
  }

  // Anything with an unreviewed line cannot reach a customer.
  if (params.to === 'sent' || params.to === 'ready_for_review') {
    const lines = (estimate.estimate_line_items ?? []) as { needs_review: boolean }[]
    const flagged = lines.filter(l => l.needs_review).length
    if (flagged > 0) {
      return {
        ok: false,
        error: `${flagged} line${flagged === 1 ? ' is' : 's are'} still flagged for review. Confirm the pricing on ${flagged === 1 ? 'it' : 'them'} first.`,
      }
    }
    if (lines.length === 0) {
      return { ok: false, error: 'Add at least one line item before sending this estimate.' }
    }
  }

  const patch: Record<string, unknown> = { status: params.to }
  if (params.to === 'sent') patch.sent_at = new Date().toISOString()
  if (params.to === 'viewed') patch.viewed_at = new Date().toISOString()
  if (params.to === 'approved') patch.approved_at = new Date().toISOString()
  if (params.to === 'declined') {
    patch.declined_at = new Date().toISOString()
    patch.decline_reason = params.declineReason ?? null
  }

  const { error } = await supabase.from('estimates').update(patch).eq('id', params.estimateId)
  if (error) {
    console.error('[estimates] status change failed', error)
    return { ok: false, error: 'The status could not be changed.' }
  }

  const action =
    params.to === 'sent' ? 'estimate.sent'
    : params.to === 'approved' ? 'estimate.approved'
    : params.to === 'declined' ? 'estimate.declined'
    : 'status.changed'

  await logActivity(supabase, {
    action: action as 'estimate.sent',
    entityType: 'estimate',
    entityId: params.estimateId,
    actorUserId: params.actorUserId,
    metadata: { from, to: params.to, estimate_number: estimate.estimate_number },
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Convert an approved estimate into a job
// ---------------------------------------------------------------------------

export interface ConvertEstimateResult {
  ok: boolean
  projectId?: string
  error?: string
}

/**
 * Creates a job from an approved estimate.
 *
 * The estimate is retained and linked, never consumed. Copying the estimate
 * total into the contract amount is explicit — it is the number the company
 * will be measured on for profitability, so it is never assumed.
 */
export async function convertEstimateToProject(
  supabase: SupabaseClient,
  params: {
    estimateId: string
    actorUserId: string
    copyTotalToContract: boolean
    projectManagerId?: string | null
  },
): Promise<ConvertEstimateResult> {
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, estimate_line_items(*)')
    .eq('id', params.estimateId)
    .maybeSingle<Estimate>()

  if (!estimate) return { ok: false, error: 'Estimate not found.' }
  if (estimate.converted_project_id) {
    return { ok: true, projectId: estimate.converted_project_id }
  }
  if (estimate.status !== 'approved') {
    return { ok: false, error: 'Only an approved estimate can become a job. Mark it approved first.' }
  }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      project_name: estimate.title,
      customer_id: estimate.contact_id,
      jobsite_address: estimate.property_address,
      city: estimate.city,
      state: estimate.state,
      zip: estimate.zip,
      service_category: estimate.service_type,
      description: estimate.scope_summary,
      status: 'preconstruction',
      project_manager_id: params.projectManagerId ?? null,
      estimate_amount_cents: estimate.total_cents,
      contract_amount_cents: params.copyTotalToContract ? estimate.total_cents : null,
      source_estimate_id: estimate.id,
    })
    .select('id, project_number')
    .single()

  if (error || !project) {
    console.error('[estimates] conversion failed', error)
    return { ok: false, error: 'The job could not be created.' }
  }

  const projectId = project.id as string

  await supabase
    .from('estimates')
    .update({ status: 'converted', converted_project_id: projectId, project_id: projectId })
    .eq('id', estimate.id)

  // Carry the measurement and photos across so the crew has them on the job.
  await supabase.from('roof_measurements')
    .update({ project_id: projectId }).eq('estimate_id', estimate.id).is('project_id', null)

  if (estimate.lead_id) {
    await supabase.from('leads')
      .update({ converted_project_id: projectId, pipeline_stage: 'won' })
      .eq('id', estimate.lead_id)
      .is('converted_project_id', null)
  }

  await logActivity(supabase, {
    action: 'estimate.converted_to_job',
    entityType: 'estimate',
    entityId: estimate.id,
    actorUserId: params.actorUserId,
    metadata: {
      project_id: projectId,
      project_number: project.project_number,
      contract_copied: params.copyTotalToContract,
      total_cents: estimate.total_cents,
    },
  })

  return { ok: true, projectId }
}

// ---------------------------------------------------------------------------
// Pricebook
// ---------------------------------------------------------------------------

export async function loadPricebook(
  supabase: SupabaseClient,
  opts: { serviceType?: string | null; activeOnly?: boolean } = {},
): Promise<PricebookItem[]> {
  let query = supabase.from('pricebook_items').select('*').order('category').order('name')
  if (opts.activeOnly !== false) query = query.eq('active', true)
  const { data } = await query
  const items = (data ?? []) as PricebookItem[]

  if (!opts.serviceType) return items
  // Items with no service_type are general (permits, mobilisation, labor) and
  // apply to every job, so they are always offered.
  return items.filter(i => !i.service_type || i.service_type === opts.serviceType)
}

function defaultValidUntil(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

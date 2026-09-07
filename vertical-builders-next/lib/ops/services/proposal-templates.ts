import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProposalTemplateInput } from '../validations/proposal-template'
import { logActivity } from './activity'

/**
 * ============================================================================
 * PROPOSAL TEMPLATES
 * ----------------------------------------------------------------------------
 * Reusable proposal wording, kept separate from the pricebook because the two
 * answer different questions: the pricebook is what a square of tile costs, a
 * template is what a tile roof proposal SAYS.
 *
 * The rule that shapes everything here: APPLYING A TEMPLATE IS A COPY. Lines
 * are read out and written into the estimate's own rows. Editing a template
 * next month cannot reach backwards into a proposal already sent, and editing
 * an estimate cannot alter the template it came from. Anything else would mean
 * a customer's signed figures changing under them.
 * ============================================================================
 */

export interface ProposalTemplateLine {
  id: string
  sort_order: number
  category: string | null
  description: string
  unit: string
  default_quantity: number | null
  default_unit_price_cents: number | null
  pricebook_item_id: string | null
  notes: string | null
}

export interface ProposalTemplate {
  id: string
  name: string
  description: string | null
  service_type: string | null
  scope_summary: string | null
  customer_notes: string | null
  active: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
  lines: ProposalTemplateLine[]
}

export interface TemplateSummary {
  id: string
  name: string
  service_type: string | null
  description: string | null
  line_count: number
  updated_at: string
  archived_at: string | null
}

const LINE_COLUMNS =
  'id, sort_order, category, description, unit, default_quantity, default_unit_price_cents, pricebook_item_id, notes'

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listProposalTemplates(
  supabase: SupabaseClient,
  options: { includeArchived?: boolean } = {},
): Promise<TemplateSummary[]> {
  let query = supabase
    .from('estimate_proposal_templates')
    .select('id, name, service_type, description, updated_at, archived_at, estimate_proposal_template_lines(id)')
    .order('name')
    .limit(500)

  if (!options.includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query
  if (error) {
    console.error('[templates] list failed', error.message)
    return []
  }

  return (data ?? []).map(row => ({
    id: row.id as string,
    name: row.name as string,
    service_type: (row.service_type as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    line_count: Array.isArray(row.estimate_proposal_template_lines)
      ? row.estimate_proposal_template_lines.length
      : 0,
    updated_at: row.updated_at as string,
    archived_at: (row.archived_at as string | null) ?? null,
  }))
}

export async function loadProposalTemplate(
  supabase: SupabaseClient,
  id: string,
): Promise<ProposalTemplate | null> {
  const { data, error } = await supabase
    .from('estimate_proposal_templates')
    .select(`id, name, description, service_type, scope_summary, customer_notes, active,
             archived_at, created_at, updated_at,
             estimate_proposal_template_lines(${LINE_COLUMNS})`)
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null

  const lines = (data.estimate_proposal_template_lines ?? []) as unknown as ProposalTemplateLine[]
  return {
    ...(data as unknown as Omit<ProposalTemplate, 'lines'>),
    lines: [...lines].sort((a, b) => a.sort_order - b.sort_order),
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface SaveTemplateResult {
  ok: boolean
  templateId?: string
  error?: string
}

export async function saveProposalTemplate(
  supabase: SupabaseClient,
  input: ProposalTemplateInput,
  actorUserId: string,
  templateId?: string | null,
): Promise<SaveTemplateResult> {
  const header = {
    name: input.name,
    description: input.description ?? null,
    service_type: input.service_type ?? null,
    scope_summary: input.scope_summary ?? null,
    customer_notes: input.customer_notes ?? null,
  }

  let id = templateId ?? null

  if (id) {
    const { error } = await supabase.from('estimate_proposal_templates').update(header).eq('id', id)
    if (error) {
      console.error('[templates] update failed', error.message)
      return { ok: false, error: 'The template could not be saved.' }
    }
  } else {
    const { data, error } = await supabase
      .from('estimate_proposal_templates')
      .insert({ ...header, created_by: actorUserId })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[templates] insert failed', error?.message)
      return { ok: false, error: 'The template could not be created.' }
    }
    id = data.id as string
  }

  // Lines are replaced wholesale. A template is small and edited as a unit, so
  // diffing rows would add a failure mode for no benefit.
  const { error: clearError } = await supabase
    .from('estimate_proposal_template_lines').delete().eq('template_id', id)
  if (clearError) {
    console.error('[templates] line clear failed', clearError.message)
    return { ok: false, error: 'The template lines could not be saved.' }
  }

  if (input.lines.length > 0) {
    const { error: insertError } = await supabase
      .from('estimate_proposal_template_lines')
      .insert(input.lines.map((line, index) => ({
        template_id: id,
        sort_order: index,
        category: line.category ?? null,
        description: line.description,
        unit: line.unit,
        // Blank stays blank. See the validation module for why.
        default_quantity: line.default_quantity,
        default_unit_price_cents: line.default_unit_price_cents,
        pricebook_item_id: line.pricebook_item_id ?? null,
        notes: line.notes ?? null,
      })))
    if (insertError) {
      console.error('[templates] line insert failed', insertError.message)
      return { ok: false, error: 'The template lines could not be saved.' }
    }
  }

  await logActivity(supabase, {
    action: templateId ? 'proposal_template.updated' : 'proposal_template.created',
    entityType: 'proposal_template',
    entityId: id,
    actorUserId,
    // The name and the shape, not the prose. A proposal's wording is not
    // activity-log material.
    metadata: { name: input.name, lines: input.lines.length },
  })

  return { ok: true, templateId: id }
}

/**
 * Copies a template into a new one.
 *
 * A genuine copy, not a reference: the duplicate can be edited to nothing and
 * the original is untouched. That is what makes "start from Tile Roof and
 * adjust" safe for someone who has one good template and wants a variant.
 */
export async function duplicateProposalTemplate(
  supabase: SupabaseClient,
  id: string,
  actorUserId: string,
): Promise<SaveTemplateResult> {
  const source = await loadProposalTemplate(supabase, id)
  if (!source) return { ok: false, error: 'That template could not be found.' }

  return saveProposalTemplate(
    supabase,
    {
      name: `${source.name} (copy)`.slice(0, 120),
      description: source.description ?? undefined,
      service_type: source.service_type ?? undefined,
      scope_summary: source.scope_summary ?? undefined,
      customer_notes: source.customer_notes ?? undefined,
      lines: source.lines.map((line, index) => ({
        sort_order: index,
        category: line.category ?? undefined,
        description: line.description,
        unit: line.unit as ProposalTemplateInput['lines'][number]['unit'],
        default_quantity: line.default_quantity,
        default_unit_price_cents: line.default_unit_price_cents,
        pricebook_item_id: line.pricebook_item_id,
        notes: line.notes ?? undefined,
      })),
    },
    actorUserId,
  )
}

/**
 * Archives a template.
 *
 * Soft, like every other removal in this product. Estimates already built from
 * it are untouched — they hold their own copies of the lines, so archiving the
 * template cannot change a proposal that is already with a customer.
 */
export async function archiveProposalTemplate(
  supabase: SupabaseClient,
  id: string,
  actorUserId: string,
  restore = false,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('estimate_proposal_templates')
    .update({ archived_at: restore ? null : new Date().toISOString(), active: restore })
    .eq('id', id)

  if (error) {
    console.error('[templates] archive failed', error.message)
    return { ok: false, error: 'The template could not be archived.' }
  }

  await logActivity(supabase, {
    action: restore ? 'proposal_template.restored' : 'proposal_template.archived',
    entityType: 'proposal_template',
    entityId: id,
    actorUserId,
  })
  return { ok: true }
}

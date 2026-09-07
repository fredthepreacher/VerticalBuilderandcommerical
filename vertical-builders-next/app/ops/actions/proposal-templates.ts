'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCapability } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import {
  archiveProposalTemplate, duplicateProposalTemplate, loadProposalTemplate,
  saveProposalTemplate,
} from '@/lib/ops/services/proposal-templates'
import {
  proposalTemplateSchema, FORBIDDEN_TEMPLATE_FIELDS,
} from '@/lib/ops/validations/proposal-template'
import { failure, handleUnexpected, str, success, zodToState, type ActionState } from '@/lib/ops/actions-shared'

/**
 * ============================================================================
 * PROPOSAL TEMPLATE ACTIONS
 * ----------------------------------------------------------------------------
 * Managing templates is `pricebookManage` — admin/office. A template is shared
 * company wording, so a project manager editing one changes what every future
 * proposal says. `read_only` cannot reach any of this.
 *
 * The interesting one is `saveEstimateAsTemplateAction`. It builds the template
 * from a NAMED LIST of proposal fields rather than by copying an estimate and
 * deleting the customer bits — a subtractive approach would silently leak
 * whatever field somebody adds to estimates next year.
 * ============================================================================
 */

const TEMPLATES_PATH = '/ops/estimates/templates'

/** Reads `line[n][field]` out of the form, the same shape the estimate uses. */
function collectLines(form: FormData): Record<string, unknown>[] {
  const indexes = new Set<number>()
  for (const key of form.keys()) {
    const match = key.match(/^line\[(\d+)\]/)
    if (match) indexes.add(Number(match[1]))
  }

  const lines: Record<string, unknown>[] = []
  for (const i of Array.from(indexes).sort((a, b) => a - b)) {
    const get = (field: string) => {
      const value = form.get(`line[${i}][${field}]`)
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    }
    const description = get('description')
    if (!description) continue   // an untouched blank row

    lines.push({
      id: get('id'),
      sort_order: lines.length,
      category: get('category'),
      description,
      unit: get('unit') ?? 'EA',
      // Undefined, not a default. A blank rate on a template means "price it
      // when you measure the job", and turning that into 0 would print $0.00
      // on a customer's proposal.
      default_quantity: get('default_quantity'),
      default_unit_price_cents: get('default_unit_price'),
      pricebook_item_id: get('pricebook_item_id'),
      notes: get('notes'),
    })
  }
  return lines
}

export async function saveProposalTemplateAction(
  templateId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('pricebookManage')

    const parsed = proposalTemplateSchema.safeParse({
      name: str(form, 'name') ?? '',
      description: str(form, 'description'),
      service_type: str(form, 'service_type'),
      scope_summary: str(form, 'scope_summary'),
      customer_notes: str(form, 'customer_notes'),
      lines: collectLines(form),
    })

    if (!parsed.success) return zodToState(parsed.error)

    const supabase = createSupabaseServerClient()
    const result = await saveProposalTemplate(supabase, parsed.data, user.id, templateId)
    if (!result.ok) return failure(result.error ?? 'The template could not be saved.')

    revalidatePath(TEMPLATES_PATH)
    if (templateId) revalidatePath(`${TEMPLATES_PATH}/${templateId}`)
    if (!templateId) redirect(`${TEMPLATES_PATH}/${result.templateId}`)

    return success('Template saved.', { templateId: result.templateId ?? '' })
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveProposalTemplate', error)
  }
}

export async function duplicateProposalTemplateAction(id: string): Promise<ActionState> {
  try {
    const user = await requireCapability('pricebookManage')
    const supabase = createSupabaseServerClient()
    const result = await duplicateProposalTemplate(supabase, id, user.id)
    if (!result.ok) return failure(result.error ?? 'The template could not be duplicated.')

    revalidatePath(TEMPLATES_PATH)
    return success('Duplicated.', { templateId: result.templateId ?? '' })
  } catch (error) {
    return handleUnexpected('duplicateProposalTemplate', error)
  }
}

export async function archiveProposalTemplateAction(id: string, restore = false): Promise<ActionState> {
  try {
    const user = await requireCapability('pricebookManage')
    const supabase = createSupabaseServerClient()
    const result = await archiveProposalTemplate(supabase, id, user.id, restore)
    if (!result.ok) return failure(result.error ?? 'The template could not be archived.')

    revalidatePath(TEMPLATES_PATH)
    // Estimates built from this template are untouched — they hold their own
    // copies of the lines.
    return success(restore ? 'Template restored.' : 'Template archived.')
  } catch (error) {
    return handleUnexpected('archiveProposalTemplate', error)
  }
}

/**
 * "Save this estimate as a proposal template."
 *
 * Additive by construction: the template is assembled from a named list of
 * proposal fields. Nothing is copied wholesale and then scrubbed, because a
 * subtractive approach leaks whatever field somebody adds to estimates next
 * year. `FORBIDDEN_TEMPLATE_FIELDS` documents what must never appear, and the
 * tests assert against it.
 */
export async function saveEstimateAsTemplateAction(
  estimateId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('pricebookManage')
    const name = str(form, 'name')
    if (!name) return failure('Give the template a name — that is how you will find it later.')

    const supabase = createSupabaseServerClient()

    const { data: estimate } = await supabase
      .from('estimates')
      // Proposal content only. No contact, no lead, no project, no address, no
      // estimate number — see FORBIDDEN_TEMPLATE_FIELDS.
      .select('id, service_type, scope_summary, customer_notes')
      .eq('id', estimateId)
      .maybeSingle()

    if (!estimate) return failure('That estimate could not be found.')

    const { data: lines } = await supabase
      .from('estimate_line_items')
      .select('sort_order, category, description, unit, quantity, unit_price_cents, pricebook_item_id, notes')
      .eq('estimate_id', estimateId)
      .order('sort_order')

    const parsed = proposalTemplateSchema.safeParse({
      name,
      service_type: estimate.service_type ?? undefined,
      scope_summary: estimate.scope_summary ?? undefined,
      customer_notes: estimate.customer_notes ?? undefined,
      lines: (lines ?? []).map((line, index) => ({
        sort_order: index,
        category: line.category ?? undefined,
        description: line.description as string,
        unit: line.unit as string,
        // This job's measured quantity and agreed rate are carried over as
        // starting points, but they are the one part a reviewer is most likely
        // to want blank — the editor lets them clear both.
        default_quantity: line.quantity,
        default_unit_price_cents: (line.unit_price_cents as number) / 100,
        pricebook_item_id: line.pricebook_item_id ?? undefined,
        notes: line.notes ?? undefined,
      })),
    })

    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? 'That estimate could not be saved as a template.')
    }

    // Belt and braces: if a forbidden key ever reaches the payload, refuse
    // rather than store it. `.strict()` already drops unknown keys; this turns
    // a silent drop into a visible failure during development.
    for (const forbidden of FORBIDDEN_TEMPLATE_FIELDS) {
      if (forbidden in (parsed.data as Record<string, unknown>)) {
        console.error('[templates] refused to store a forbidden field', forbidden)
        return failure('That estimate could not be saved as a template.')
      }
    }

    const result = await saveProposalTemplate(supabase, parsed.data, user.id)
    if (!result.ok) return failure(result.error ?? 'The template could not be created.')

    await logActivity(supabase, {
      action: 'proposal_template.created',
      entityType: 'proposal_template',
      entityId: result.templateId!,
      actorUserId: user.id,
      metadata: { from_estimate: estimateId, lines: parsed.data.lines.length },
    })

    revalidatePath(TEMPLATES_PATH)
    return success(`Saved as “${parsed.data.name}”.`, { templateId: result.templateId ?? '' })
  } catch (error) {
    return handleUnexpected('saveEstimateAsTemplate', error)
  }
}

/**
 * Reads a template for the estimate builder to apply in the browser.
 *
 * Deliberately a read: applying happens in client state so the operator can
 * edit everything before saving, and so the template itself is never mutated by
 * being used.
 */
export async function loadTemplateForEstimateAction(templateId: string): Promise<ActionState> {
  try {
    await requireCapability('estimatesCreate')
    const supabase = createSupabaseServerClient()
    const template = await loadProposalTemplate(supabase, templateId)
    if (!template) return failure('That template could not be found.')

    return success('Template loaded.', { template: JSON.stringify(template) })
  } catch (error) {
    return handleUnexpected('loadTemplateForEstimate', error)
  }
}

function isRedirect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
}

'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCapability, requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { logActivity } from '@/lib/ops/services/activity'
import {
  convertEstimateToProject, loadPricebook, saveEstimate, setEstimateStatus,
} from '@/lib/ops/services/estimates'
import { uploadDocument } from '@/lib/ops/services/documents'
import { getSettings } from '@/lib/ops/services/settings'
import { AiUnavailableError, generateEstimateDraft } from '@/lib/ops/estimating/ai'
import { deriveQuantities, getProvider, ProviderNotConfiguredError } from '@/lib/ops/measurements/provider'
import { estimateSchema, pricebookItemSchema, roofMeasurementSchema } from '@/lib/ops/validations/estimate'
import { lineTotalCents } from '@/lib/ops/finance/calc'
import type { EstimateStatus, PricebookItem } from '@/lib/ops/types'
import {
  failure, handleUnexpected, str, strList, success, zodToState, type ActionState,
} from '@/lib/ops/actions-shared'

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export async function saveEstimateAction(
  estimateId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability(estimateId ? 'estimatesEdit' : 'estimatesCreate')
    const supabase = createSupabaseServerClient()

    const parsed = estimateSchema.safeParse({
      title: str(form, 'title') ?? '',
      contact_id: str(form, 'contact_id') ?? '',
      lead_id: str(form, 'lead_id') ?? '',
      project_id: str(form, 'project_id') ?? '',
      property_address: str(form, 'property_address'),
      city: str(form, 'city'),
      state: str(form, 'state'),
      zip: str(form, 'zip'),
      service_type: str(form, 'service_type'),
      scope_summary: str(form, 'scope_summary'),
      status: str(form, 'status') ?? 'draft',
      discount_cents: str(form, 'discount') ?? '0',
      tax_percent: str(form, 'tax_percent') ?? '0',
      valid_until: str(form, 'valid_until') ?? '',
      customer_notes: str(form, 'customer_notes'),
      internal_notes: str(form, 'internal_notes'),
      assigned_to: str(form, 'assigned_to') ?? '',
      lines: parseLines(form),
    })
    if (!parsed.success) return zodToState(parsed.error)

    const result = await saveEstimate(supabase, parsed.data, user.id, estimateId)
    if (!result.ok) return failure(result.error!)

    revalidatePath('/ops/estimates')
    if (estimateId) {
      revalidatePath(`/ops/estimates/${estimateId}`)
      return success('Estimate saved.')
    }
    redirect(`/ops/estimates/${result.estimateId}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveEstimate', error)
  }
}

/**
 * Generate an AI draft.
 *
 * Runs against the SAVED estimate and returns proposed lines for the operator
 * to accept — it never writes over unsaved work in the browser, and it never
 * changes an estimate that a human has already reviewed without them asking.
 */
export async function generateAiDraft(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('aiGenerate')
    const supabase = createSupabaseServerClient()

    const estimateId = str(form, 'estimate_id')
    if (!estimateId) return failure('Save the estimate first, then generate a draft.')

    const { data: estimate } = await supabase
      .from('estimates')
      .select('*, estimate_line_items(id)')
      .eq('id', estimateId)
      .maybeSingle()
    if (!estimate) return failure('Estimate not found.')

    if (estimate.status === 'converted' || estimate.status === 'approved') {
      return failure('This estimate has already been approved. Generating a draft over it is not allowed.')
    }

    const existingLines = (estimate.estimate_line_items ?? []) as { id: string }[]
    const replaceExisting = form.get('replace_existing') === 'on'
    if (existingLines.length > 0 && !replaceExisting) {
      return failure(
        `This estimate already has ${existingLines.length} line${existingLines.length === 1 ? '' : 's'}. ` +
        'Tick “replace existing lines” if you want the AI draft to overwrite them.',
      )
    }

    const { data: measurement } = await supabase
      .from('roof_measurements')
      .select('*')
      .eq('estimate_id', estimateId)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const pricebook = await loadPricebook(supabase, { serviceType: estimate.service_type as string | null })

    let result
    try {
      result = await generateEstimateDraft({
        serviceType: (estimate.service_type as string) ?? 'General contracting',
        property: {
          address: estimate.property_address as string | null,
          city: estimate.city as string | null,
          state: estimate.state as string | null,
          zip: estimate.zip as string | null,
        },
        customerRequest: [estimate.scope_summary, estimate.internal_notes].filter(Boolean).join('\n\n')
          || (str(form, 'prompt') ?? ''),
        measurements: measurement
          ? {
              roofAreaSquares: measurement.roof_area_squares as number | null,
              roofAreaSqft: measurement.roof_area_sqft as number | null,
              primaryPitch: measurement.primary_pitch as string | null,
              facetCount: measurement.facet_count as number | null,
              ridgeLf: measurement.ridge_lf as number | null,
              hipLf: measurement.hip_lf as number | null,
              valleyLf: measurement.valley_lf as number | null,
              eaveLf: measurement.eave_lf as number | null,
              rakeLf: measurement.rake_lf as number | null,
              wasteFactorPercent: measurement.waste_factor_percent as number | null,
              provider: measurement.provider as string,
            }
          : null,
        pricebook,
      })
    } catch (error) {
      if (error instanceof AiUnavailableError) return failure(error.message)
      throw error
    }

    // Persist the proposed lines, all flagged per the sanitizer's verdict.
    await supabase.from('estimate_line_items').delete().eq('estimate_id', estimateId)

    const byId = new Map(pricebook.map((p: PricebookItem) => [p.id, p]))
    const rows = result.lineItems.map((line, index) => {
      const item = line.pricebookItemId ? byId.get(line.pricebookItemId) : undefined
      const unitPrice = item?.default_unit_price_cents ?? 0
      return {
        estimate_id: estimateId,
        sort_order: index,
        category: item?.category ?? null,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price_cents: unitPrice,
        line_total_cents: lineTotalCents({ quantity: line.quantity, unitPriceCents: unitPrice }),
        pricebook_item_id: line.pricebookItemId ?? null,
        source: 'ai',
        ai_generated: true,
        needs_review: line.needsReview,
        notes: line.reasoningLabel ?? null,
      }
    })

    if (rows.length > 0) {
      const { error } = await supabase.from('estimate_line_items').insert(rows)
      if (error) {
        console.error('[estimates] ai line insert failed', error)
        return failure('The draft was generated but its lines could not be saved.')
      }
    }

    const subtotal = rows.reduce((sum, r) => sum + r.line_total_cents, 0)
    await supabase.from('estimates').update({
      status: 'ai_draft',
      scope_summary: result.scopeSummary || estimate.scope_summary,
      subtotal_cents: subtotal,
      total_cents: subtotal - (estimate.discount_cents as number),
      ai_metadata_json: {
        ...result.metadata,
        assumptions: result.assumptions,
        warnings: result.warnings,
      },
    }).eq('id', estimateId)

    await logActivity(supabase, {
      action: 'estimate.ai_generated',
      entityType: 'estimate',
      entityId: estimateId,
      actorUserId: user.id,
      metadata: {
        model: result.metadata.model,
        prompt_version: result.metadata.promptVersion,
        lines: rows.length,
        needs_review: result.metadata.linesNeedingReview,
        used_measurements: result.metadata.usedMeasurements,
      },
    })

    revalidatePath(`/ops/estimates/${estimateId}`)

    const flagged = result.metadata.linesNeedingReview
    return success(
      `Draft generated: ${rows.length} line${rows.length === 1 ? '' : 's'}` +
      (flagged > 0 ? `, ${flagged} needing your review before this can be sent.` : '.') +
      ' Check every quantity and price against the job.',
      { warnings: result.warnings, assumptions: result.assumptions },
    )
  } catch (error) {
    return handleUnexpected('generateAiDraft', error)
  }
}

export async function setEstimateStatusAction(
  estimateId: string,
  to: EstimateStatus,
  reason?: string | null,
): Promise<ActionState> {
  try {
    // Putting an estimate in front of a customer is a commercial act.
    const capability = to === 'sent' ? 'estimatesSend' : 'estimatesEdit'
    const user = await requireCapability(capability)
    const supabase = createSupabaseServerClient()

    const result = await setEstimateStatus(supabase, {
      estimateId, to, actorUserId: user.id, declineReason: reason ?? null,
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath(`/ops/estimates/${estimateId}`)
    revalidatePath('/ops/estimates')
    return success('Status updated.')
  } catch (error) {
    return handleUnexpected('setEstimateStatus', error)
  }
}

export async function convertEstimateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('estimatesConvert')
    const supabase = createSupabaseServerClient()

    const estimateId = str(form, 'estimate_id')
    if (!estimateId) return failure('Estimate is required.')

    const result = await convertEstimateToProject(supabase, {
      estimateId,
      actorUserId: user.id,
      copyTotalToContract: form.get('copy_total') === 'on',
      projectManagerId: str(form, 'project_manager_id') ?? null,
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath('/ops/projects')
    revalidatePath('/ops/estimates')
    redirect(`/ops/projects/${result.projectId}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('convertEstimate', error)
  }
}

export async function uploadEstimatePhoto(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('estimatesEdit')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()
    const settings = await getSettings(supabase)

    const estimateId = str(form, 'estimate_id')
    const file = form.get('file')
    if (!estimateId) return failure('Estimate is required.')
    if (!(file instanceof File) || file.size === 0) return failure('Choose a photo to upload.')

    const upload = await uploadDocument(admin, {
      file,
      entityType: 'estimate',
      entityId: estimateId,
      documentType: 'photo',
      folder: 'photos',
      uploadedBy: user.id,
      maxBytes: settings.max_upload_mb * 1024 * 1024,
    })
    if (!upload.ok) return failure(upload.error!)

    const { error } = await supabase.from('estimate_photos').insert({
      estimate_id: estimateId,
      document_id: upload.document!.id,
      caption: str(form, 'caption') ?? null,
      photo_type: str(form, 'photo_type') ?? 'other',
      customer_visible: form.get('customer_visible') === 'on',
    })
    if (error) return failure('The photo uploaded but could not be attached to the estimate.')

    revalidatePath(`/ops/estimates/${estimateId}`)
    return success('Photo added.')
  } catch (error) {
    return handleUnexpected('uploadEstimatePhoto', error)
  }
}

// ---------------------------------------------------------------------------
// Roof measurements
// ---------------------------------------------------------------------------

export async function saveMeasurement(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('measurementsCreate')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()

    const parsed = roofMeasurementSchema.safeParse({
      address: str(form, 'address') ?? '',
      project_id: str(form, 'project_id') ?? '',
      estimate_id: str(form, 'estimate_id') ?? '',
      provider: str(form, 'provider') ?? 'manual',
      roof_area_sqft: str(form, 'roof_area_sqft') ?? '',
      roof_area_squares: str(form, 'roof_area_squares') ?? '',
      primary_pitch: str(form, 'primary_pitch'),
      facet_count: str(form, 'facet_count') ?? '',
      ridge_lf: str(form, 'ridge_lf') ?? '',
      hip_lf: str(form, 'hip_lf') ?? '',
      valley_lf: str(form, 'valley_lf') ?? '',
      eave_lf: str(form, 'eave_lf') ?? '',
      rake_lf: str(form, 'rake_lf') ?? '',
      waste_factor_percent: str(form, 'waste_factor_percent') ?? '',
      notes: str(form, 'notes'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    // Derive whichever of sqft/squares was not entered, so downstream code and
    // the AI prompt always have both.
    const sqft = parsed.data.roof_area_sqft
      ?? (parsed.data.roof_area_squares !== null ? parsed.data.roof_area_squares * 100 : null)
    const squares = parsed.data.roof_area_squares
      ?? (parsed.data.roof_area_sqft !== null ? Math.round((parsed.data.roof_area_sqft / 100) * 10) / 10 : null)

    // Optional third-party report PDF.
    let documentId: string | null = null
    const file = form.get('report_file')
    if (file instanceof File && file.size > 0) {
      const settings = await getSettings(supabase)
      const upload = await uploadDocument(admin, {
        file,
        entityType: parsed.data.project_id ? 'project' : 'estimate',
        entityId: (parsed.data.project_id ?? parsed.data.estimate_id)!,
        documentType: 'measurement_report',
        folder: 'measurements',
        uploadedBy: user.id,
        maxBytes: settings.max_upload_mb * 1024 * 1024,
      })
      if (!upload.ok) return failure(upload.error!)
      documentId = upload.document!.id
    }

    const { data, error } = await supabase
      .from('roof_measurements')
      .insert({
        ...parsed.data,
        roof_area_sqft: sqft,
        roof_area_squares: squares,
        status: 'complete',
        source_document_id: documentId,
        requested_by: user.id,
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[measurements] insert failed', error)
      return failure('The measurement could not be saved.')
    }

    await logActivity(supabase, {
      action: 'roof_measurement.completed',
      entityType: parsed.data.estimate_id ? 'estimate' : 'project',
      entityId: parsed.data.estimate_id ?? parsed.data.project_id ?? null,
      actorUserId: user.id,
      metadata: { measurement_id: data.id, provider: parsed.data.provider, squares },
    })

    if (parsed.data.estimate_id) revalidatePath(`/ops/estimates/${parsed.data.estimate_id}`)
    if (parsed.data.project_id) revalidatePath(`/ops/projects/${parsed.data.project_id}`)

    const derived = deriveQuantities({
      roof_area_sqft: sqft, roof_area_squares: squares,
      ridge_lf: parsed.data.ridge_lf, hip_lf: parsed.data.hip_lf,
      eave_lf: parsed.data.eave_lf, rake_lf: parsed.data.rake_lf,
      waste_factor_percent: parsed.data.waste_factor_percent,
    })

    return success(
      `Measurement saved${derived.squaresWithWaste ? `: ${derived.squares} squares (${derived.squaresWithWaste} with waste).` : '.'}`,
      { squares: derived.squares ?? 0, squaresWithWaste: derived.squaresWithWaste ?? 0 },
    )
  } catch (error) {
    return handleUnexpected('saveMeasurement', error)
  }
}

/**
 * Orders a measurement from the configured provider. A missing credential is a
 * clearly-worded message, not a crash, and the manual path stays open.
 */
export async function orderMeasurement(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('measurementsOrder')
    const supabase = createSupabaseServerClient()
    const settings = await getSettings(supabase)

    const address = str(form, 'address')
    if (!address) return failure('Enter the property address.')

    const provider = getProvider(settings.roof_measurement_provider)
    if (provider.name === 'manual') {
      return failure('No measurement provider is configured. Enter the measurement by hand below, or upload a report.')
    }

    const estimateId = str(form, 'estimate_id') ?? null
    const projectId = str(form, 'project_id') ?? null

    try {
      const request = await provider.createMeasurementRequest({ address })

      const { data, error } = await supabase.from('roof_measurements').insert({
        address,
        estimate_id: estimateId,
        project_id: projectId,
        provider: provider.name,
        external_request_id: request.externalRequestId,
        status: request.status === 'complete' ? 'processing' : request.status,
        requested_by: user.id,
        requested_at: new Date().toISOString(),
      }).select('id').single()

      if (error || !data) return failure('The order was placed but could not be recorded. Check with the provider.')

      await logActivity(supabase, {
        action: 'roof_measurement.requested',
        entityType: estimateId ? 'estimate' : 'project',
        entityId: estimateId ?? projectId,
        actorUserId: user.id,
        metadata: { provider: provider.name, external_request_id: request.externalRequestId, address },
      })

      if (estimateId) revalidatePath(`/ops/estimates/${estimateId}`)
      return success(
        `Ordered from ${provider.displayName}. Reports usually take a few hours — refresh the measurement when it is ready.`,
      )
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) return failure(error.message)
      console.error('[measurements] order failed', error)
      await logActivity(supabase, {
        action: 'roof_measurement.failed',
        entityType: estimateId ? 'estimate' : 'project',
        entityId: estimateId ?? projectId,
        actorUserId: user.id,
        metadata: { provider: provider.name, address },
      })
      return failure(
        `${provider.displayName} could not take the order. Enter the measurement by hand, or upload the report — nothing else has changed.`,
      )
    }
  } catch (error) {
    return handleUnexpected('orderMeasurement', error)
  }
}

// ---------------------------------------------------------------------------
// Pricebook
// ---------------------------------------------------------------------------

export async function savePricebookItem(
  itemId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('pricebookManage')
    const supabase = createSupabaseServerClient()

    const parsed = pricebookItemSchema.safeParse({
      name: str(form, 'name') ?? '',
      category: str(form, 'category'),
      service_type: str(form, 'service_type'),
      description: str(form, 'description'),
      unit: str(form, 'unit') ?? 'EA',
      default_unit_price_cents: str(form, 'default_unit_price') ?? '0',
      default_material_cost_cents: str(form, 'default_material_cost') ?? '',
      default_labor_cost_cents: str(form, 'default_labor_cost') ?? '',
      active: form.get('active') !== null,
      tags: strList(form, 'tags'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    if (itemId) {
      const { error } = await supabase.from('pricebook_items').update(parsed.data).eq('id', itemId)
      if (error) return failure('The pricebook item could not be saved.')
    } else {
      const { error } = await supabase.from('pricebook_items').insert(parsed.data)
      if (error) return failure('The pricebook item could not be created.')
    }

    await logActivity(supabase, {
      action: 'pricebook.updated', entityType: 'pricebook', entityId: itemId,
      actorUserId: user.id, metadata: { name: parsed.data.name },
    })

    revalidatePath('/ops/settings')
    return success('Pricebook updated.')
  } catch (error) {
    return handleUnexpected('savePricebookItem', error)
  }
}

// ---------------------------------------------------------------------------
// Client → job
// ---------------------------------------------------------------------------

/**
 * "Create Job from Client". Carries the client's details forward and links the
 * existing contact — it never creates a second copy of the person.
 */
export async function createJobFromClient(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()

    const contactId = str(form, 'contact_id')
    if (!contactId) return failure('Client is required.')

    const { data: contact } = await supabase
      .from('contacts').select('*').eq('id', contactId).maybeSingle()
    if (!contact) return failure('Client not found.')

    const estimateId = str(form, 'estimate_id') ?? null
    let estimate: Record<string, unknown> | null = null
    if (estimateId) {
      const { data } = await supabase
        .from('estimates').select('*').eq('id', estimateId).eq('contact_id', contactId).maybeSingle()
      estimate = data
    }

    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
      || (contact.company_name as string) || 'Client'
    const serviceType = str(form, 'service_type') ?? (estimate?.service_type as string | null) ?? null

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        project_name: str(form, 'project_name')
          ?? (estimate?.title as string | undefined)
          ?? `${name} — ${serviceType ?? 'Project'}`,
        customer_id: contactId,                       // linked, never duplicated
        jobsite_address: str(form, 'jobsite_address') ?? (contact.billing_address as string | null),
        city: str(form, 'city') ?? (contact.city as string | null),
        state: str(form, 'state') ?? (contact.state as string | null),
        zip: str(form, 'zip') ?? (contact.zip as string | null),
        customer_type: contact.contact_type === 'business' ? 'commercial' : 'residential',
        service_category: serviceType,
        description: str(form, 'description') ?? (estimate?.scope_summary as string | null),
        status: 'preconstruction',
        project_manager_id: str(form, 'project_manager_id') ?? null,
        estimate_amount_cents: (estimate?.total_cents as number | undefined) ?? null,
        contract_amount_cents:
          estimate && form.get('copy_total') === 'on' ? (estimate.total_cents as number) : null,
        source_estimate_id: estimateId,
      })
      .select('id, project_number')
      .single()

    if (error || !project) {
      console.error('[clients] job creation failed', error)
      return failure('The job could not be created.')
    }

    if (estimateId) {
      await supabase.from('estimates')
        .update({ status: 'converted', converted_project_id: project.id, project_id: project.id })
        .eq('id', estimateId)
    }

    await logActivity(supabase, {
      action: 'client.converted_to_job',
      entityType: 'contact',
      entityId: contactId,
      actorUserId: user.id,
      metadata: {
        project_id: project.id,
        project_number: project.project_number,
        from_estimate: estimateId,
      },
    })

    revalidatePath('/ops/projects')
    revalidatePath(`/ops/contacts/${contactId}`)
    redirect(`/ops/projects/${project.id}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('createJobFromClient', error)
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseLines(form: FormData): Record<string, unknown>[] {
  const indexes = new Set<number>()
  for (const key of Array.from(form.keys())) {
    const match = /^line\[(\d+)]\[/.exec(key)
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
      quantity: get('quantity') ?? '1',
      unit: get('unit') ?? 'EA',
      unit_price_cents: get('unit_price') ?? '0',
      labor_cost_cents: get('labor_cost') ?? '',
      material_cost_cents: get('material_cost') ?? '',
      markup_percent: get('markup_percent') ?? '',
      pricebook_item_id: get('pricebook_item_id') ?? '',
      source: get('source') ?? 'manual',
      ai_generated: form.get(`line[${i}][ai_generated]`) === 'true',
      // Ticking "reviewed" is how a person clears an AI flag.
      needs_review: form.get(`line[${i}][reviewed]`) === null
        && form.get(`line[${i}][needs_review]`) === 'true',
      notes: get('notes'),
    })
  }
  return lines
}

export async function refreshUser(): Promise<void> {
  await requireUser()
}

function isRedirect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
}

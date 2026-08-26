'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, requireCapability } from '@/lib/ops/auth/require-user'
import { canViewCosts } from '@/lib/ops/auth/permissions'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { getSettings } from '@/lib/ops/services/settings'
import { logActivity } from '@/lib/ops/services/activity'
import { logAiRun, findTodaysBrief } from '@/lib/ops/services/ai-runs'
import { downloadToBuffer } from '@/lib/ops/services/documents'
import { createCertificate } from '@/lib/ops/services/certificates'
import { certificateSchema } from '@/lib/ops/validations/certificate'
import { describeAiError, isOpsAiConfigured } from '@/lib/ops/ai/provider'
import { structureLeadFromNotes, enrichLead, draftMessage, type MessageKind } from '@/lib/ops/ai/leads'
import { extractCoi, toCertificateInput, findLowConfidence, isSupportedCoiType } from '@/lib/ops/ai/coi'
import { coiExtractionSchema, type CoiExtraction } from '@/lib/ops/ai/schemas'
import {
  collectAuditFacts, generateAuditBrief, collectDashboardFacts, generateDashboardBrief,
} from '@/lib/ops/ai/briefs'
import { failure, handleUnexpected, str, success, type ActionState } from '@/lib/ops/actions-shared'

/**
 * ============================================================================
 * AI SERVER ACTIONS
 * ----------------------------------------------------------------------------
 * Every action here either RETURNS A DRAFT or APPLIES SOMETHING A HUMAN
 * ALREADY REVIEWED. There is no action in this file that a model can invoke,
 * and none that writes an operational record without an explicit human step in
 * between.
 *
 * `applyCoiExtraction` is the only one that writes a business record, and it
 * writes the values submitted by the reviewer's form — not the values the model
 * produced — through the same `createCertificate` path the manual COI screen
 * uses, with the same Zod schema and the same deterministic evaluator running
 * afterwards.
 * ============================================================================
 */

function notConfigured(): ActionState {
  return failure('AI is not configured. Set OPENAI_API_KEY to enable it — everything else keeps working without it.')
}

// ---------------------------------------------------------------------------
// Lead assistant
// ---------------------------------------------------------------------------

export async function structureLeadAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    if (!isOpsAiConfigured()) return notConfigured()

    const notes = str(form, 'notes') ?? ''
    if (notes.trim().length < 15) {
      return failure('Paste a few sentences of notes first — there is not enough here to work from.')
    }

    const supabase = createSupabaseServerClient()
    const started = Date.now()
    try {
      const result = await structureLeadFromNotes(notes)
      await logAiRun(supabase, {
        userId: user.id, feature: 'lead_structure', entityType: 'lead',
        inputRefs: { noteChars: notes.length },
        outputSummary: {
          fieldsPopulated: Object.values(result.fields).filter(Boolean).length,
          urgency: result.urgency,
          warnings: result.warnings.length,
        },
        latencyMs: Date.now() - started,
      })
      // Returned as data for the form to render. Nothing is saved.
      return success('Draft ready — check every field before saving.', { draft: JSON.stringify(result) })
    } catch (error) {
      const described = describeAiError(error)
      await logAiRun(supabase, {
        userId: user.id, feature: 'lead_structure', status: 'failed',
        errorCode: described.reason, latencyMs: Date.now() - started,
      })
      return failure(described.message)
    }
  } catch (error) {
    return handleUnexpected('structureLead', error)
  }
}

export async function enrichLeadAction(leadId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    if (!isOpsAiConfigured()) return notConfigured()

    const supabase = createSupabaseServerClient()
    const { data: lead } = await supabase.from('leads')
      .select('id, first_name, last_name, company_name, service_type, city, project_description, pipeline_stage, created_at, last_contacted_at')
      .eq('id', leadId).maybeSingle()
    if (!lead) return failure('That lead could not be found.')

    const started = Date.now()
    try {
      const result = await enrichLead({
        firstName: (lead.first_name as string) ?? '',
        lastName: (lead.last_name as string) ?? '',
        companyName: (lead.company_name as string) ?? '',
        serviceType: (lead.service_type as string) ?? '',
        city: (lead.city as string) ?? '',
        description: (lead.project_description as string) ?? '',
        stage: (lead.pipeline_stage as string) ?? '',
        createdAt: lead.created_at as string,
        lastContactedAt: (lead.last_contacted_at as string | null) ?? null,
      })

      await logAiRun(supabase, {
        userId: user.id, feature: 'lead_enrichment', entityType: 'lead', entityId: leadId,
        outputSummary: { urgency: result.urgency, hasMessage: Boolean(result.followUpMessage) },
        latencyMs: Date.now() - started,
      })
      await logActivity(supabase, {
        action: 'ai.lead_enriched', entityType: 'lead', entityId: leadId, actorUserId: user.id,
      })
      return success('Summary ready.', { enrichment: JSON.stringify(result) })
    } catch (error) {
      const described = describeAiError(error)
      await logAiRun(supabase, {
        userId: user.id, feature: 'lead_enrichment', entityType: 'lead', entityId: leadId,
        status: 'failed', errorCode: described.reason, latencyMs: Date.now() - started,
      })
      return failure(described.message)
    }
  } catch (error) {
    return handleUnexpected('enrichLead', error)
  }
}

export async function draftLeadMessageAction(leadId: string, kind: MessageKind): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    if (!isOpsAiConfigured()) return notConfigured()

    const supabase = createSupabaseServerClient()
    const { data: lead } = await supabase.from('leads')
      .select('first_name, last_name, company_name, service_type, city, project_description, pipeline_stage, created_at, last_contacted_at')
      .eq('id', leadId).maybeSingle()
    if (!lead) return failure('That lead could not be found.')

    const started = Date.now()
    try {
      const message = await draftMessage(kind, {
        firstName: (lead.first_name as string) ?? '',
        lastName: (lead.last_name as string) ?? '',
        companyName: (lead.company_name as string) ?? '',
        serviceType: (lead.service_type as string) ?? '',
        city: (lead.city as string) ?? '',
        description: (lead.project_description as string) ?? '',
        stage: (lead.pipeline_stage as string) ?? '',
        createdAt: lead.created_at as string,
        lastContactedAt: (lead.last_contacted_at as string | null) ?? null,
      })
      await logAiRun(supabase, {
        userId: user.id, feature: 'lead_message', entityType: 'lead', entityId: leadId,
        inputRefs: { kind }, outputSummary: { bodyChars: message.body.length },
        latencyMs: Date.now() - started,
      })
      // Nothing is sent. The office copies it.
      return success('Draft ready — nothing has been sent.', { message: JSON.stringify(message) })
    } catch (error) {
      const described = describeAiError(error)
      await logAiRun(supabase, {
        userId: user.id, feature: 'lead_message', entityType: 'lead', entityId: leadId,
        status: 'failed', errorCode: described.reason, latencyMs: Date.now() - started,
      })
      return failure(described.message)
    }
  } catch (error) {
    return handleUnexpected('draftLeadMessage', error)
  }
}

// ---------------------------------------------------------------------------
// COI extraction
// ---------------------------------------------------------------------------

export async function analyzeCoiAction(documentId: string): Promise<ActionState> {
  try {
    // reviewCertificate is the capability that gates COI work generally.
    const user = await requireCapability('reviewCertificate')
    if (!isOpsAiConfigured()) return notConfigured()

    const supabase = createSupabaseServerClient()
    const settings = await getSettings(supabase)
    if (!settings.ai_coi_extraction_enabled) {
      return failure('COI extraction is switched off in Settings → AI.')
    }

    // Read the row through the USER's client first: RLS decides whether this
    // person may see the document at all. Only then do we fetch the bytes.
    const { data: document } = await supabase
      .from('documents')
      .select('id, entity_type, entity_id, storage_path, mime_type, original_filename, size_bytes')
      .eq('id', documentId).maybeSingle()
    if (!document) return failure('That document could not be found, or you do not have access to it.')
    if (document.entity_type !== 'vendor') {
      return failure('COI analysis only applies to documents filed against a subcontractor.')
    }

    const mimeType = (document.mime_type as string) ?? ''
    if (!isSupportedCoiType(mimeType)) {
      return failure(`${mimeType || 'That file type'} cannot be analysed. Use a PDF, JPG, PNG or WebP.`)
    }

    const admin = createSupabaseAdminClient()
    const buffer = await downloadToBuffer(admin, document.storage_path as string)
    if (!buffer) return failure('The document could not be read from storage.')

    const started = Date.now()
    try {
      const outcome = await extractCoi({
        buffer, mimeType, filename: (document.original_filename as string) ?? 'certificate',
      })

      const { data: draft, error } = await supabase.from('ai_extraction_drafts').insert({
        document_id: documentId,
        vendor_id: document.entity_id as string,
        created_by: user.id,
        status: 'pending',
        extracted_data: outcome.extraction,
        confidence_data: { overall: outcome.extraction.overallConfidence, lowConfidenceFields: outcome.lowConfidenceFields },
        warnings: outcome.extraction.warnings,
        model: outcome.model,
        prompt_version: outcome.promptVersion,
      }).select('id').single()

      if (error || !draft) {
        console.error('[ai-coi] draft insert failed', error)
        return failure('The extraction succeeded but the draft could not be saved.')
      }

      await logAiRun(supabase, {
        userId: user.id, feature: 'coi_extraction', entityType: 'document', entityId: documentId,
        model: outcome.model, promptVersion: outcome.promptVersion,
        inputRefs: { documentBytes: document.size_bytes ?? null, mimeType },
        outputSummary: {
          coverages: outcome.extraction.coverages.length,
          lowConfidenceFields: outcome.lowConfidenceFields.length,
          overallConfidence: outcome.extraction.overallConfidence,
        },
        tokenUsage: outcome.usage, latencyMs: outcome.latencyMs,
      })
      await logActivity(supabase, {
        action: 'ai.coi_extracted', entityType: 'vendor', entityId: document.entity_id as string,
        actorUserId: user.id, metadata: { document_id: documentId, draft_id: draft.id },
      })

      revalidatePath(`/ops/subcontractors/${document.entity_id}`)
      return success('Extraction ready for review. Nothing has been saved to the subcontractor yet.', {
        draftId: draft.id as string,
      })
    } catch (error) {
      const described = describeAiError(error)
      await logAiRun(supabase, {
        userId: user.id, feature: 'coi_extraction', entityType: 'document', entityId: documentId,
        status: 'failed', errorCode: described.reason, latencyMs: Date.now() - started,
      })
      return failure(described.message)
    }
  } catch (error) {
    return handleUnexpected('analyzeCoi', error)
  }
}

/**
 * Apply values a human reviewed.
 *
 * The payload comes from the review form, not from the draft row — the reviewer
 * may have corrected anything. It is re-validated by `coiExtractionSchema` and
 * then by `certificateSchema`, and written by the same `createCertificate` used
 * by the manual screen. Compliance is recalculated afterwards by the existing
 * evaluator, which is the only thing that decides a status.
 */
export async function applyCoiExtractionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('reviewCertificate')
    const supabase = createSupabaseServerClient()

    const draftId = str(form, 'draft_id') ?? ''
    const payload = str(form, 'reviewed') ?? ''
    if (!draftId || !payload) return failure('The review could not be read. Reload and try again.')

    const { data: draft } = await supabase.from('ai_extraction_drafts')
      .select('id, document_id, vendor_id, status').eq('id', draftId).maybeSingle()
    if (!draft) return failure('That extraction draft could not be found.')
    if (draft.status !== 'pending') return failure('This extraction has already been reviewed.')
    if (!draft.vendor_id) return failure('This extraction is not linked to a subcontractor.')

    let reviewed: CoiExtraction
    try {
      const parsed = coiExtractionSchema.safeParse(JSON.parse(payload))
      if (!parsed.success) return failure('The reviewed values did not validate. Check the dates and limits.')
      reviewed = parsed.data
    } catch {
      return failure('The reviewed values could not be read.')
    }

    if (reviewed.coverages.length === 0) {
      return failure('Add at least one coverage line before applying.')
    }

    const certificateInput = toCertificateInput(
      draft.vendor_id as string,
      draft.document_id as string,
      reviewed,
      reviewed.coverages,
    )

    // The same schema the manual COI form uses. An AI-assisted path gets no
    // relaxation of the rules a typed-in certificate has to satisfy.
    const validated = certificateSchema.safeParse(certificateInput)
    if (!validated.success) {
      const issue = validated.error.issues[0]
      return failure(`${issue?.path.join('.') ?? 'A field'}: ${issue?.message ?? 'is not valid.'}`)
    }

    const result = await createCertificate(supabase, validated.data, user.id, { source: 'admin_upload' })
    if (!result.ok) return failure(result.error ?? 'The certificate could not be saved.')

    await supabase.from('ai_extraction_drafts').update({
      status: 'applied', reviewed_by: user.id,
      reviewed_at: new Date().toISOString(), applied_at: new Date().toISOString(),
      applied_certificate_id: result.certificateId ?? null,
    }).eq('id', draftId)

    await logActivity(supabase, {
      action: 'ai.coi_extraction_applied', entityType: 'vendor', entityId: draft.vendor_id as string,
      actorUserId: user.id,
      metadata: {
        draft_id: draftId, certificate_id: result.certificateId,
        coverage_lines: reviewed.coverages.length,
        origin: 'ai_extracted_human_reviewed',
      },
    })

    revalidatePath(`/ops/subcontractors/${draft.vendor_id}`)
    revalidatePath('/ops/compliance')
    return success('Applied. Compliance has been recalculated from the values you approved.')
  } catch (error) {
    return handleUnexpected('applyCoiExtraction', error)
  }
}

export async function rejectCoiExtractionAction(draftId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('reviewCertificate')
    const supabase = createSupabaseServerClient()
    const { data: draft } = await supabase.from('ai_extraction_drafts')
      .select('id, vendor_id, status').eq('id', draftId).maybeSingle()
    if (!draft) return failure('That extraction draft could not be found.')

    await supabase.from('ai_extraction_drafts').update({
      status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).eq('id', draftId)

    await logActivity(supabase, {
      action: 'ai.coi_extraction_rejected', entityType: 'vendor',
      entityId: (draft.vendor_id as string) ?? null, actorUserId: user.id,
      metadata: { draft_id: draftId },
    })
    if (draft.vendor_id) revalidatePath(`/ops/subcontractors/${draft.vendor_id}`)
    return success('Extraction discarded. Nothing was saved to the subcontractor.')
  } catch (error) {
    return handleUnexpected('rejectCoiExtraction', error)
  }
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export async function generateAuditBriefAction(
  period: { start: string; end: string } | null,
): Promise<ActionState> {
  try {
    const user = await requireCapability('generateAuditPackage')
    if (!isOpsAiConfigured()) return notConfigured()

    const supabase = createSupabaseServerClient()
    const started = Date.now()
    try {
      const facts = await collectAuditFacts(supabase, period)
      const brief = await generateAuditBrief(facts)

      await logAiRun(supabase, {
        userId: user.id, feature: 'audit_brief',
        inputRefs: { vendorsEvaluated: facts.vendorsEvaluated, blocking: facts.blocking.length },
        outputSummary: { blockers: brief.criticalBlockers.length, actions: brief.recommendedActions.length },
        latencyMs: Date.now() - started,
      })
      await logActivity(supabase, {
        action: 'ai.audit_brief_generated', entityType: 'audit_cycle', actorUserId: user.id,
      })
      return success('Brief generated.', { brief: JSON.stringify(brief), facts: JSON.stringify(facts) })
    } catch (error) {
      const described = describeAiError(error)
      await logAiRun(supabase, {
        userId: user.id, feature: 'audit_brief', status: 'failed',
        errorCode: described.reason, latencyMs: Date.now() - started,
      })
      return failure(described.message)
    }
  } catch (error) {
    return handleUnexpected('generateAuditBrief', error)
  }
}

export async function generateDashboardBriefAction(force = false): Promise<ActionState> {
  try {
    const user = await requireUser()
    if (!isOpsAiConfigured()) return notConfigured()

    const supabase = createSupabaseServerClient()
    const settings = await getSettings(supabase)
    if (!settings.ai_dashboard_brief_enabled) {
      return failure('The dashboard brief is switched off in Settings → AI.')
    }

    // Same-day reuse. A dashboard visit should not cost money every time.
    if (!force) {
      const cached = await findTodaysBrief(supabase, user.id, 'dashboard_brief')
      if (cached?.summary?.brief) {
        return success('Showing today\'s brief.', {
          brief: JSON.stringify(cached.summary.brief),
          generatedAt: cached.createdAt,
          cached: 'true',
        })
      }
    }

    const started = Date.now()
    try {
      const includeFinancial = canViewCosts(user.role, settings) || user.can('invoicesView')
      const facts = await collectDashboardFacts(supabase, { includeFinancial })
      const brief = await generateDashboardBrief(facts, user.profile.full_name || user.email)

      await logAiRun(supabase, {
        userId: user.id, feature: 'dashboard_brief',
        inputRefs: { includeFinancial },
        // The brief text is stored so the same-day cache can replay it. It is
        // the model's own summary of counts this user is allowed to see —
        // nothing sensitive that is not already on their dashboard.
        outputSummary: { brief },
        latencyMs: Date.now() - started,
      })
      return success('Brief generated.', {
        brief: JSON.stringify(brief),
        generatedAt: new Date().toISOString(),
        cached: 'false',
      })
    } catch (error) {
      const described = describeAiError(error)
      await logAiRun(supabase, {
        userId: user.id, feature: 'dashboard_brief', status: 'failed',
        errorCode: described.reason, latencyMs: Date.now() - started,
      })
      return failure(described.message)
    }
  } catch (error) {
    return handleUnexpected('generateDashboardBrief', error)
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveAiSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('manageSettings')
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.from('app_settings').update({
      ai_copilot_enabled: form.get('ai_copilot_enabled') === 'on',
      ai_coi_extraction_enabled: form.get('ai_coi_extraction_enabled') === 'on',
      ai_dashboard_brief_enabled: form.get('ai_dashboard_brief_enabled') === 'on',
    }).eq('id', 'default')
    if (error) return failure('Those settings could not be saved.')

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { section: 'ai' },
    })
    revalidatePath('/ops/settings')
    revalidatePath('/ops/dashboard')
    return success('AI settings saved.')
  } catch (error) {
    return handleUnexpected('saveAiSettings', error)
  }
}

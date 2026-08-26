'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { logActivity } from '@/lib/ops/services/activity'
import { uploadDocument } from '@/lib/ops/services/documents'
import { getSettings } from '@/lib/ops/services/settings'
import { updateSchedule } from '@/lib/ops/services/schedule'
import { agreementSchema, projectPhotoSchema, scheduleUpdateSchema } from '@/lib/ops/validations/estimate'
import {
  failure, handleUnexpected, str, success, zodToState, type ActionState,
} from '@/lib/ops/actions-shared'

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export async function updateScheduleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('scheduleEdit')
    const supabase = createSupabaseServerClient()

    const parsed = scheduleUpdateSchema.safeParse({
      project_id: str(form, 'project_id') ?? '',
      scheduled_start_date: str(form, 'scheduled_start_date') ?? '',
      scheduled_end_date: str(form, 'scheduled_end_date') ?? '',
      schedule_notes: str(form, 'schedule_notes'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    const result = await updateSchedule(supabase, {
      projectId: parsed.data.project_id,
      scheduledStartDate: parsed.data.scheduled_start_date ?? null,
      scheduledEndDate: parsed.data.scheduled_end_date ?? null,
      scheduleNotes: parsed.data.schedule_notes ?? null,
      actorUserId: user.id,
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath('/ops/schedule')
    revalidatePath(`/ops/projects/${parsed.data.project_id}`)
    return success('Schedule updated.')
  } catch (error) {
    return handleUnexpected('updateSchedule', error)
  }
}

/** Used by the Gantt drag handler. Same validation, same audit trail. */
export async function moveScheduleBar(
  projectId: string,
  start: string,
  end: string,
): Promise<ActionState> {
  try {
    const user = await requireCapability('scheduleEdit')
    const supabase = createSupabaseServerClient()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return failure('Those dates are not valid.')
    }
    if (end < start) return failure('The end date must be on or after the start date.')

    const result = await updateSchedule(supabase, {
      projectId, scheduledStartDate: start, scheduledEndDate: end, actorUserId: user.id,
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath('/ops/schedule')
    return success('Schedule updated.')
  } catch (error) {
    return handleUnexpected('moveScheduleBar', error)
  }
}

export async function toggleScheduleLock(projectId: string, locked: boolean): Promise<ActionState> {
  try {
    const user = await requireCapability('scheduleEdit')
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.from('projects').update({ schedule_locked: locked }).eq('id', projectId)
    if (error) return failure('The schedule lock could not be changed.')

    await logActivity(supabase, {
      action: 'project.schedule_changed', entityType: 'project', entityId: projectId,
      actorUserId: user.id, metadata: { schedule_locked: locked },
    })
    revalidatePath('/ops/schedule')
    revalidatePath(`/ops/projects/${projectId}`)
    return success(locked ? 'Schedule locked.' : 'Schedule unlocked.')
  } catch (error) {
    return handleUnexpected('toggleScheduleLock', error)
  }
}

// ---------------------------------------------------------------------------
// Project photos
// ---------------------------------------------------------------------------

export async function uploadProjectPhoto(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('photosUpload')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()
    const settings = await getSettings(supabase)

    const parsed = projectPhotoSchema.safeParse({
      project_id: str(form, 'project_id') ?? '',
      phase: str(form, 'phase') ?? 'progress',
      caption: str(form, 'caption'),
      taken_at: str(form, 'taken_at') ?? '',
      customer_visible: form.get('customer_visible') !== null,
    })
    if (!parsed.success) return zodToState(parsed.error)

    // Crews upload several shots at once from a phone.
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
    if (files.length === 0) return failure('Choose at least one photo.')
    if (files.length > 20) return failure('Upload up to 20 photos at a time.')

    let uploaded = 0
    const problems: string[] = []

    for (const file of files) {
      const upload = await uploadDocument(admin, {
        file,
        entityType: 'project',
        entityId: parsed.data.project_id,
        documentType: 'project_photo',
        documentDate: parsed.data.taken_at ?? null,
        description: parsed.data.caption ?? null,
        uploadedBy: user.id,
        maxBytes: settings.max_upload_mb * 1024 * 1024,
      })
      if (!upload.ok) { problems.push(`${file.name}: ${upload.error}`); continue }

      const { error } = await supabase.from('project_photos').insert({
        project_id: parsed.data.project_id,
        document_id: upload.document!.id,
        phase: parsed.data.phase,
        caption: parsed.data.caption ?? null,
        taken_at: parsed.data.taken_at ?? null,
        uploaded_by: user.id,
        customer_visible: parsed.data.customer_visible,
        sort_order: uploaded,
      })
      if (error) { problems.push(`${file.name}: could not be attached.`); continue }
      uploaded += 1
    }

    if (uploaded === 0) {
      return failure(problems[0] ?? 'No photos could be uploaded.')
    }

    await logActivity(supabase, {
      action: 'project.photo_uploaded',
      entityType: 'project',
      entityId: parsed.data.project_id,
      actorUserId: user.id,
      metadata: { count: uploaded, phase: parsed.data.phase },
    })

    revalidatePath(`/ops/projects/${parsed.data.project_id}`)
    return success(
      `${uploaded} photo${uploaded === 1 ? '' : 's'} added to ${parsed.data.phase}.` +
      (problems.length ? ` ${problems.length} could not be uploaded: ${problems[0]}` : ''),
    )
  } catch (error) {
    return handleUnexpected('uploadProjectPhoto', error)
  }
}

export async function updatePhoto(
  photoId: string,
  projectId: string,
  patch: { phase?: string; caption?: string; customer_visible?: boolean },
): Promise<ActionState> {
  try {
    await requireCapability('photosUpload')
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.from('project_photos').update(patch).eq('id', photoId)
    if (error) return failure('The photo could not be updated.')
    revalidatePath(`/ops/projects/${projectId}`)
    return success('Photo updated.')
  } catch (error) {
    return handleUnexpected('updatePhoto', error)
  }
}

// ---------------------------------------------------------------------------
// Subcontractor agreements
// ---------------------------------------------------------------------------

/**
 * Agreement tracking is deliberately separate from insurance compliance. A
 * signed contract and a current COI are both required, and neither substitutes
 * for the other — merging them would let a signed agreement hide missing
 * coverage on the vendor's status banner.
 */
export async function saveAgreement(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('agreementsManage')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()

    const parsed = agreementSchema.safeParse({
      vendor_id: str(form, 'vendor_id') ?? '',
      status: str(form, 'status') ?? 'sent',
      effective_date: str(form, 'effective_date') ?? '',
      expiration_date: str(form, 'expiration_date') ?? '',
      signed_date: str(form, 'signed_date') ?? '',
      notes: str(form, 'notes'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    let documentId: string | null = null
    const file = form.get('agreement_file')
    if (file instanceof File && file.size > 0) {
      const settings = await getSettings(supabase)
      const upload = await uploadDocument(admin, {
        file,
        entityType: 'vendor',
        entityId: parsed.data.vendor_id,
        documentType: 'subcontractor_agreement',
        folder: 'agreements',
        documentDate: parsed.data.signed_date ?? parsed.data.effective_date ?? null,
        expirationDate: parsed.data.expiration_date ?? null,
        uploadedBy: user.id,
        maxBytes: settings.max_upload_mb * 1024 * 1024,
      })
      if (!upload.ok) return failure(upload.error!)
      documentId = upload.document!.id
    }

    if (parsed.data.status === 'signed' && !documentId) {
      const { data: existing } = await supabase
        .from('subcontractor_agreements')
        .select('id').eq('vendor_id', parsed.data.vendor_id).not('document_id', 'is', null).limit(1)
      if (!existing || existing.length === 0) {
        return failure('Attach the signed agreement before marking it signed — the document is the record.')
      }
    }

    // A new agreement supersedes the previous one. History is kept.
    const { data: previous } = await supabase
      .from('subcontractor_agreements')
      .select('id, version')
      .eq('vendor_id', parsed.data.vendor_id)
      .order('version', { ascending: false })
      .limit(1)

    const previousRow = previous?.[0]
    const version = ((previousRow?.version as number | undefined) ?? 0) + 1

    const { data, error } = await supabase
      .from('subcontractor_agreements')
      .insert({
        ...parsed.data,
        document_id: documentId,
        version,
        supersedes_id: previousRow?.id ?? null,
        recorded_by: user.id,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[agreements] insert failed', error)
      return failure('The agreement could not be saved.')
    }

    if (previousRow?.id) {
      await supabase.from('subcontractor_agreements')
        .update({ status: 'superseded' }).eq('id', previousRow.id)
    }

    await logActivity(supabase, {
      action: documentId ? 'subcontractor.agreement_uploaded' : 'subcontractor.agreement_status_changed',
      entityType: 'vendor',
      entityId: parsed.data.vendor_id,
      actorUserId: user.id,
      metadata: { agreement_id: data.id, status: parsed.data.status, version },
    })

    revalidatePath(`/ops/subcontractors/${parsed.data.vendor_id}`)
    return success('Agreement recorded.')
  } catch (error) {
    return handleUnexpected('saveAgreement', error)
  }
}

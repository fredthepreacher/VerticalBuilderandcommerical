'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCapability, requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { convertLead } from '@/lib/ops/services/leads'
import { leadUpdateSchema } from '@/lib/ops/validations/lead'
import { contactSchema, noteSchema, projectSchema, taskSchema } from '@/lib/ops/validations/project'
import {
  bool, failure, handleUnexpected, str, strList, success, zodToState, type ActionState,
} from '@/lib/ops/actions-shared'

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function saveLead(
  leadId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()

    const parsed = leadUpdateSchema.safeParse({
      first_name: str(form, 'first_name') ?? '',
      last_name: str(form, 'last_name'),
      company_name: str(form, 'company_name'),
      email: str(form, 'email') ?? '',
      phone: str(form, 'phone'),
      preferred_contact_method: str(form, 'preferred_contact_method'),
      customer_type: str(form, 'customer_type'),
      service_type: str(form, 'service_type'),
      property_address: str(form, 'property_address'),
      city: str(form, 'city'),
      state: str(form, 'state'),
      zip: str(form, 'zip'),
      project_description: str(form, 'project_description'),
      timeline: str(form, 'timeline'),
      financing_interest: bool(form, 'financing_interest'),
      pipeline_stage: str(form, 'pipeline_stage') ?? 'new',
      assigned_to: str(form, 'assigned_to') ?? '',
      next_follow_up_at: str(form, 'next_follow_up_at') ?? '',
      lost_reason: str(form, 'lost_reason'),
      notes_summary: str(form, 'notes_summary'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    const payload = { ...parsed.data, updated_at: new Date().toISOString() }

    if (leadId) {
      const { data: before } = await supabase
        .from('leads').select('pipeline_stage').eq('id', leadId).maybeSingle()
      const { error } = await supabase.from('leads').update(payload).eq('id', leadId)
      if (error) return failure('The lead could not be saved.')

      await logActivity(supabase, {
        action: before?.pipeline_stage !== payload.pipeline_stage ? 'status.changed' : 'record.updated',
        entityType: 'lead',
        entityId: leadId,
        actorUserId: user.id,
        metadata: { from: before?.pipeline_stage, to: payload.pipeline_stage },
      })
      revalidatePath(`/ops/leads/${leadId}`)
      revalidatePath('/ops/leads')
      return success('Lead saved.')
    }

    const { data, error } = await supabase.from('leads')
      .insert({ ...payload, source: 'manual' }).select('id').single()
    if (error || !data) return failure('The lead could not be created.')

    await logActivity(supabase, {
      action: 'record.created', entityType: 'lead', entityId: data.id, actorUserId: user.id,
    })
    revalidatePath('/ops/leads')
    redirect(`/ops/leads/${data.id}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveLead', error)
  }
}

export async function convertLeadAction(leadId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()
    const result = await convertLead(supabase, leadId, user.id)
    if (!result.ok) return failure(result.error ?? 'The lead could not be converted.')
    revalidatePath('/ops/leads')
    revalidatePath('/ops/projects')
    redirect(`/ops/projects/${result.projectId}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('convertLead', error)
  }
}

export async function setLeadStage(leadId: string, stage: string): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.from('leads')
      .update({ pipeline_stage: stage, last_contacted_at: new Date().toISOString() })
      .eq('id', leadId)
    if (error) return failure('The stage could not be changed.')
    await logActivity(supabase, {
      action: 'status.changed', entityType: 'lead', entityId: leadId,
      actorUserId: user.id, metadata: { to: stage },
    })
    revalidatePath('/ops/leads')
    revalidatePath(`/ops/leads/${leadId}`)
    return success('Stage updated.')
  } catch (error) {
    return handleUnexpected('setLeadStage', error)
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function saveContact(
  contactId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()

    const parsed = contactSchema.safeParse({
      contact_type: str(form, 'contact_type') ?? 'homeowner',
      first_name: str(form, 'first_name'),
      last_name: str(form, 'last_name'),
      company_name: str(form, 'company_name'),
      email: str(form, 'email') ?? '',
      phone: str(form, 'phone'),
      secondary_phone: str(form, 'secondary_phone'),
      preferred_contact_method: str(form, 'preferred_contact_method'),
      billing_address: str(form, 'billing_address'),
      city: str(form, 'city'),
      state: str(form, 'state'),
      zip: str(form, 'zip'),
      tags: strList(form, 'tags'),
      notes: str(form, 'notes'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    if (contactId) {
      const { error } = await supabase.from('contacts').update(parsed.data).eq('id', contactId)
      if (error) return failure('The contact could not be saved.')
      await logActivity(supabase, {
        action: 'record.updated', entityType: 'contact', entityId: contactId, actorUserId: user.id,
      })
      revalidatePath(`/ops/contacts/${contactId}`)
      return success('Contact saved.')
    }

    const { data, error } = await supabase.from('contacts').insert(parsed.data).select('id').single()
    if (error || !data) return failure('The contact could not be created.')
    await logActivity(supabase, {
      action: 'record.created', entityType: 'contact', entityId: data.id, actorUserId: user.id,
    })
    revalidatePath('/ops/contacts')
    redirect(`/ops/contacts/${data.id}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveContact', error)
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function saveProject(
  projectId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()

    const parsed = projectSchema.safeParse({
      project_name: str(form, 'project_name') ?? '',
      customer_id: str(form, 'customer_id') ?? '',
      jobsite_address: str(form, 'jobsite_address'),
      city: str(form, 'city'),
      state: str(form, 'state'),
      zip: str(form, 'zip'),
      customer_type: str(form, 'customer_type'),
      service_category: str(form, 'service_category'),
      description: str(form, 'description'),
      status: str(form, 'status') ?? 'prospect',
      estimator_id: str(form, 'estimator_id') ?? '',
      project_manager_id: str(form, 'project_manager_id') ?? '',
      start_date: str(form, 'start_date') ?? '',
      estimated_completion_date: str(form, 'estimated_completion_date') ?? '',
      actual_completion_date: str(form, 'actual_completion_date') ?? '',
      estimate_amount_cents: str(form, 'estimate_amount') ?? '',
      contract_amount_cents: str(form, 'contract_amount') ?? '',
      permit_number: str(form, 'permit_number'),
      permit_status: str(form, 'permit_status'),
      insurance_claim_related: bool(form, 'insurance_claim_related'),
      insurance_carrier: str(form, 'insurance_carrier'),
      insurance_claim_number: str(form, 'insurance_claim_number'),
      notes: str(form, 'notes'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    if (projectId) {
      const { data: before } = await supabase
        .from('projects').select('status').eq('id', projectId).maybeSingle()
      const { error } = await supabase.from('projects').update(parsed.data).eq('id', projectId)
      if (error) return failure('The project could not be saved.')
      await logActivity(supabase, {
        action: before?.status !== parsed.data.status ? 'status.changed' : 'record.updated',
        entityType: 'project', entityId: projectId, actorUserId: user.id,
        metadata: { from: before?.status, to: parsed.data.status },
      })
      revalidatePath(`/ops/projects/${projectId}`)
      return success('Project saved.')
    }

    const { data, error } = await supabase.from('projects').insert(parsed.data).select('id').single()
    if (error || !data) return failure('The project could not be created.')
    await logActivity(supabase, {
      action: 'record.created', entityType: 'project', entityId: data.id, actorUserId: user.id,
    })
    revalidatePath('/ops/projects')
    redirect(`/ops/projects/${data.id}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveProject', error)
  }
}

// ---------------------------------------------------------------------------
// Tasks + notes
// ---------------------------------------------------------------------------

export async function saveTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()
    const taskId = str(form, 'task_id')

    const parsed = taskSchema.safeParse({
      title: str(form, 'title') ?? '',
      description: str(form, 'description'),
      assigned_to: str(form, 'assigned_to') ?? '',
      due_date: str(form, 'due_date') ?? '',
      priority: str(form, 'priority') ?? 'normal',
      status: str(form, 'status') ?? 'open',
      related_entity_type: str(form, 'related_entity_type'),
      related_entity_id: str(form, 'related_entity_id') ?? '',
    })
    if (!parsed.success) return zodToState(parsed.error)

    if (taskId) {
      const { error } = await supabase.from('tasks').update({
        ...parsed.data,
        completed_at: parsed.data.status === 'done' ? new Date().toISOString() : null,
      }).eq('id', taskId)
      if (error) return failure('The task could not be saved.')
    } else {
      const { error } = await supabase.from('tasks').insert({ ...parsed.data, created_by: user.id })
      if (error) return failure('The task could not be created.')
    }

    revalidatePath('/ops/tasks')
    revalidatePath('/ops/dashboard')
    return success('Task saved.')
  } catch (error) {
    return handleUnexpected('saveTask', error)
  }
}

export async function toggleTask(taskId: string, done: boolean): Promise<ActionState> {
  try {
    await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()
    await supabase.from('tasks').update({
      status: done ? 'done' : 'open',
      completed_at: done ? new Date().toISOString() : null,
    }).eq('id', taskId)
    revalidatePath('/ops/tasks')
    return success()
  } catch (error) {
    return handleUnexpected('toggleTask', error)
  }
}

export async function addNote(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()

    const parsed = noteSchema.safeParse({
      entity_type: str(form, 'entity_type') ?? '',
      entity_id: str(form, 'entity_id') ?? '',
      body: str(form, 'body') ?? '',
    })
    if (!parsed.success) return zodToState(parsed.error)

    const { error } = await supabase.from('notes').insert({ ...parsed.data, created_by: user.id })
    if (error) return failure('The note could not be saved.')

    revalidatePath(`/ops/${pluralise(parsed.data.entity_type)}/${parsed.data.entity_id}`)
    return success('Note added.')
  } catch (error) {
    return handleUnexpected('addNote', error)
  }
}

// ---------------------------------------------------------------------------
// Archive (soft delete)
// ---------------------------------------------------------------------------

export async function archiveRecord(
  table: 'leads' | 'contacts' | 'projects' | 'vendors',
  id: string,
): Promise<ActionState> {
  try {
    const user = await requireUser()
    if (user.role !== 'admin' && user.role !== 'office') {
      return failure('Only an owner/admin or office user can archive records.')
    }
    const supabase = createSupabaseServerClient()
    // Archive, never DELETE — history stays intact for audits.
    const { error } = await supabase.from(table)
      .update({ archived_at: new Date().toISOString() }).eq('id', id)
    if (error) return failure('The record could not be archived.')

    await logActivity(supabase, {
      action: 'record.archived', entityType: table.replace(/s$/, ''), entityId: id, actorUserId: user.id,
    })
    revalidatePath(`/ops/${table === 'vendors' ? 'subcontractors' : table}`)
    return success('Archived.')
  } catch (error) {
    return handleUnexpected('archiveRecord', error)
  }
}

function pluralise(entityType: string): string {
  if (entityType === 'vendor') return 'subcontractors'
  return `${entityType}s`
}

/** Next signals redirects by throwing; those must not be swallowed as errors. */
function isRedirect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
}

// ---------------------------------------------------------------------------
// Client → Job
// ---------------------------------------------------------------------------

/**
 * One-click "create a job for this client".
 *
 * This deliberately reuses the existing contact rather than creating a second
 * customer record — the client asked for one-click conversion, not for a
 * parallel set of duplicate people. Everything the contact already knows
 * (address, type) is carried onto the job so the crew is not retyping it.
 */
export async function createJobFromContact(
  contactId: string,
  input: { projectName?: string; serviceCategory?: string | null } = {},
): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()

    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, company_name, contact_type, billing_address, city, state, zip, archived_at')
      .eq('id', contactId)
      .maybeSingle()

    if (contactError || !contact) return failure('That customer could not be found.')
    if (contact.archived_at) return failure('This customer is archived. Restore them before creating a job.')

    const who = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
      || (contact.company_name as string | null)
      || 'Customer'

    const name = (input.projectName ?? '').trim()
      || `${who} — ${input.serviceCategory || 'Project'}`

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        project_name: name.slice(0, 200),
        customer_id: contactId,
        // The billing address is a reasonable first guess at the jobsite; it is
        // editable on the job, and guessing beats an empty field the office has
        // to look up again.
        jobsite_address: contact.billing_address,
        city: contact.city,
        state: contact.state,
        zip: contact.zip,
        customer_type: contact.contact_type === 'business' ? 'commercial' : 'residential',
        service_category: input.serviceCategory ?? null,
        status: 'estimate',
      })
      .select('id')
      .single()

    if (error || !project) {
      console.error('[crm] createJobFromContact failed', error)
      return failure('The job could not be created.')
    }

    await logActivity(supabase, {
      action: 'client.converted_to_job',
      entityType: 'project',
      entityId: project.id as string,
      actorUserId: user.id,
      metadata: { from_contact_id: contactId },
    })

    revalidatePath('/ops/projects')
    revalidatePath(`/ops/contacts/${contactId}`)
    redirect(`/ops/projects/${project.id}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('createJobFromContact', error)
  }
}

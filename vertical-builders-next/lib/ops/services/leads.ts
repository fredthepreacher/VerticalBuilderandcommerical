import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { splitName, type PublicLeadInput } from '../validations/lead'
import { logActivity } from './activity'

/**
 * Website lead intake and conversion.
 *
 * The intake path is deliberately fault-tolerant: once a lead row exists, the
 * visitor is told we got it. Email notification, activity logging, and anything
 * else downstream may fail without losing the lead.
 */

export interface IntakeResult {
  ok: boolean
  leadId?: string
  error?: string
}

export async function createLeadFromWebsite(
  admin: SupabaseClient,
  input: PublicLeadInput,
): Promise<IntakeResult> {
  const { first, last } = splitName(input.name)

  const sourceMetadata: Record<string, string> = {}
  const attribution = {
    utm_source: input.utmSource,
    utm_medium: input.utmMedium,
    utm_campaign: input.utmCampaign,
    utm_term: input.utmTerm,
    utm_content: input.utmContent,
    referrer: input.referrer,
  }
  for (const [key, value] of Object.entries(attribution)) {
    if (value) sourceMetadata[key] = value
  }

  const { data, error } = await admin
    .from('leads')
    .insert({
      source: 'website',
      source_page: input.sourcePage ?? null,
      source_metadata: sourceMetadata,
      first_name: first,
      last_name: last,
      email: input.email,
      phone: input.phone,
      preferred_contact_method: input.preferredContactMethod ?? null,
      customer_type: input.customerType ?? null,
      service_type: input.projectType ?? null,
      property_address: input.propertyAddress ?? null,
      city: input.city ?? null,
      state: input.state ?? 'FL',
      zip: input.zip ?? null,
      project_description: input.message ?? null,
      timeline: input.timeline ?? null,
      financing_interest: input.financingInterest ?? false,
      pipeline_stage: 'new',
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[leads] intake insert failed', error)
    return { ok: false, error: 'Lead could not be saved.' }
  }

  await logActivity(admin, {
    action: 'lead.received',
    entityType: 'lead',
    entityId: data.id as string,
    actorLabel: 'Website',
    metadata: {
      source_page: input.sourcePage ?? null,
      service_type: input.projectType ?? null,
      city: input.city ?? null,
    },
  })

  return { ok: true, leadId: data.id as string }
}

export interface ConvertResult {
  ok: boolean
  contactId?: string
  projectId?: string
  error?: string
}

/**
 * "Convert to Customer + Project".
 *
 * Reuses an existing contact when the email or phone already matches, so the
 * office does not end up with three copies of the same homeowner. The lead is
 * kept intact and linked — its history is never discarded.
 */
export async function convertLead(
  supabase: SupabaseClient,
  leadId: string,
  actorUserId: string,
): Promise<ConvertResult> {
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (leadError || !lead) return { ok: false, error: 'Lead not found.' }
  if (lead.converted_project_id) {
    return {
      ok: true,
      contactId: lead.converted_contact_id as string,
      projectId: lead.converted_project_id as string,
    }
  }

  // 1. find or create the contact
  let contactId: string | null = (lead.converted_contact_id as string | null) ?? null
  if (!contactId) {
    const orFilters: string[] = []
    if (lead.email) orFilters.push(`email.ilike.${String(lead.email).replace(/[,()]/g, '')}`)
    if (lead.phone) orFilters.push(`phone.eq.${String(lead.phone).replace(/[,()]/g, '')}`)

    if (orFilters.length) {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .or(orFilters.join(','))
        .is('archived_at', null)
        .limit(1)
      contactId = (existing?.[0]?.id as string | undefined) ?? null
    }
  }

  if (!contactId) {
    const { data: contact, error } = await supabase
      .from('contacts')
      .insert({
        contact_type: lead.customer_type === 'commercial' ? 'business' : 'homeowner',
        first_name: lead.first_name,
        last_name: lead.last_name,
        company_name: lead.company_name,
        email: lead.email,
        phone: lead.phone,
        preferred_contact_method: lead.preferred_contact_method,
        billing_address: lead.property_address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
      })
      .select('id')
      .single()
    if (error || !contact) {
      console.error('[leads] contact create failed', error)
      return { ok: false, error: 'Could not create the customer record.' }
    }
    contactId = contact.id as string
  }

  // 2. create the project draft
  //
  // A converted property prospect may still have no owner name, so the address
  // is the fallback before the generic one — "4386 Sibley Bay St — Roofing"
  // tells the office which job this is; "New project — Roofing" does not.
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ')
    || (lead.company_name as string | null)
    || [lead.property_address, lead.city].filter(Boolean).join(', ')
    || 'New project'
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      project_name: `${name} — ${lead.service_type || 'Project'}`,
      customer_id: contactId,
      jobsite_address: lead.property_address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      customer_type: lead.customer_type,
      service_category: lead.service_type,
      description: lead.project_description,
      status: 'estimate',
    })
    .select('id, project_number')
    .single()

  if (projectError || !project) {
    console.error('[leads] project create failed', projectError)
    return { ok: false, error: 'Could not create the project.' }
  }

  // 3. link the lead — history is preserved, nothing is deleted
  await supabase
    .from('leads')
    .update({
      converted_contact_id: contactId,
      converted_project_id: project.id,
      pipeline_stage: lead.pipeline_stage === 'lost' ? lead.pipeline_stage : 'won',
    })
    .eq('id', leadId)

  await logActivity(supabase, {
    action: 'lead.converted',
    entityType: 'lead',
    entityId: leadId,
    actorUserId,
    metadata: { contact_id: contactId, project_id: project.id, project_number: project.project_number },
  })

  return { ok: true, contactId, projectId: project.id as string }
}

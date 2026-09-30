import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '../services/activity'
import { saveEstimate } from '../services/estimates'
import type { PricebookItem } from '../types'

/**
 * ============================================================================
 * PROSPECT → CRM LEAD → ESTIMATE — idempotent conversion
 * ----------------------------------------------------------------------------
 * Reuses the existing lead and estimate infrastructure; builds no second pricing
 * engine. Two hard rules:
 *
 *   1. IDEMPOTENT. The prospect's converted_lead_id and estimate_id are the keys.
 *      Converting twice (or a bulk retry) returns the existing records — it never
 *      creates a duplicate lead or estimate.
 *
 *   2. NO MISLEADING PRICE. An estimate is only generated from an ACTIVE price
 *      book item with a real price. A missing / retired / archived / $0 /
 *      needs-price item routes the prospect to pricing_configuration_required
 *      instead of producing a $0 proposal. A missing measurement routes to
 *      manual_measurement_required. Nothing is fabricated.
 * ============================================================================
 */

export interface ProspectForConversion {
  id: string
  status: string
  owner_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  mailing_address: string | null
  parcel_apn: string | null
  permit_type: string | null
  permit_date: string | null
  county: string | null
  campaign_id: string | null
  import_job_id: string | null
  final_squares: number | null
  converted_lead_id: string | null
  estimate_id: string | null
}

export interface CampaignForConversion {
  id: string
  pricebook_item_id: string | null
  pricebook_service_type: string | null
}

export interface ConversionRowResult {
  prospectId: string
  leadId?: string
  leadCreated: boolean
  estimateId?: string
  estimateCreated: boolean
  blocked?: 'pricing' | 'measurement'
  error?: string
}

function splitName(owner: string | null): { first: string | null; last: string | null } {
  if (!owner) return { first: null, last: null }
  const parts = owner.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

/** Idempotent: returns the existing lead if the prospect already has one. */
export async function convertProspectToLead(
  supabase: SupabaseClient, prospect: ProspectForConversion, userId: string,
): Promise<{ leadId: string; created: boolean }> {
  if (prospect.converted_lead_id) return { leadId: prospect.converted_lead_id, created: false }

  const { first, last } = splitName(prospect.owner_name)
  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      record_type: 'contact_lead',
      source: 'county_permit_import',
      source_metadata: {
        prospect_id: prospect.id,
        campaign_id: prospect.campaign_id,
        import_job_id: prospect.import_job_id,
        county: prospect.county,
        // Provenance the sales pipeline can read back without a join.
        permit_type: prospect.permit_type,
        permit_date: prospect.permit_date,
        mailing_address: prospect.mailing_address,
        roof_squares: prospect.final_squares,
      },
      first_name: first,
      last_name: last,
      property_address: prospect.property_address,
      city: prospect.city,
      state: prospect.state ?? 'FL',
      zip: prospect.zip,
      pipeline_stage: 'new',
    })
    .select('id').single()
  if (error || !lead) throw new Error(error?.message ?? 'Lead creation failed.')

  await supabase.from('roof_prospects')
    .update({ converted_lead_id: lead.id as string, status: 'crm_created' })
    .eq('id', prospect.id).is('converted_lead_id', null) // guard against a race

  await logActivity(supabase, {
    action: 'prospecting.converted_to_lead', entityType: 'roof_prospect', entityId: prospect.id,
    actorUserId: userId, metadata: { lead_id: lead.id },
  })
  return { leadId: lead.id as string, created: true }
}

export interface PricingResolution {
  ok: boolean
  item?: PricebookItem
  reason?: string
}

export type UsablePricebookItem = PricebookItem & { archived_at?: string | null; retired_at?: string | null }

/**
 * Pure: whether an item may back a NEW automated estimate. An estimate is only
 * ever generated from an ACTIVE, really-priced item — never a missing, retired,
 * archived, $0 or needs-price one, which would put a misleading figure on a
 * customer proposal.
 */
export function isPricebookItemUsable(item: UsablePricebookItem | null | undefined): { ok: boolean; reason?: string } {
  if (!item) return { ok: false, reason: 'The campaign price book item no longer exists.' }
  if (!item.active || item.archived_at || item.retired_at) {
    return { ok: false, reason: 'The campaign price book item is retired or archived.' }
  }
  if (!item.default_unit_price_cents || item.default_unit_price_cents <= 0 || item.tags?.includes('needs-price')) {
    return { ok: false, reason: 'The campaign price book item has no price set (needs-price / $0).' }
  }
  return { ok: true }
}

/** An estimate may only draw on an ACTIVE, really-priced item. */
export async function resolvePricebookItem(
  supabase: SupabaseClient, campaign: CampaignForConversion,
): Promise<PricingResolution> {
  if (!campaign.pricebook_item_id) {
    return { ok: false, reason: 'No price book item is set on this campaign.' }
  }
  const { data } = await supabase
    .from('pricebook_items').select('*').eq('id', campaign.pricebook_item_id).maybeSingle()
  const item = data as UsablePricebookItem | null
  const usable = isPricebookItemUsable(item)
  if (!usable.ok) return { ok: false, reason: usable.reason }
  return { ok: true, item: item! }
}

/** Idempotent: returns the existing estimate if one is already linked. */
export async function createEstimateForProspect(
  supabase: SupabaseClient,
  prospect: ProspectForConversion,
  campaign: CampaignForConversion,
  leadId: string,
  userId: string,
): Promise<{ estimateId?: string; created: boolean; blocked?: 'pricing' | 'measurement'; error?: string }> {
  if (prospect.estimate_id) return { estimateId: prospect.estimate_id, created: false }

  if (prospect.final_squares == null || prospect.final_squares <= 0) {
    await supabase.from('roof_prospects').update({ status: 'manual_measurement_required' }).eq('id', prospect.id)
    return { created: false, blocked: 'measurement' }
  }

  const pricing = await resolvePricebookItem(supabase, campaign)
  if (!pricing.ok || !pricing.item) {
    await supabase.from('roof_prospects').update({ status: 'pricing_configuration_required' }).eq('id', prospect.id)
    return { created: false, blocked: 'pricing', error: pricing.reason }
  }

  const item = pricing.item
  const result = await saveEstimate(
    supabase,
    {
      title: `Roof — ${prospect.property_address ?? 'property'}`.slice(0, 120),
      lead_id: leadId,
      property_address: prospect.property_address,
      city: prospect.city,
      state: prospect.state ?? 'FL',
      zip: prospect.zip,
      service_type: campaign.pricebook_service_type ?? item.service_type ?? 'Roofing',
      scope_summary: null,
      status: 'draft',
      discount_cents: 0,
      tax_percent: 0,
      lines: [{
        sort_order: 0,
        category: item.category ?? null,
        description: item.description || item.name,
        quantity: prospect.final_squares,     // final billable squares (waste already applied)
        unit: 'SQ',
        unit_price_cents: item.default_unit_price_cents,
        source: 'measurement',
        ai_generated: false,
        needs_review: false,
        pricebook_item_id: item.id,
        labor_cost_cents: null,
        material_cost_cents: null,
        markup_percent: null,
      }],
    } as unknown as Parameters<typeof saveEstimate>[1],
    userId,
  )
  if (!result.ok || !result.estimateId) {
    return { created: false, error: result.error ?? 'Estimate creation failed.' }
  }

  await supabase.from('roof_prospects')
    .update({ estimate_id: result.estimateId, status: 'estimate_ready' })
    .eq('id', prospect.id).is('estimate_id', null)

  await logActivity(supabase, {
    action: 'prospecting.estimate_created', entityType: 'roof_prospect', entityId: prospect.id,
    actorUserId: userId, metadata: { estimate_id: result.estimateId, squares: prospect.final_squares },
  })
  return { estimateId: result.estimateId, created: true }
}

/** Full pipeline for one prospect: lead (idempotent) then estimate (idempotent). */
export async function convertProspect(
  supabase: SupabaseClient,
  prospect: ProspectForConversion,
  campaign: CampaignForConversion | null,
  userId: string,
  opts: { withEstimate: boolean } = { withEstimate: true },
): Promise<ConversionRowResult> {
  try {
    const lead = await convertProspectToLead(supabase, prospect, userId)
    const row: ConversionRowResult = { prospectId: prospect.id, leadId: lead.leadId, leadCreated: lead.created, estimateCreated: false }
    if (!opts.withEstimate) return row
    if (!campaign) { row.blocked = 'pricing'; row.error = 'No campaign on this prospect.'; return row }

    // Re-read the prospect's estimate link fresh (a prior partial run may have set it).
    const { data: fresh } = await supabase
      .from('roof_prospects').select('estimate_id, final_squares').eq('id', prospect.id).maybeSingle()
    const est = await createEstimateForProspect(
      supabase,
      { ...prospect, estimate_id: (fresh?.estimate_id as string | null) ?? prospect.estimate_id, final_squares: (fresh?.final_squares as number | null) ?? prospect.final_squares, converted_lead_id: lead.leadId },
      campaign, lead.leadId, userId,
    )
    row.estimateId = est.estimateId
    row.estimateCreated = est.created
    row.blocked = est.blocked
    if (est.error) row.error = est.error
    return row
  } catch (e) {
    return { prospectId: prospect.id, leadCreated: false, estimateCreated: false, error: e instanceof Error ? e.message : 'Conversion failed.' }
  }
}

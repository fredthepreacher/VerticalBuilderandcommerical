import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignInput } from '../validations/prospecting'
import { logActivity } from '../services/activity'

/**
 * ============================================================================
 * PROSPECTING CAMPAIGNS — data access
 * ----------------------------------------------------------------------------
 * Reusable per-county/source configuration. Reads run under the signed-in user's
 * RLS; the campaigns_write policy (is_staff) plus the prospectingManage
 * capability in the action layer are the two gates on writes.
 * ============================================================================
 */

export interface Campaign {
  id: string
  name: string
  county: string | null
  data_source: string | null
  roof_types: string[]
  permit_date_from: string | null
  permit_date_to: string | null
  min_roof_age_years: number | null
  waste_rule_type: string
  waste_rule_value: number | null
  waste_min_squares: number | null
  pricebook_service_type: string | null
  proposal_template_id: string | null
  default_batch_size: number
  mail_tag: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export async function listCampaigns(
  supabase: SupabaseClient,
  opts: { includeInactive?: boolean } = {},
): Promise<Campaign[]> {
  let query = supabase.from('prospecting_campaigns').select('*').order('created_at', { ascending: false })
  if (!opts.includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) {
    console.error('[prospecting] listCampaigns failed', error)
    return []
  }
  return (data ?? []) as Campaign[]
}

export async function loadCampaign(supabase: SupabaseClient, id: string): Promise<Campaign | null> {
  const { data } = await supabase.from('prospecting_campaigns').select('*').eq('id', id).maybeSingle()
  return (data as Campaign | null) ?? null
}

function toRow(input: CampaignInput) {
  return {
    name: input.name,
    county: input.county ?? null,
    data_source: input.data_source ?? null,
    roof_types: input.roof_types ?? [],
    permit_date_from: input.permit_date_from ?? null,
    permit_date_to: input.permit_date_to ?? null,
    min_roof_age_years: input.min_roof_age_years ?? null,
    waste_rule_type: input.waste_rule_type,
    waste_rule_value: input.waste_rule_value ?? null,
    waste_min_squares: input.waste_min_squares ?? null,
    pricebook_service_type: input.pricebook_service_type ?? null,
    proposal_template_id: input.proposal_template_id ?? null,
    default_batch_size: input.default_batch_size,
    mail_tag: input.mail_tag ?? null,
    active: input.active,
  }
}

export async function saveCampaign(
  supabase: SupabaseClient,
  input: CampaignInput,
  ctx: { userId: string; campaignId?: string },
): Promise<{ id: string }> {
  const row = toRow(input)
  if (ctx.campaignId) {
    const { data, error } = await supabase
      .from('prospecting_campaigns').update(row).eq('id', ctx.campaignId).select('id').single()
    if (error || !data) throw new Error(error?.message ?? 'Campaign update failed.')
    await logActivity(supabase, {
      action: 'prospecting.campaign_updated', entityType: 'prospecting_campaign',
      entityId: ctx.campaignId, actorUserId: ctx.userId, metadata: { name: input.name },
    })
    return { id: data.id as string }
  }
  const { data, error } = await supabase
    .from('prospecting_campaigns').insert({ ...row, created_by: ctx.userId }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Campaign create failed.')
  await logActivity(supabase, {
    action: 'prospecting.campaign_created', entityType: 'prospecting_campaign',
    entityId: data.id as string, actorUserId: ctx.userId, metadata: { name: input.name },
  })
  return { id: data.id as string }
}

export async function archiveCampaign(
  supabase: SupabaseClient, id: string, ctx: { userId: string },
): Promise<void> {
  const { error } = await supabase.from('prospecting_campaigns').update({ active: false }).eq('id', id)
  if (error) throw new Error(error.message)
  await logActivity(supabase, {
    action: 'prospecting.campaign_archived', entityType: 'prospecting_campaign',
    entityId: id, actorUserId: ctx.userId,
  })
}

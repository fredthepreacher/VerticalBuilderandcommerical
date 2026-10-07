import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { convertProspect, type ProspectForConversion, type CampaignForConversion } from '@/lib/ops/prospecting/conversion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CONVERT_CHUNK = 30

/**
 * Bulk-converts APPROVED (qualified) prospects to CRM leads + estimates, one
 * bounded chunk per call. Fully idempotent: only prospects still status
 * 'qualified' are picked up, and convertProspect keys off converted_lead_id /
 * estimate_id — so a retry after a partial failure never creates a duplicate
 * lead or estimate. Returns per-row results and how many remain.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('estimatesCreate') || !user.can('prospectingManage')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as {
    campaignId?: string | null
    batchId?: string | null
    prospectIds?: string[]
    withEstimate?: boolean
    limit?: number
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const supabase = createSupabaseServerClient()
  const limit = Math.min(body.limit ?? CONVERT_CHUNK, CONVERT_CHUNK)

  // Pick the next approved-but-unconverted prospects in scope.
  let q = supabase
    .from('roof_prospects')
    .select('id, status, owner_name, property_address, city, state, zip, mailing_address, parcel_apn, permit_type, permit_date, campaign_id, import_job_id, final_squares, converted_lead_id, estimate_id, prospecting_campaigns(county)')
    .eq('status', 'qualified')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (body.prospectIds && body.prospectIds.length > 0) q = q.in('id', body.prospectIds.slice(0, 500))
  if (body.campaignId) q = q.eq('campaign_id', body.campaignId)
  if (body.batchId) q = q.eq('import_job_id', body.batchId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'Could not load prospects.' }, { status: 500 })
  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  // Cache campaigns for this chunk.
  const campaignCache = new Map<string, CampaignForConversion | null>()
  async function campaignFor(id: string | null): Promise<CampaignForConversion | null> {
    if (!id) return null
    if (campaignCache.has(id)) return campaignCache.get(id)!
    const { data: c } = await supabase
      .from('prospecting_campaigns').select('id, pricebook_item_id, pricebook_service_type').eq('id', id).maybeSingle()
    const val = (c as CampaignForConversion | null) ?? null
    campaignCache.set(id, val)
    return val
  }

  const results = []
  let leadsCreated = 0, leadsExisting = 0, estimatesCreated = 0, blocked = 0, failed = 0
  for (const r of rows) {
    const campaignRow = Array.isArray(r.prospecting_campaigns) ? r.prospecting_campaigns[0] : r.prospecting_campaigns
    const prospect: ProspectForConversion = {
      id: r.id as string, status: r.status as string,
      owner_name: (r.owner_name as string | null) ?? null,
      property_address: (r.property_address as string | null) ?? null,
      city: (r.city as string | null) ?? null, state: (r.state as string | null) ?? null, zip: (r.zip as string | null) ?? null,
      mailing_address: (r.mailing_address as string | null) ?? null,
      parcel_apn: (r.parcel_apn as string | null) ?? null,
      permit_type: (r.permit_type as string | null) ?? null,
      permit_date: (r.permit_date as string | null) ?? null,
      county: ((campaignRow as Record<string, unknown> | null)?.county as string | null) ?? null,
      campaign_id: (r.campaign_id as string | null) ?? null,
      import_job_id: (r.import_job_id as string | null) ?? null,
      final_squares: (r.final_squares as number | null) ?? null,
      converted_lead_id: (r.converted_lead_id as string | null) ?? null,
      estimate_id: (r.estimate_id as string | null) ?? null,
    }
    const campaign = await campaignFor(prospect.campaign_id)
    const row = await convertProspect(supabase, prospect, campaign, user.id, { withEstimate: body.withEstimate !== false })
    results.push(row)
    if (row.leadCreated) leadsCreated += 1; else if (row.leadId) leadsExisting += 1
    if (row.estimateCreated) estimatesCreated += 1
    if (row.blocked) blocked += 1
    if (row.error && !row.blocked) failed += 1
  }

  // Remaining approved prospects in scope (a converted one leaves 'qualified').
  let rq = supabase.from('roof_prospects').select('id', { count: 'exact', head: true }).eq('status', 'qualified')
  if (body.prospectIds && body.prospectIds.length > 0) rq = rq.in('id', body.prospectIds.slice(0, 500))
  if (body.campaignId) rq = rq.eq('campaign_id', body.campaignId)
  if (body.batchId) rq = rq.eq('import_job_id', body.batchId)
  const { count: remaining } = await rq

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    remaining: remaining ?? 0,
    totals: { leadsCreated, leadsExisting, estimatesCreated, blocked, failed },
    results,
  })
}

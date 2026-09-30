import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { normalizeAddress } from '@/lib/ops/imports/address'
import { sweepStaleImportJobs, SUPERSEDED_REASON } from '@/lib/ops/imports/job-lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Starts a roof-prospecting import job and returns the address keys already
 * present so the browser can flag duplicates in the preview. Deduplication is by
 * property address_key, checked against BOTH existing prospects and existing CRM
 * leads — a house already worked as a lead should not silently re-enter as a
 * fresh prospect. Only normalised keys cross the wire, never readable data.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    filename?: string
    totalRows?: number
    mapping?: Record<string, number>
    campaignId?: string | null
    county?: string | null
    duplicateStrategy?: 'skip' | 'import_anyway'
    addresses?: string[]
  } | null

  if (!body?.filename || typeof body.totalRows !== 'number') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.totalRows > 50_000) {
    return NextResponse.json({ error: 'That file has more than 50,000 rows. Split it and import in parts.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()
  await sweepStaleImportJobs(supabase, { scopeToUser: user.id, reason: SUPERSEDED_REASON })

  const strategy = body.duplicateStrategy === 'import_anyway' ? 'import_anyway' : 'skip'

  const { data: job, error } = await supabase
    .from('lead_import_jobs')
    .insert({
      original_filename: body.filename.slice(0, 260),
      total_rows: body.totalRows,
      status: 'validating',
      kind: 'roof_prospect',
      import_mode: 'property_prospect',
      mapping_json: body.mapping ?? {},
      duplicate_strategy: strategy,
      campaign_id: body.campaignId ?? null,
      county: body.county ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !job) {
    console.error('[prospecting] job creation failed', error)
    return NextResponse.json({ error: 'The import could not be started.' }, { status: 500 })
  }

  const requestedAddresses = (body.addresses ?? [])
    .map(a => normalizeAddress(a)).filter((a): a is string => Boolean(a)).slice(0, 50_000)

  const duplicateProspects: Record<string, string> = {}
  const duplicateLeads: Record<string, string> = {}

  for (let i = 0; i < requestedAddresses.length; i += 500) {
    const slice = requestedAddresses.slice(i, i + 500)
    const [{ data: pros }, { data: leads }] = await Promise.all([
      supabase.from('roof_prospects').select('id, address_key').in('address_key', slice),
      supabase.from('leads').select('id, address_key').in('address_key', slice).is('archived_at', null),
    ])
    for (const row of pros ?? []) {
      const key = row.address_key as string | null
      if (key && !duplicateProspects[key]) duplicateProspects[key] = row.id as string
    }
    for (const row of leads ?? []) {
      const key = row.address_key as string | null
      if (key && !duplicateLeads[key]) duplicateLeads[key] = row.id as string
    }
  }

  await logActivity(supabase, {
    action: 'prospecting.import_started',
    entityType: 'lead_import',
    entityId: job.id as string,
    actorUserId: user.id,
    metadata: { filename: body.filename, total_rows: body.totalRows, campaign_id: body.campaignId ?? null },
  })

  return NextResponse.json({ ok: true, importJobId: job.id, duplicateProspects, duplicateLeads })
}

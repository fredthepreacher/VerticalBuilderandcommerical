import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { countPendingEnrichment } from '@/lib/ops/prospecting/enrich-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Starts (or resumes) a FREE enrichment pass over one prospect import batch.
 * Creates an enrichment job row for observability. No provider is contacted.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { sourceBatchId?: string } | null
  if (!body?.sourceBatchId) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const supabase = createSupabaseServerClient()
  const { data: source } = await supabase
    .from('lead_import_jobs').select('id, kind, original_filename, campaign_id, county')
    .eq('id', body.sourceBatchId).maybeSingle()
  if (!source || source.kind !== 'roof_prospect') {
    return NextResponse.json({ error: 'That batch is not a prospect import.' }, { status: 400 })
  }

  const pending = await countPendingEnrichment(supabase, body.sourceBatchId)

  const { data: job, error } = await supabase
    .from('lead_import_jobs')
    .insert({
      original_filename: `Enrichment — ${source.original_filename}`.slice(0, 260),
      total_rows: pending,
      status: 'importing',
      kind: 'enrichment',
      import_mode: 'property_prospect',
      mapping_json: { source_batch_id: body.sourceBatchId },
      campaign_id: source.campaign_id ?? null,
      county: source.county ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !job) {
    console.error('[enrich] job creation failed', error)
    return NextResponse.json({ error: 'The enrichment run could not be started.' }, { status: 500 })
  }

  await logActivity(supabase, {
    action: 'prospecting.enrichment_started', entityType: 'lead_import', entityId: job.id as string,
    actorUserId: user.id, metadata: { source_batch_id: body.sourceBatchId, pending },
  })

  return NextResponse.json({ ok: true, jobId: job.id, sourceBatchId: body.sourceBatchId, total: pending })
}

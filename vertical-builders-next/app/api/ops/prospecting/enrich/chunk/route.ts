import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { enrichChunk } from '@/lib/ops/prospecting/enrich-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Processes one bounded chunk of a free enrichment run and reports progress.
 * The client calls it until `remaining` is 0. Idempotent — only prospects at
 * enrichment_stage='not_started' are processed, so a retry never double-works a
 * row and never re-charges (no provider is called at all).
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { jobId?: string; sourceBatchId?: string } | null
  if (!body?.jobId || !body?.sourceBatchId) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()
  const { data: job } = await supabase
    .from('lead_import_jobs').select('*').eq('id', body.jobId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Enrichment job not found.' }, { status: 404 })
  if (job.status === 'cancelled') return NextResponse.json({ error: 'This run was cancelled.' }, { status: 409 })

  const chunk = await enrichChunk(supabase, body.sourceBatchId)

  const done = chunk.remaining === 0
  await supabase.from('lead_import_jobs').update({
    processed_rows: (job.processed_rows as number) + chunk.processed,
    imported_rows: (job.imported_rows as number) + chunk.finalized,
    needs_review_rows: (job.needs_review_rows as number ?? 0) + chunk.review,
    skipped_rows: (job.skipped_rows as number) + chunk.deferred,
    status: done ? 'completed' : 'importing',
    ...(done ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', body.jobId)

  if (done) {
    await logActivity(supabase, {
      action: 'prospecting.enrichment_completed', entityType: 'lead_import', entityId: body.jobId,
      actorUserId: user.id, metadata: { processed: (job.processed_rows as number) + chunk.processed },
    })
  }

  return NextResponse.json({ ok: true, chunk, remaining: chunk.remaining, done })
}

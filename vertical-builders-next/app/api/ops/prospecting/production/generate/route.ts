import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { generateBatchChunk, GENERATE_CHUNK } from '@/lib/ops/prospecting/mail-batch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Generates proposal PDFs for one bounded chunk of a mail batch, then reports how
 * many remain. The client loops until remaining = 0, so a 60-record batch is
 * produced across several calls without freezing the browser and is fully
 * resumable: only pending/failed items are picked up, and an item that already
 * produced a document is never re-rendered (idempotent).
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('proposalsGenerate')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { batchId?: string; chunkSize?: number } | null
  if (!body?.batchId) return NextResponse.json({ error: 'Missing batch id.' }, { status: 400 })

  const supabase = createSupabaseServerClient()
  const admin = createSupabaseAdminClient()
  const chunkSize = Math.min(body.chunkSize ?? GENERATE_CHUNK, GENERATE_CHUNK)

  const result = await generateBatchChunk(supabase, admin, body.batchId, user.id, chunkSize)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'Generation failed.' }, { status: 400 })
  return NextResponse.json(result)
}

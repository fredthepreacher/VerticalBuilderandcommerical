import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { loadMailBatch, loadMailBatchItems, buildManifestCsv } from '@/lib/ops/prospecting/mail-batch-read'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Downloads the batch manifest as CSV (spec §10). */
export async function GET(_request: NextRequest, { params }: { params: { batchId: string } }) {
  const user = await requireUser()
  if (!user.can('mailBatchExport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const supabase = createSupabaseServerClient()
  const batch = await loadMailBatch(supabase, params.batchId)
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  const items = await loadMailBatchItems(supabase, params.batchId)
  const csv = buildManifestCsv({ id: batch.id, campaignName: batch.campaignName, county: batch.county }, items)
  const safeName = batch.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)
  const filename = `Manifest_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

import { NextResponse, type NextRequest } from 'next/server'
import JSZip from 'jszip'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { downloadToBuffer } from '@/lib/ops/services/documents'
import { getSettings } from '@/lib/ops/services/settings'
import { logActivity } from '@/lib/ops/services/activity'
import { estimatePdfFilename, renderEstimatePdf } from '@/lib/ops/estimating/pdf'
import { buildPdfInput } from '@/lib/ops/estimating/render-input'

/**
 * ============================================================================
 * BATCH ESTIMATE EXPORT
 * ----------------------------------------------------------------------------
 * Select N estimates, get N individual PDFs in one ZIP.
 *
 * Deliberately NOT merged into a single PDF: these belong to different
 * customers, and one combined file is useless for sending anything out. The
 * spec says the same.
 *
 * A failure on one estimate does not sink the batch — the ZIP is delivered with
 * the successes plus an EXPORT_ERRORS.txt naming exactly what failed and why.
 * ============================================================================
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ESTIMATES = 40

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('estimatesBatchExport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: string[]; includePhotos?: boolean }
  const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string') : []

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one estimate.' }, { status: 400 })
  }
  if (ids.length > MAX_ESTIMATES) {
    return NextResponse.json(
      { error: `Export up to ${MAX_ESTIMATES} estimates at a time. Narrow the selection and run it twice.` },
      { status: 400 },
    )
  }

  const supabase = createSupabaseServerClient()
  const admin = createSupabaseAdminClient()
  const settings = await getSettings(supabase)

  const zip = new JSZip()
  const failures: string[] = []
  let succeeded = 0

  for (const id of ids) {
    try {
      const prepared = await buildPdfInput(supabase, admin, id, {
        // Photos are opt-in for a batch: 40 estimates with 8 photos each is a
        // 200 MB ZIP and a timeout.
        includePhotos: body.includePhotos === true,
        taxEnabled: settings.estimate_tax_enabled,
        downloadPhoto: (path: string) => downloadToBuffer(admin, path),
      })

      if (!prepared) {
        failures.push(`${id}: not found, or you do not have access to it.`)
        continue
      }

      const pdf = await renderEstimatePdf(prepared.input)
      zip.file(estimatePdfFilename(prepared.input.estimate, prepared.customerName), pdf)
      succeeded += 1
    } catch (error) {
      console.error('[batch-export] failed for', id, error)
      failures.push(`${id}: ${error instanceof Error ? error.message : 'could not be rendered'}`)
    }
  }

  if (succeeded === 0) {
    return NextResponse.json(
      { error: 'None of the selected estimates could be exported.', failures },
      { status: 500 },
    )
  }

  if (failures.length > 0) {
    zip.file(
      'EXPORT_ERRORS.txt',
      [
        'Some estimates could not be exported.',
        '',
        ...failures.map(f => `  - ${f}`),
        '',
        `${succeeded} of ${ids.length} exported successfully.`,
      ].join('\n'),
    )
  }

  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const filename = `Vertical_Estimates_${new Date().toISOString().slice(0, 10)}.zip`

  await logActivity(supabase, {
    action: 'estimate.batch_exported',
    entityType: 'estimate',
    actorUserId: user.id,
    metadata: { requested: ids.length, exported: succeeded, failed: failures.length },
  })

  return new NextResponse(new Uint8Array(archive), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(archive.byteLength),
      'X-Export-Succeeded': String(succeeded),
      'X-Export-Failed': String(failures.length),
      'Cache-Control': 'private, no-store',
    },
  })
}

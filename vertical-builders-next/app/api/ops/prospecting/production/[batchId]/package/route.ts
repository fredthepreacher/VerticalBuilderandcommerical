import { NextResponse, type NextRequest } from 'next/server'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { downloadToBuffer } from '@/lib/ops/services/documents'
import { loadMailBatch, loadMailBatchItems, buildManifestCsv } from '@/lib/ops/prospecting/mail-batch-read'
import { sanitizeFilename } from '@/lib/ops/utils/files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Downloads the batch production package: every individual proposal PDF (the
 * per-record documents are preserved, never merged away), a single combined PDF
 * in batch order for convenient printing, and the manifest CSV. Records that did
 * not generate are listed in BLOCKED_AND_FAILED.txt so nothing is silently
 * dropped. Producing the package marks the batch exported (idempotent).
 */
export async function GET(_request: NextRequest, { params }: { params: { batchId: string } }) {
  const user = await requireUser()
  if (!user.can('mailBatchExport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const supabase = createSupabaseServerClient()
  const admin = createSupabaseAdminClient()

  const batch = await loadMailBatch(supabase, params.batchId)
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  const items = await loadMailBatchItems(supabase, params.batchId)
  const generated = items.filter(i => i.generationStatus === 'generated' && i.documentId)

  if (generated.length === 0) {
    return NextResponse.json({ error: 'No generated proposals in this batch yet.' }, { status: 400 })
  }

  // Resolve storage paths for the generated documents.
  const docIds = generated.map(i => i.documentId!) as string[]
  const { data: docs } = await admin
    .from('documents').select('id, storage_path').in('id', docIds)
  const pathById = new Map<string, string>()
  for (const d of (docs ?? []) as { id: string; storage_path: string }[]) pathById.set(d.id, d.storage_path)

  const zip = new JSZip()
  const combined = await PDFDocument.create()
  const failures: string[] = []
  let added = 0

  for (const item of generated) {
    const path = pathById.get(item.documentId!)
    if (!path) { failures.push(`${item.recipientName ?? item.prospectId}: document path missing.`); continue }
    const bytes = await downloadToBuffer(admin, path)
    if (!bytes) { failures.push(`${item.recipientName ?? item.prospectId}: PDF could not be read from storage.`); continue }

    const base = sanitizeFilename(
      `${item.estimateNumber ?? 'proposal'}_${item.recipientName ?? 'recipient'}.pdf`, 'proposal',
    )
    zip.file(`proposals/${String(added + 1).padStart(3, '0')}_${base}`, bytes)

    try {
      const src = await PDFDocument.load(bytes)
      const pages = await combined.copyPages(src, src.getPageIndices())
      pages.forEach(p => combined.addPage(p))
    } catch {
      failures.push(`${item.recipientName ?? item.prospectId}: could not be added to the combined PDF (kept as an individual file).`)
    }
    added += 1
  }

  // Combined PDF in batch order.
  if (combined.getPageCount() > 0) {
    zip.file('combined/AllProposals.pdf', await combined.save())
  }

  // Manifest.
  zip.file('manifest.csv', buildManifestCsv({ id: batch.id, campaignName: batch.campaignName, county: batch.county }, items))

  // Anything not mailable, named explicitly.
  const notReady = items.filter(i => i.generationStatus !== 'generated')
  if (notReady.length > 0 || failures.length > 0) {
    zip.file('BLOCKED_AND_FAILED.txt', [
      'Records not included as mailable proposals:',
      '',
      ...notReady.map(i => `  - ${i.recipientName ?? i.prospectId}: ${i.generationStatus.toUpperCase()}${i.blockReason ? ` (${i.blockReason})` : ''}${i.errorMessage ? ` — ${i.errorMessage}` : ''}`),
      ...failures.map(f => `  - ${f}`),
      '',
      `${added} of ${items.length} records produced a proposal.`,
    ].join('\n'))
  }

  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  // Mark exported (idempotent — only stamps the first time), without blocking the download.
  await supabase.from('mail_batches')
    .update({ exported_at: new Date().toISOString(), status: batch.status === 'ready' || batch.status === 'partial' ? 'exported' : batch.status })
    .eq('id', batch.id).is('exported_at', null)

  const safeName = batch.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)
  const filename = `MailBatch_${safeName}_${new Date().toISOString().slice(0, 10)}.zip`

  return new NextResponse(new Uint8Array(archive), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(archive.byteLength),
      'Cache-Control': 'private, no-store',
    },
  })
}

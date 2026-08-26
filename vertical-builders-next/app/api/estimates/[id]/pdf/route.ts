import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { downloadToBuffer } from '@/lib/ops/services/documents'
import { getSettings } from '@/lib/ops/services/settings'
import { estimatePdfFilename, renderEstimatePdf } from '@/lib/ops/estimating/pdf'
import { buildPdfInput } from '@/lib/ops/estimating/render-input'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Renders one estimate as a branded PDF.
 * `?disposition=inline` previews in the browser; the default downloads.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('estimatesView')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const supabase = createSupabaseServerClient()
  const admin = createSupabaseAdminClient()
  const settings = await getSettings(supabase)

  const prepared = await buildPdfInput(supabase, admin, params.id, {
    includePhotos: request.nextUrl.searchParams.get('photos') !== '0',
    taxEnabled: settings.estimate_tax_enabled,
    downloadPhoto: (path: string) => downloadToBuffer(admin, path),
  })

  if (!prepared) {
    return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 })
  }

  try {
    const pdf = await renderEstimatePdf(prepared.input)
    const filename = estimatePdfFilename(prepared.input.estimate, prepared.input.customerName)
    const inline = request.nextUrl.searchParams.get('disposition') === 'inline'

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
        'Content-Length': String(pdf.byteLength),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[estimate-pdf] render failed', error)
    return NextResponse.json(
      { error: 'The PDF could not be generated. Check the estimate for unusual characters and try again.' },
      { status: 500 },
    )
  }
}

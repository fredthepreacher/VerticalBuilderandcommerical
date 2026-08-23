import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { requestRenewal } from '@/lib/ops/services/vendors'

/**
 * Programmatic "Request Updated COI". The UI uses a server action; this exists
 * so the same workflow can be triggered from a script or an integration.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('requestRenewal')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    vendorId?: string
    documentType?: string
    message?: string
  }
  if (!body.vendorId) {
    return NextResponse.json({ error: 'vendorId is required.' }, { status: 400 })
  }

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const baseUrl = process.env.NEXT_PUBLIC_CRM_URL || process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`

  const supabase = createSupabaseServerClient()
  const result = await requestRenewal(supabase, {
    vendorId: body.vendorId,
    actorUserId: user.id,
    requestedDocumentType: body.documentType ?? 'coi',
    message: body.message ?? null,
    baseUrl,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({
    ok: true,
    uploadUrl: result.uploadUrl,
    expiresAt: result.expiresAt,
    emailStatus: result.emailStatus,
  })
}

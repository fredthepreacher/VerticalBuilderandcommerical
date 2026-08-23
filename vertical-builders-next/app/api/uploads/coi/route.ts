import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { isOpsConfigured } from '@/lib/ops/supabase/env'
import { logActivity } from '@/lib/ops/services/activity'
import { uploadDocument } from '@/lib/ops/services/documents'
import { getSettings } from '@/lib/ops/services/settings'
import { officeEmail, recordNotification, sendEmail } from '@/lib/ops/services/notifications'
import { checkTokenState, hashToken } from '@/lib/ops/utils/tokens'
import type { DocumentType } from '@/lib/ops/types'

/**
 * ============================================================================
 * VENDOR SELF-SERVICE UPLOAD  —  no login, secure token
 * ----------------------------------------------------------------------------
 * The vendor (or their insurance agent) opens /upload/coi/{token} and posts
 * here. The token is hashed before lookup, so a leaked database row cannot be
 * replayed, and the vendor id never appears in the URL — there is nothing to
 * enumerate.
 *
 * Everything the uploader sends is treated as hostile: the file type and size
 * are enforced server-side, the filename is sanitised, and the storage path is
 * built from the token's own vendor id, never from anything in the request.
 *
 * The result is always a certificate marked NEEDS_REVIEW. An upload can never
 * make a vendor compliant on its own.
 * ============================================================================
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 6
const buckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    if (buckets.size > 5000) buckets.clear()
    return false
  }
  bucket.count += 1
  return bucket.count > MAX_PER_WINDOW
}

export async function POST(request: NextRequest) {
  if (!isOpsConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'Uploads are not available right now.' }, { status: 503 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Please wait a minute.' }, { status: 429 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const token = String(form.get('token') ?? '')
  if (!token || token.length < 20 || token.length > 200) {
    return NextResponse.json({ ok: false, error: 'This upload link is not valid.' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  const { data: tokenRow } = await admin
    .from('upload_tokens')
    .select('id, vendor_id, requested_document_type, expires_at, used_at, revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  const state = checkTokenState(tokenRow as { expires_at: string; revoked_at: string | null; used_at: string | null } | null)
  if (!state.valid) {
    return NextResponse.json({ ok: false, error: state.message }, { status: 403 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Choose a file to upload.' }, { status: 400 })
  }

  const settings = await getSettings(admin)
  const vendorId = tokenRow!.vendor_id as string
  const documentType = (tokenRow!.requested_document_type as DocumentType) ?? 'coi'

  const upload = await uploadDocument(admin, {
    file,
    entityType: 'vendor',
    entityId: vendorId,          // from the token, never from the request body
    documentType,
    uploadedBy: null,
    maxBytes: settings.max_upload_mb * 1024 * 1024,
  })
  if (!upload.ok) {
    return NextResponse.json({ ok: false, error: upload.error }, { status: 400 })
  }

  const { data: vendor } = await admin
    .from('vendors').select('legal_name').eq('id', vendorId).maybeSingle()

  // A certificate shell so the document shows up in the review queue with the
  // broker details the uploader gave us. Coverage lines are entered by the
  // office against the actual document — we never guess them.
  let certificateId: string | null = null
  if (documentType === 'coi') {
    const { data: cert } = await admin
      .from('insurance_certificates')
      .insert({
        vendor_id: vendorId,
        document_id: upload.document!.id,
        source: 'vendor_portal',
        review_status: 'needs_review',
        broker_name: text(form, 'broker_name'),
        broker_contact_name: text(form, 'broker_contact_name'),
        broker_email: text(form, 'broker_email'),
        broker_phone: text(form, 'broker_phone'),
        named_insured: text(form, 'named_insured') ?? (vendor?.legal_name as string | undefined) ?? null,
        certificate_holder: 'Vertical Builders & Commercial',
        reviewer_notes: text(form, 'message'),
      })
      .select('id')
      .single()
    certificateId = (cert?.id as string) ?? null
  }

  await admin.from('upload_tokens').update({ used_at: new Date().toISOString() }).eq('id', tokenRow!.id)

  await logActivity(admin, {
    action: 'coi.uploaded',
    entityType: 'vendor',
    entityId: vendorId,
    actorLabel: 'Vendor upload portal',
    metadata: {
      document_id: upload.document!.id,
      certificate_id: certificateId,
      document_type: documentType,
      filename: upload.document!.original_filename,
    },
  })

  const crmUrl = `${(process.env.NEXT_PUBLIC_CRM_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')}/ops/subcontractors/${vendorId}?tab=insurance`
  const outcome = await sendEmail({
    to: officeEmail(),
    subject: `${vendor?.legal_name ?? 'A subcontractor'} uploaded a document — needs review`,
    text: [
      `${vendor?.legal_name ?? 'A subcontractor'} uploaded "${upload.document!.original_filename}" through the secure link.`,
      '',
      'It is waiting in the review queue. Enter the coverage lines from the document, then approve it.',
      '',
      crmUrl,
    ].join('\n'),
  })
  await recordNotification(admin, {
    vendorId,
    notificationType: 'vendor_upload_received',
    recipient: officeEmail(),
    outcome,
  })

  return NextResponse.json({ ok: true })
}

function text(form: FormData, key: string): string | null {
  const value = form.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, 500)
  return trimmed === '' ? null : trimmed
}

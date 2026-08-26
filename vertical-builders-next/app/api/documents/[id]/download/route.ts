import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { createSignedUrl } from '@/lib/ops/services/documents'
import { logActivity } from '@/lib/ops/services/activity'

/**
 * Private document download.
 *
 * There is no public URL for anything in the bucket. This route authenticates
 * the caller, checks the document actually exists under RLS (so a read-only
 * auditor sees only what their role allows), mints a 5-minute signed URL, logs
 * the download, and redirects. The signed URL is never stored or reused.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser()

  if (!user.can('downloadDocuments')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  // Read through the USER's client: RLS decides whether they can see this row.
  const supabase = createSupabaseServerClient()
  const { data: document } = await supabase
    .from('documents')
    .select('id, storage_path, original_filename, entity_type, entity_id, mime_type')
    .eq('id', params.id)
    .maybeSingle()

  if (!document) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  }

  const admin = createSupabaseAdminClient()
  const signedUrl = await createSignedUrl(
    admin,
    document.storage_path as string,
    300,
    document.original_filename as string,
  )

  if (!signedUrl) {
    return NextResponse.json({ error: 'That file could not be retrieved. Contact an administrator.' }, { status: 502 })
  }

  await logActivity(supabase, {
    action: 'document.downloaded',
    entityType: document.entity_type as string,
    entityId: document.entity_id as string,
    actorUserId: user.id,
    metadata: { document_id: document.id, filename: document.original_filename },
  })

  return NextResponse.redirect(signedUrl, { status: 302 })
}

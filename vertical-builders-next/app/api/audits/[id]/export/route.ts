import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { createSignedUrl } from '@/lib/ops/services/documents'
import { logActivity } from '@/lib/ops/services/activity'

/**
 * Download a previously generated audit package by its export id.
 *
 * Old exports stay downloadable forever — that is the point. A package handed
 * to an auditor in March must still resolve in September, byte for byte.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('downloadDocuments')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const supabase = createSupabaseServerClient()
  const { data: exportRow } = await supabase
    .from('audit_exports')
    .select('id, audit_cycle_id, storage_path, filename')
    .eq('id', params.id)
    .maybeSingle()

  if (!exportRow?.storage_path) {
    return NextResponse.json({ error: 'Export not found.' }, { status: 404 })
  }

  const admin = createSupabaseAdminClient()
  const signedUrl = await createSignedUrl(
    admin,
    exportRow.storage_path as string,
    600,
    (exportRow.filename as string) ?? 'audit-package.zip',
  )
  if (!signedUrl) {
    return NextResponse.json({ error: 'That package could not be retrieved.' }, { status: 502 })
  }

  await logActivity(supabase, {
    action: 'document.downloaded',
    entityType: 'audit_cycle',
    entityId: exportRow.audit_cycle_id as string,
    actorUserId: user.id,
    metadata: { export_id: exportRow.id, filename: exportRow.filename },
  })

  return NextResponse.redirect(signedUrl, { status: 302 })
}

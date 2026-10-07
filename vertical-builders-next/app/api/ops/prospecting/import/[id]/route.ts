import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { cancelImportJob } from '@/lib/ops/imports/job-lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Prospecting import job status. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const supabase = createSupabaseServerClient()
  const { data: job } = await supabase
    .from('lead_import_jobs').select('*').eq('id', params.id).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Import not found.' }, { status: 404 })
  return NextResponse.json({ job })
}

/**
 * Cancels an import the operator backed out of (also reachable via POST for
 * navigator.sendBeacon). cancelImportJob refuses anything that already wrote
 * rows, so a late beacon cannot relabel a real import as cancelled.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const supabase = createSupabaseServerClient()
  const result = await cancelImportJob(supabase, params.id)
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  return DELETE(request, context)
}

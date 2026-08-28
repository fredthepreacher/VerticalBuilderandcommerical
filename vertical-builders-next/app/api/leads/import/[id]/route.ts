import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { toCsv } from '@/lib/ops/utils/csv'
import { cancelImportJob } from '@/lib/ops/imports/job-lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Import job status, or its error report as a CSV when `?format=csv`.
 * The operator fixes the rows in that file and re-imports just those.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('leadsImport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const supabase = createSupabaseServerClient()
  const { data: job } = await supabase
    .from('lead_import_jobs').select('*').eq('id', params.id).maybeSingle()

  if (!job) return NextResponse.json({ error: 'Import not found.' }, { status: 404 })

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    const { data: errors } = await supabase
      .from('lead_import_errors')
      .select('row_number, error_code, error_message, raw_row_json')
      .eq('import_job_id', params.id)
      .order('row_number')
      .limit(10_000)

    const rows = (errors ?? []).map(e => {
      const raw = (e.raw_row_json ?? {}) as Record<string, string>
      return [
        e.row_number,
        e.error_code,
        e.error_message,
        raw.first_name ?? '', raw.last_name ?? '', raw.company_name ?? '',
        raw.email ?? '', raw.phone ?? '',
        raw.property_address ?? '', raw.city ?? '', raw.state ?? '', raw.zip ?? '',
        raw.service_type ?? '', raw.source ?? '', raw.notes ?? '',
      ]
    })

    const csv = toCsv(
      ['Row', 'Code', 'Reason', 'First name', 'Last name', 'Company', 'Email', 'Phone',
        'Address', 'City', 'State', 'ZIP', 'Service type', 'Source', 'Notes'],
      rows,
    )

    const safeName = String(job.original_filename).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="import_errors_${safeName}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  const { count } = await supabase
    .from('lead_import_errors')
    .select('id', { count: 'exact', head: true })
    .eq('import_job_id', params.id)

  return NextResponse.json({ job, errorCount: count ?? 0 })
}

/**
 * Cancels an import the operator backed out of.
 *
 * Sent when they return to the mapping step, start over, or leave the page with
 * a preview open — the last of those via `navigator.sendBeacon`, which is why
 * this accepts a body-less request and never requires a JSON content type.
 *
 * `cancelImportJob` refuses anything that has already written rows, so a beacon
 * that arrives late — after the import ran to completion — cannot relabel a
 * real import as cancelled.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('leadsImport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const supabase = createSupabaseServerClient()
  const result = await cancelImportJob(supabase, params.id)

  // A refusal is not an error the browser needs to act on: the operator has
  // already navigated away, and the job is in a state we deliberately protect.
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}

/**
 * `sendBeacon` can only issue POST, so the same cancellation is reachable that
 * way. Kept to one implementation so the two cannot diverge.
 */
export async function POST(request: NextRequest, context: { params: { id: string } }) {
  return DELETE(request, context)
}

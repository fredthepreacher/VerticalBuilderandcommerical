import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { normalizeEmail, normalizePhone } from '@/lib/ops/imports/leads'
import type { DuplicateStrategy } from '@/lib/ops/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Creates the import job record and returns the existing-lead identifiers the
 * browser needs to flag duplicates in the preview.
 *
 * Only NORMALISED emails and phone digits cross the wire — no names, no
 * addresses, no lead ids beyond what is needed to link a match. The preview
 * can say "this one is already in the CRM" without shipping the CRM to it.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('leadsImport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    filename?: string
    totalRows?: number
    mapping?: Record<string, number>
    duplicateStrategy?: DuplicateStrategy
    importTag?: string
    emails?: string[]
    phones?: string[]
  } | null

  if (!body?.filename || typeof body.totalRows !== 'number') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.totalRows > 50_000) {
    return NextResponse.json(
      { error: 'That file has more than 50,000 rows. Split it and import in parts.' },
      { status: 400 },
    )
  }

  const supabase = createSupabaseServerClient()

  const { data: job, error } = await supabase
    .from('lead_import_jobs')
    .insert({
      original_filename: body.filename.slice(0, 260),
      total_rows: body.totalRows,
      status: 'validating',
      mapping_json: body.mapping ?? {},
      duplicate_strategy: body.duplicateStrategy ?? 'skip',
      import_tag: body.importTag ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !job) {
    console.error('[import] job creation failed', error)
    return NextResponse.json({ error: 'The import could not be started.' }, { status: 500 })
  }

  const requestedEmails = (body.emails ?? [])
    .map(normalizeEmail).filter((e): e is string => Boolean(e)).slice(0, 50_000)
  const requestedPhones = new Set(
    (body.phones ?? []).map(normalizePhone).filter((p): p is string => Boolean(p)),
  )

  const duplicateEmails: Record<string, string> = {}
  const duplicatePhones: Record<string, string> = {}

  // Emails in manageable batches — PostgREST has a URL length limit.
  for (let i = 0; i < requestedEmails.length; i += 500) {
    const slice = requestedEmails.slice(i, i + 500)
    const { data } = await supabase
      .from('leads').select('id, email').in('email', slice).is('archived_at', null)
    for (const row of data ?? []) {
      const key = normalizeEmail(row.email as string | null)
      if (key && !duplicateEmails[key]) duplicateEmails[key] = row.id as string
    }
  }

  if (requestedPhones.size > 0) {
    const { data } = await supabase
      .from('leads').select('id, phone').not('phone', 'is', null).is('archived_at', null).limit(10_000)
    for (const row of data ?? []) {
      const key = normalizePhone(row.phone as string | null)
      if (key && requestedPhones.has(key) && !duplicatePhones[key]) {
        duplicatePhones[key] = row.id as string
      }
    }
  }

  await logActivity(supabase, {
    action: 'lead_import.started',
    entityType: 'lead_import',
    entityId: job.id as string,
    actorUserId: user.id,
    metadata: { filename: body.filename, total_rows: body.totalRows },
  })

  return NextResponse.json({
    ok: true,
    importJobId: job.id,
    duplicateEmails,
    duplicatePhones,
    // Whether the phone sweep was complete. Above the cap the preview may
    // under-report duplicates, which the import itself then catches per chunk.
    phoneCheckComplete: requestedPhones.size === 0 || Object.keys(duplicatePhones).length < 10_000,
  })
}

import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { normalizeEmail, normalizePhone, IMPORT_MODES, type ImportMode } from '@/lib/ops/imports/leads'
import { normalizeAddress } from '@/lib/ops/imports/address'
import { sweepStaleImportJobs, SUPERSEDED_REASON } from '@/lib/ops/imports/job-lifecycle'
import type { DuplicateStrategy } from '@/lib/ops/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Creates the import job record and returns the existing-lead identifiers the
 * browser needs to flag duplicates in the preview.
 *
 * Only NORMALISED keys cross the wire — email, phone digits, and the canonical
 * address form. No names, no readable addresses, no lead ids beyond what is
 * needed to link a match. The preview can say "this one is already in the CRM"
 * without shipping the CRM to it.
 *
 * The address key is the DB's own generated `address_key` column, so the
 * preview matches on exactly what the import will match on.
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
    importMode?: string
    importTag?: string
    leadSource?: string
    emails?: string[]
    phones?: string[]
    addresses?: string[]
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

  // The mode decides which validation rules the whole job runs under, so it is
  // narrowed to the allowlist here rather than trusted from the body.
  const importMode: ImportMode =
    IMPORT_MODES.includes(body.importMode as ImportMode) ? (body.importMode as ImportMode) : 'standard'

  const supabase = createSupabaseServerClient()

  // Starting an import is the moment we learn the previous one was abandoned:
  // the operator is plainly not coming back to it. Scoped to this user and to
  // jobs that wrote nothing, so it can never touch somebody else's work or a
  // job that actually imported rows.
  await sweepStaleImportJobs(supabase, { scopeToUser: user.id, reason: SUPERSEDED_REASON })

  const { data: job, error } = await supabase
    .from('lead_import_jobs')
    .insert({
      original_filename: body.filename.slice(0, 260),
      total_rows: body.totalRows,
      status: 'validating',
      mapping_json: body.mapping ?? {},
      duplicate_strategy: body.duplicateStrategy ?? 'skip',
      import_mode: importMode,
      import_tag: body.importTag ?? null,
      lead_source: body.leadSource ?? null,
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

  const requestedAddresses = (body.addresses ?? [])
    .map(a => normalizeAddress(a)).filter((a): a is string => Boolean(a)).slice(0, 50_000)

  const duplicateEmails: Record<string, string> = {}
  const duplicatePhones: Record<string, string> = {}
  const duplicateAddresses: Record<string, string> = {}

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

  // Address keys are a real indexed column, so this is an exact `in` lookup
  // rather than the fetch-and-normalise sweep the phone check has to do.
  for (let i = 0; i < requestedAddresses.length; i += 500) {
    const slice = requestedAddresses.slice(i, i + 500)
    const { data } = await supabase
      .from('leads').select('id, address_key').in('address_key', slice).is('archived_at', null)
    for (const row of data ?? []) {
      const key = row.address_key as string | null
      if (key && !duplicateAddresses[key]) duplicateAddresses[key] = row.id as string
    }
  }

  await logActivity(supabase, {
    action: 'lead_import.started',
    entityType: 'lead_import',
    entityId: job.id as string,
    actorUserId: user.id,
    metadata: { filename: body.filename, total_rows: body.totalRows, mode: importMode },
  })

  return NextResponse.json({
    ok: true,
    importJobId: job.id,
    importMode,
    duplicateEmails,
    duplicatePhones,
    duplicateAddresses,
    // Whether the phone sweep was complete. Above the cap the preview may
    // under-report duplicates, which the import itself then catches per chunk.
    phoneCheckComplete: requestedPhones.size === 0 || Object.keys(duplicatePhones).length < 10_000,
  })
}

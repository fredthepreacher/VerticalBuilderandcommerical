import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import {
  CHUNK_SIZE, IMPORT_FIELDS, IMPORT_MODES, mapRow, normalizeEmail, normalizePhone,
  resolveName, validateRows, type ColumnMapping, type ImportMode,
} from '@/lib/ops/imports/leads'
import type { DuplicateStrategy } from '@/lib/ops/types'

/**
 * ============================================================================
 * CHUNKED LEAD IMPORT
 * ----------------------------------------------------------------------------
 * The browser parses the file, then posts it here in slices. This endpoint
 * handles ONE slice and returns counts; the client loops until done, showing
 * real progress.
 *
 * Why not one request for the whole file: a 10,000-row import in a single
 * serverless invocation will hit the execution limit, and when it does there is
 * no way to know how many rows landed. Chunking makes the operation resumable
 * and the progress bar honest.
 * ============================================================================
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ChunkRequest {
  importJobId: string
  mapping: ColumnMapping
  rows: string[][]
  /** 0-based index of the first row in this chunk, for error reporting. */
  offset: number
  duplicateStrategy: DuplicateStrategy
  /** Ignored if it disagrees with the job — see below. */
  importMode?: string
  importTag?: string
  leadSource?: string
  assignedTo?: string | null
}

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('leadsImport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as ChunkRequest | null
  if (!body?.importJobId || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.rows.length > CHUNK_SIZE) {
    return NextResponse.json(
      { error: `Send at most ${CHUNK_SIZE} rows per request.` },
      { status: 400 },
    )
  }

  const supabase = createSupabaseServerClient()

  const { data: job } = await supabase
    .from('lead_import_jobs').select('*').eq('id', body.importJobId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Import job not found.' }, { status: 404 })
  if (job.status === 'cancelled') {
    return NextResponse.json({ error: 'This import was cancelled.' }, { status: 409 })
  }

  // The mode comes from the JOB, which was written when the import started —
  // not from this request. Otherwise a later chunk could quietly switch a
  // standard import into property-prospect mode and slip contactless rows past
  // the rules the operator actually agreed to.
  const importMode: ImportMode =
    IMPORT_MODES.includes(job.import_mode as ImportMode) ? (job.import_mode as ImportMode) : 'standard'

  // Map and validate this slice.
  const parsed = body.rows.map((row, index) =>
    mapRow(row, body.mapping, body.offset + index + 2),  // +2: 1-based, plus header
  )

  // Duplicate lookup is scoped to just the identifiers in THIS chunk, so it
  // stays fast whether the database holds 100 leads or 100,000.
  const emails = parsed.map(r => r.normalizedEmail).filter((e): e is string => Boolean(e))
  const phones = parsed.map(r => r.normalizedPhone).filter((p): p is string => Boolean(p))

  const addresses = parsed.map(r => r.normalizedAddress).filter((a): a is string => Boolean(a))

  const existingByEmail = new Map<string, string>()
  const existingByPhone = new Map<string, string>()
  const existingByAddress = new Map<string, string>()

  if (emails.length > 0) {
    const { data } = await supabase
      .from('leads').select('id, email').in('email', emails).is('archived_at', null)
    for (const row of data ?? []) {
      const key = normalizeEmail(row.email as string | null)
      if (key && !existingByEmail.has(key)) existingByEmail.set(key, row.id as string)
    }
  }
  if (phones.length > 0) {
    // Phones are stored as typed, so candidates are fetched and normalised here
    // rather than relying on an exact string match.
    const { data } = await supabase
      .from('leads').select('id, phone').not('phone', 'is', null).is('archived_at', null).limit(5000)
    for (const row of data ?? []) {
      const key = normalizePhone(row.phone as string | null)
      if (key && phones.includes(key) && !existingByPhone.has(key)) {
        existingByPhone.set(key, row.id as string)
      }
    }
  }

  // Only in property mode: an address is the right key for a property and the
  // wrong one for a person. Two tenants at one address are two contact leads.
  if (importMode === 'property_prospect' && addresses.length > 0) {
    for (let i = 0; i < addresses.length; i += 500) {
      const { data } = await supabase
        .from('leads').select('id, address_key')
        .in('address_key', addresses.slice(i, i + 500)).is('archived_at', null)
      for (const row of data ?? []) {
        const key = row.address_key as string | null
        if (key && !existingByAddress.has(key)) existingByAddress.set(key, row.id as string)
      }
    }
  }

  const validated = validateRows(parsed, {
    mode: importMode, existingByEmail, existingByPhone, existingByAddress,
  })

  let imported = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  let needsReview = 0
  const errorRows: { row_number: number; raw_row_json: object; error_code: string; error_message: string }[] = []
  const toInsert: Record<string, unknown>[] = []

  for (const row of validated) {
    if (row.status === 'invalid') {
      failed += 1
      errorRows.push({
        row_number: row.rowNumber,
        raw_row_json: row.values,
        error_code: row.errors[0]?.code ?? 'invalid',
        error_message: row.errors.map(e => e.message).join(' '),
      })
      continue
    }

    if (row.status === 'duplicate') {
      if (body.duplicateStrategy === 'skip') {
        skipped += 1
        errorRows.push({
          row_number: row.rowNumber,
          raw_row_json: row.values,
          error_code: 'duplicate',
          error_message: row.duplicateOf
            ? `Skipped — already in the CRM (matched on ${row.duplicateOf.matchedOn}).`
            : `Skipped — duplicate of row ${row.duplicateOfRow} in this file.`,
        })
        continue
      }

      if (body.duplicateStrategy === 'update' && row.duplicateOf) {
        // Only fills gaps. An import must never overwrite something the office
        // has already corrected by hand.
        const patch: Record<string, unknown> = {}
        for (const field of IMPORT_FIELDS) {
          const value = row.values[field]
          if (!value) continue
          const column = mapFieldToColumn(field)
          if (column) patch[column] = value
        }
        const { error } = await supabase
          .from('leads')
          .update(stripBlanks(patch))
          .eq('id', row.duplicateOf.leadId)

        if (error) {
          failed += 1
          errorRows.push({
            row_number: row.rowNumber, raw_row_json: row.values,
            error_code: 'update_failed', error_message: 'The existing lead could not be updated.',
          })
        } else {
          updated += 1
        }
        continue
      }
      // 'import_anyway' falls through to the insert below.
    }

    if (row.status === 'needs_review') needsReview += 1

    // No invented values. A property prospect with no name has NULL there, not
    // "Unknown" — a fake name is indistinguishable from a real one three months
    // later, and the whole point of this record type is that the gap is visible.
    const { first, last } = resolveName(row.values)
    const isProspect = importMode === 'property_prospect'

    const batchTag = row.values.batch_tag ?? body.importTag ?? null
    const address = row.address

    toInsert.push({
      source: row.values.source || body.leadSource || (isProspect ? 'storm_list' : 'import'),
      source_page: null,
      source_metadata: {
        import_job_id: body.importJobId,
        import_tag: batchTag,
        source_row: row.rowNumber,
        // The address exactly as it appeared in the file, kept whether or not
        // the parser managed to split it. Nothing the operator uploaded is lost.
        original_address: row.values.property_address ?? null,
        address_confidence: isProspect ? address.confidence : undefined,
        needs_review_reason: row.reviewReason ?? undefined,
      },
      record_type: isProspect ? 'property_prospect' : 'contact_lead',
      first_name: first,
      last_name: last,
      company_name: row.values.company_name ?? null,
      email: row.normalizedEmail,
      phone: row.values.phone ?? null,
      // In property mode the parsed street is stored, with city/state/zip in
      // their own columns. In standard mode the address column is left as typed.
      property_address: (isProspect ? address.street : row.values.property_address) ?? null,
      city: address.city ?? null,
      state: address.state ?? (isProspect ? null : 'FL'),
      zip: address.zip ?? null,
      stop_number: row.values.stop_number ?? null,
      import_batch_tag: batchTag,
      service_type: row.values.service_type ?? null,
      notes_summary: row.values.notes ?? null,
      assigned_to: body.assignedTo ?? null,
      pipeline_stage: isProspect ? 'needs_contact_info' : 'new',
    })
  }

  if (toInsert.length > 0) {
    const { data, error } = await supabase.from('leads').insert(toInsert).select('id')
    if (error) {
      console.error('[import] chunk insert failed', error)
      failed += toInsert.length
      errorRows.push({
        row_number: body.offset + 2,
        raw_row_json: { chunk: true, size: toInsert.length },
        error_code: 'insert_failed',
        error_message: 'This block of rows could not be saved. Nothing in it was imported.',
      })
    } else {
      imported = data?.length ?? toInsert.length
    }
  }

  if (errorRows.length > 0) {
    await supabase.from('lead_import_errors').insert(
      errorRows.map(e => ({ ...e, import_job_id: body.importJobId })),
    )
  }

  // Running totals so the UI can show progress and the record survives a
  // browser that gets closed mid-import.
  const { data: updatedJob } = await supabase
    .from('lead_import_jobs')
    .update({
      processed_rows: (job.processed_rows as number) + validated.length,
      imported_rows: (job.imported_rows as number) + imported,
      updated_rows: (job.updated_rows as number) + updated,
      skipped_rows: (job.skipped_rows as number) + skipped,
      failed_rows: (job.failed_rows as number) + failed,
      needs_review_rows: (job.needs_review_rows as number ?? 0) + needsReview,
      status: 'importing',
    })
    .eq('id', body.importJobId)
    .select('processed_rows, imported_rows, updated_rows, skipped_rows, failed_rows, needs_review_rows, total_rows')
    .single()

  return NextResponse.json({
    ok: true,
    chunk: { imported, updated, skipped, failed, needsReview, processed: validated.length },
    totals: updatedJob,
  })
}

/** Marks the job finished. Called once by the client after the last chunk. */
export async function PATCH(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('leadsImport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { importJobId?: string } | null
  if (!body?.importJobId) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const supabase = createSupabaseServerClient()
  const { data: job } = await supabase
    .from('lead_import_jobs').select('*').eq('id', body.importJobId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Import job not found.' }, { status: 404 })

  const status = (job.failed_rows as number) > 0 ? 'completed_with_errors' : 'completed'

  await supabase.from('lead_import_jobs')
    .update({ status, completed_at: new Date().toISOString() })
    .eq('id', body.importJobId)

  await logActivity(supabase, {
    action: 'lead_import.completed',
    entityType: 'lead_import',
    entityId: body.importJobId,
    actorUserId: user.id,
    metadata: {
      filename: job.original_filename,
      total: job.total_rows,
      imported: job.imported_rows,
      updated: job.updated_rows,
      skipped: job.skipped_rows,
      failed: job.failed_rows,
      needs_review: job.needs_review_rows,
      mode: job.import_mode,
    },
  })

  return NextResponse.json({ ok: true, status })
}

/**
 * Import field → database column, for the "update existing" path.
 *
 * Returns null for fields that must not be written by an update:
 *   assigned_to  — the batch-wide assignment is applied on insert only; an
 *                  import must not silently reassign somebody's existing lead.
 *   full_name /
 *   owner_name   — these are split into first/last on insert. Writing the raw
 *                  combined string into a column would corrupt the record.
 */
function mapFieldToColumn(field: string): string | null {
  if (field === 'notes') return 'notes_summary'
  if (field === 'batch_tag') return 'import_batch_tag'
  if (field === 'assigned_to' || field === 'full_name' || field === 'owner_name') return null
  return field
}

function stripBlanks(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && value !== undefined && value !== '') out[key] = value
  }
  return out
}

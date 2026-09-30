import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { CHUNK_SIZE } from '@/lib/ops/imports/leads'
import {
  mapProspectRow, validateProspectRows, type ProspectMapping,
} from '@/lib/ops/prospecting/import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ============================================================================
 * CHUNKED ROOF-PROSPECT IMPORT
 * ----------------------------------------------------------------------------
 * One slice per request, mirroring the lead importer so a large county file is
 * resumable and the progress bar is honest. Rows land in roof_prospects — NOT
 * leads. An imported county record is a prospect to be screened; it becomes a
 * CRM lead only later, at the qualification step (Phase 4). Nothing here writes
 * to `leads`, and no measurement or price is invented.
 * ============================================================================
 */

interface ChunkRequest {
  importJobId: string
  mapping: ProspectMapping
  rows: string[][]
  offset: number
  duplicateStrategy?: 'skip' | 'import_anyway'
}

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as ChunkRequest | null
  if (!body?.importJobId || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.rows.length > CHUNK_SIZE) {
    return NextResponse.json({ error: `Send at most ${CHUNK_SIZE} rows per request.` }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()
  const { data: job } = await supabase
    .from('lead_import_jobs').select('*').eq('id', body.importJobId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Import job not found.' }, { status: 404 })
  if (job.kind !== 'roof_prospect') {
    return NextResponse.json({ error: 'That job is not a prospecting import.' }, { status: 400 })
  }
  if (job.status === 'cancelled') {
    return NextResponse.json({ error: 'This import was cancelled.' }, { status: 409 })
  }

  const strategy = (job.duplicate_strategy === 'import_anyway') ? 'import_anyway' : 'skip'

  // Campaign roof-type filter is read from the job's campaign, server-side, so a
  // tampered request cannot loosen which roofs count.
  let campaignRoofTypes: string[] = []
  if (job.campaign_id) {
    const { data: campaign } = await supabase
      .from('prospecting_campaigns').select('roof_types').eq('id', job.campaign_id).maybeSingle()
    campaignRoofTypes = (campaign?.roof_types as string[] | null) ?? []
  }

  const parsed = body.rows.map((row, index) =>
    mapProspectRow(row, body.mapping, body.offset + index + 2),
  )

  // Duplicate lookup scoped to this chunk's addresses, against prospects + leads.
  const addresses = parsed.map(r => r.normalizedAddress).filter((a): a is string => Boolean(a))
  const existingProspectsByAddress = new Map<string, string>()
  const existingLeadsByAddress = new Map<string, string>()
  for (let i = 0; i < addresses.length; i += 500) {
    const slice = addresses.slice(i, i + 500)
    const [{ data: pros }, { data: leads }] = await Promise.all([
      supabase.from('roof_prospects').select('id, address_key').in('address_key', slice),
      supabase.from('leads').select('id, address_key').in('address_key', slice).is('archived_at', null),
    ])
    for (const r of pros ?? []) {
      const k = r.address_key as string | null
      if (k && !existingProspectsByAddress.has(k)) existingProspectsByAddress.set(k, r.id as string)
    }
    for (const r of leads ?? []) {
      const k = r.address_key as string | null
      if (k && !existingLeadsByAddress.has(k)) existingLeadsByAddress.set(k, r.id as string)
    }
  }

  const validated = validateProspectRows(parsed, {
    campaignRoofTypes, existingProspectsByAddress, existingLeadsByAddress,
  })

  let imported = 0
  let skipped = 0
  let failed = 0
  let needsReview = 0
  const errorRows: { row_number: number; raw_row_json: object; error_code: string; error_message: string }[] = []
  const toInsert: Record<string, unknown>[] = []

  for (const row of validated) {
    if (row.status === 'invalid') {
      failed += 1
      errorRows.push({
        row_number: row.rowNumber, raw_row_json: row.values,
        error_code: row.errors[0]?.code ?? 'invalid',
        error_message: row.errors.map(e => e.message).join(' '),
      })
      continue
    }

    if (row.status === 'duplicate' && strategy === 'skip') {
      skipped += 1
      errorRows.push({
        row_number: row.rowNumber, raw_row_json: row.values,
        error_code: 'duplicate',
        error_message: row.duplicateOf
          ? `Skipped — already a ${row.duplicateOf.source} for this property.`
          : `Skipped — duplicate of row ${row.duplicateOfRow} in this file.`,
      })
      continue
    }

    if (row.status === 'needs_review') needsReview += 1

    const address = row.address
    const v = row.values

    toInsert.push({
      campaign_id: job.campaign_id ?? null,
      import_job_id: body.importJobId,
      source_row: row.rowNumber,
      // A duplicate imported anyway is still an import; screening resolves it.
      status: row.status === 'needs_review' ? 'review_required' : 'imported',
      owner_name: v.owner_name ?? null,
      // Parsed street where available, else the raw address exactly as supplied —
      // nothing the county gave us is thrown away.
      property_address: (address.street ?? v.property_address) ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      zip: address.zip ?? null,
      mailing_address: v.mailing_address ?? null,
      mailing_city: v.mailing_city ?? null,
      mailing_state: v.mailing_state ? v.mailing_state.toUpperCase().slice(0, 2) : null,
      mailing_zip: v.mailing_zip ?? null,
      parcel_apn: v.parcel_apn ?? null,
      permit_number: v.permit_number ?? null,
      permit_date: row.permitDateIso,
      permit_type: v.permit_type ?? null,
      permit_description: v.permit_description ?? null,
      contractor: v.contractor ?? null,
      roof_type: v.roof_type ?? null,
      screening_reason: row.reviewReason ?? null,
      notes: v.notes ?? null,
      created_by: user.id,
    })
  }

  if (toInsert.length > 0) {
    const { data, error } = await supabase.from('roof_prospects').insert(toInsert).select('id')
    if (error) {
      console.error('[prospecting] chunk insert failed', error)
      failed += toInsert.length
      errorRows.push({
        row_number: body.offset + 2, raw_row_json: { chunk: true, size: toInsert.length },
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

  const { data: updatedJob } = await supabase
    .from('lead_import_jobs')
    .update({
      processed_rows: (job.processed_rows as number) + validated.length,
      imported_rows: (job.imported_rows as number) + imported,
      skipped_rows: (job.skipped_rows as number) + skipped,
      failed_rows: (job.failed_rows as number) + failed,
      needs_review_rows: (job.needs_review_rows as number ?? 0) + needsReview,
      status: 'importing',
    })
    .eq('id', body.importJobId)
    .select('processed_rows, imported_rows, skipped_rows, failed_rows, needs_review_rows, total_rows')
    .single()

  return NextResponse.json({
    ok: true,
    chunk: { imported, skipped, failed, needsReview, processed: validated.length },
    totals: updatedJob,
  })
}

/** Marks the job finished. Called once by the client after the last chunk. */
export async function PATCH(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
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
    action: 'prospecting.import_completed',
    entityType: 'lead_import',
    entityId: body.importJobId,
    actorUserId: user.id,
    metadata: {
      filename: job.original_filename, total: job.total_rows,
      imported: job.imported_rows, skipped: job.skipped_rows,
      failed: job.failed_rows, needs_review: job.needs_review_rows,
    },
  })

  return NextResponse.json({ ok: true, status })
}

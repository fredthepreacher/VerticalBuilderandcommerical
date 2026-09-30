import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PRIVATE_BUCKET } from '../supabase/admin'
import { buildStoragePath } from '../utils/files'
import { uploadGeneratedFile } from '../services/documents'

/**
 * ============================================================================
 * PROPOSAL DOCUMENT STORE (Phase 3B)
 * ----------------------------------------------------------------------------
 * A generated proposal IS the existing branded ESTIMATE PDF, kept in the same
 * private `documents` vault as every other customer document — no second store,
 * no new document type. This helper puts the rendered bytes in the bucket and
 * records a versioned `documents` row (entity_type='estimate') so the mail-batch
 * item can point at a real, downloadable, auditable document.
 *
 * Versioning reuses the vault's convention: version = one more than the newest
 * same-type document for the estimate, so a reprint/revision is a new version and
 * the prior PDF is never overwritten (spec §6/§18).
 * ============================================================================
 */

export interface StoredProposal {
  documentId: string
  storagePath: string
  version: number
}

export async function storeProposalDocument(
  admin: SupabaseClient,
  params: {
    estimateId: string
    bytes: Buffer | Uint8Array
    filename: string
    uploadedBy: string | null
    sizeBytes?: number
  },
): Promise<{ ok: true; document: StoredProposal } | { ok: false; error: string }> {
  const storagePath = buildStoragePath({
    scope: 'estimates',
    entityId: params.estimateId,
    folder: 'proposals',
    filename: params.filename,
  })

  const put = await uploadGeneratedFile(admin, {
    buffer: params.bytes,
    storagePath,
    contentType: 'application/pdf',
  })
  if (!put.ok) return { ok: false, error: put.error ?? 'The proposal PDF could not be stored.' }

  // Version = newest same-type document for this estimate + 1.
  const { data: previous } = await admin
    .from('documents')
    .select('version')
    .eq('entity_type', 'estimate')
    .eq('entity_id', params.estimateId)
    .eq('document_type', 'estimate')
    .order('version', { ascending: false })
    .limit(1)
  const version = ((previous?.[0]?.version as number | undefined) ?? 0) + 1

  const { data, error } = await admin
    .from('documents')
    .insert({
      entity_type: 'estimate',
      entity_id: params.estimateId,
      document_type: 'estimate',
      original_filename: params.filename,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: params.sizeBytes ?? (params.bytes as Buffer).length ?? null,
      version,
      description: 'Generated roofing proposal (mail batch)',
      tags: ['proposal', 'mail_batch'],
      uploaded_by: params.uploadedBy,
    })
    .select('id')
    .single()

  if (error || !data) {
    // Roll back the orphaned object so the bucket does not accumulate junk.
    await admin.storage.from(PRIVATE_BUCKET).remove([storagePath]).catch(() => {})
    return { ok: false, error: error?.message ?? 'The proposal could not be recorded.' }
  }

  return { ok: true, document: { documentId: data.id as string, storagePath, version } }
}

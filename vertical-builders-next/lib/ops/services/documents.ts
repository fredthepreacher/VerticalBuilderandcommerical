import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PRIVATE_BUCKET } from '../supabase/admin'
import type { DocumentType, EntityType } from '../types'
import { buildStoragePath, sanitizeFilename, validateUpload } from '../utils/files'
import { logActivity } from './activity'

/**
 * Private document vault.
 *
 * Nothing in the bucket is public. Uploads go through the service-role client
 * on the server after an authorisation check; downloads are short-lived signed
 * URLs minted per request. A storage path is never taken from user input.
 */

export interface StoredDocument {
  id: string
  entity_type: EntityType
  entity_id: string
  document_type: DocumentType
  original_filename: string
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  document_date: string | null
  expiration_date: string | null
  version: number
  tags: string[]
  description: string | null
  uploaded_by: string | null
  uploaded_at: string
  archived_at: string | null
}

export interface UploadDocumentInput {
  file: File
  entityType: EntityType
  entityId: string
  documentType: DocumentType
  folder?: string
  documentDate?: string | null
  expirationDate?: string | null
  description?: string | null
  tags?: string[]
  uploadedBy?: string | null
  maxBytes?: number
}

export interface UploadResult {
  ok: boolean
  document?: StoredDocument
  error?: string
}

const FOLDER_BY_TYPE: Partial<Record<DocumentType, string>> = {
  receipt: 'receipts',
  measurement_report: 'measurements',
  project_photo: 'photos',
  photo: 'photos',
  signed_estimate: 'signed',
  coi: 'insurance',
  insurance_endorsement: 'insurance',
  workers_comp_exemption: 'insurance',
  contractor_license: 'licenses',
  business_license: 'licenses',
  w9: 'w9',
  audit_package: 'exports',
}

type StorageScope = 'vendors' | 'projects' | 'contacts' | 'leads' | 'audit-exports' | 'estimates' | 'invoices'

const SCOPE_BY_ENTITY: Record<EntityType, StorageScope> = {
  vendor: 'vendors',
  project: 'projects',
  contact: 'contacts',
  lead: 'leads',
  audit: 'audit-exports',
  estimate: 'estimates',
  invoice: 'invoices',
}

/**
 * Uploads a file to the private bucket and records it in `documents`.
 * `admin` must be a service-role client (server-side only).
 */
export async function uploadDocument(
  admin: SupabaseClient,
  input: UploadDocumentInput,
): Promise<UploadResult> {
  const check = validateUpload(input.file, input.maxBytes)
  if (!check.ok) return { ok: false, error: check.error }

  const filename = sanitizeFilename(input.file.name, input.documentType)
  const storagePath = buildStoragePath({
    scope: SCOPE_BY_ENTITY[input.entityType],
    entityId: input.entityId,
    folder: input.folder ?? FOLDER_BY_TYPE[input.documentType] ?? 'documents',
    filename,
    year:
      input.documentType === 'coi' || input.documentType === 'insurance_endorsement'
        ? new Date().getUTCFullYear()
        : undefined,
  })

  const bytes = new Uint8Array(await input.file.arrayBuffer())
  const { error: uploadError } = await admin.storage
    .from(PRIVATE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: input.file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) {
    console.error('[documents] storage upload failed', uploadError)
    return { ok: false, error: 'The file could not be stored. Please try again.' }
  }

  // Version = one more than the newest same-type document for this entity.
  const { data: previous } = await admin
    .from('documents')
    .select('version')
    .eq('entity_type', input.entityType)
    .eq('entity_id', input.entityId)
    .eq('document_type', input.documentType)
    .order('version', { ascending: false })
    .limit(1)

  const version = ((previous?.[0]?.version as number | undefined) ?? 0) + 1

  const { data, error } = await admin
    .from('documents')
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      document_type: input.documentType,
      original_filename: filename,
      storage_path: storagePath,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      document_date: input.documentDate ?? null,
      expiration_date: input.expirationDate ?? null,
      description: input.description ?? null,
      tags: input.tags ?? [],
      version,
      uploaded_by: input.uploadedBy ?? null,
    })
    .select('*')
    .single()

  if (error) {
    // Roll the orphaned object back so the bucket does not accumulate junk.
    await admin.storage.from(PRIVATE_BUCKET).remove([storagePath]).catch(() => {})
    console.error('[documents] metadata insert failed', error)
    return { ok: false, error: 'The file was received but could not be recorded. Please try again.' }
  }

  return { ok: true, document: data as StoredDocument }
}

/** Uploads a server-generated buffer (audit package ZIP, exports). */
export async function uploadGeneratedFile(
  admin: SupabaseClient,
  params: {
    buffer: Uint8Array | Buffer
    storagePath: string
    contentType: string
  },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.storage
    .from(PRIVATE_BUCKET)
    .upload(params.storagePath, params.buffer, { contentType: params.contentType, upsert: false })
  if (error) {
    console.error('[documents] generated file upload failed', error)
    return { ok: false, error: 'The generated file could not be stored.' }
  }
  return { ok: true }
}

/** Mints a short-lived signed URL. Default 5 minutes — long enough to click. */
export async function createSignedUrl(
  admin: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 300,
  downloadName?: string,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(PRIVATE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds, downloadName ? { download: downloadName } : undefined)
  if (error || !data) {
    console.error('[documents] signed URL failed', error)
    return null
  }
  return data.signedUrl
}

/** Streams a stored object into memory. Used when building the audit ZIP. */
export async function downloadToBuffer(
  admin: SupabaseClient,
  storagePath: string,
): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(PRIVATE_BUCKET).download(storagePath)
  if (error || !data) {
    console.error('[documents] download failed for', storagePath, error)
    return null
  }
  return Buffer.from(await data.arrayBuffer())
}

/**
 * Documents are archived, never deleted — an audit package generated last
 * quarter must still resolve every file it referenced.
 */
export async function archiveDocument(
  supabase: SupabaseClient,
  documentId: string,
  actorUserId: string,
): Promise<void> {
  await supabase.from('documents').update({ archived_at: new Date().toISOString() }).eq('id', documentId)
  await logActivity(supabase, {
    action: 'document.archived',
    entityType: 'document',
    entityId: documentId,
    actorUserId,
  })
}

export async function listDocuments(
  supabase: SupabaseClient,
  filters: {
    entityType?: EntityType
    entityId?: string
    documentType?: DocumentType
    includeArchived?: boolean
    search?: string
    limit?: number
  } = {},
): Promise<StoredDocument[]> {
  let query = supabase.from('documents').select('*').order('uploaded_at', { ascending: false })
  if (filters.entityType) query = query.eq('entity_type', filters.entityType)
  if (filters.entityId) query = query.eq('entity_id', filters.entityId)
  if (filters.documentType) query = query.eq('document_type', filters.documentType)
  if (!filters.includeArchived) query = query.is('archived_at', null)
  if (filters.search) query = query.ilike('original_filename', `%${filters.search}%`)
  query = query.limit(filters.limit ?? 200)
  const { data } = await query
  return (data ?? []) as StoredDocument[]
}

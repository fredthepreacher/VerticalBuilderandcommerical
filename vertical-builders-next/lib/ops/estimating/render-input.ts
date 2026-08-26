import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Estimate, EstimateLineItem } from '../types'
import type { EstimatePdfInput } from './pdf'

/**
 * Assembles everything a PDF render needs in one place, so the single-estimate
 * route and the batch exporter cannot drift apart and produce two different
 * looking documents for the same estimate.
 */

const MAX_PHOTOS = 8
const MAX_PHOTO_BYTES = 4 * 1024 * 1024

export interface PreparedPdf {
  input: EstimatePdfInput
  customerName: string
}

export async function buildPdfInput(
  supabase: SupabaseClient,
  _admin: SupabaseClient,
  estimateId: string,
  opts: {
    includePhotos: boolean
    taxEnabled: boolean
    downloadPhoto: (storagePath: string) => Promise<Buffer | null>
  },
): Promise<PreparedPdf | null> {
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, estimate_line_items(*), contacts(first_name, last_name, company_name)')
    .eq('id', estimateId)
    .maybeSingle()

  if (!estimate) return null

  const contact = Array.isArray(estimate.contacts) ? estimate.contacts[0] : estimate.contacts
  const customerName =
    (contact
      ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name
      : null) ?? 'Customer'

  const lines = ((estimate.estimate_line_items ?? []) as EstimateLineItem[])
    .sort((a, b) => a.sort_order - b.sort_order)

  const photos: EstimatePdfInput['photos'] = []

  if (opts.includePhotos) {
    const { data: photoRows } = await supabase
      .from('estimate_photos')
      .select('caption, sort_order, documents(storage_path, mime_type, size_bytes)')
      .eq('estimate_id', estimateId)
      .eq('customer_visible', true)
      .order('sort_order')
      .limit(MAX_PHOTOS)

    for (const row of (photoRows ?? []) as unknown as RawPhotoRow[]) {
      const doc = Array.isArray(row.documents) ? row.documents[0] : row.documents
      if (!doc?.storage_path) continue
      // pdf-lib only embeds JPEG and PNG.
      if (doc.mime_type !== 'image/jpeg' && doc.mime_type !== 'image/png') continue
      if ((doc.size_bytes ?? 0) > MAX_PHOTO_BYTES) continue

      const bytes = await opts.downloadPhoto(doc.storage_path)
      if (!bytes) continue
      photos.push({ bytes: new Uint8Array(bytes), mimeType: doc.mime_type, caption: row.caption })
    }
  }

  const aiMeta = (estimate.ai_metadata_json ?? {}) as { assumptions?: unknown }
  const assumptions = Array.isArray(aiMeta.assumptions)
    ? (aiMeta.assumptions as unknown[]).filter((a): a is string => typeof a === 'string')
    : []

  return {
    customerName,
    input: {
      estimate: estimate as Estimate,
      lines,
      customerName,
      photos,
      assumptions,
      taxEnabled: opts.taxEnabled,
    },
  }
}

interface RawPhotoRow {
  caption: string | null
  sort_order: number
  documents:
    | { storage_path: string; mime_type: string | null; size_bytes: number | null }
    | { storage_path: string; mime_type: string | null; size_bytes: number | null }[]
    | null
}

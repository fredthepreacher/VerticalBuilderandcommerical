/**
 * File-name sanitisation and upload guards.
 * User-supplied names never reach a storage path unchanged.
 */

export const ALLOWED_UPLOAD_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Strips directories, control characters, and anything that could be used for
 * path traversal. Always returns a non-empty filename with a lowercase extension.
 */
export function sanitizeFilename(input: string, fallback = 'document'): string {
  const base = String(input ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/\\/g, '/') // windows separators
    .split('/')
    .pop()!
    .trim()

  const dot = base.lastIndexOf('.')
  let name = dot > 0 ? base.slice(0, dot) : base
  let ext = dot > 0 ? base.slice(dot + 1) : ''

  name = name
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
  ext = ext.replace(/[^A-Za-z0-9]+/g, '').toLowerCase().slice(0, 8)

  if (!name) name = fallback
  name = name.slice(0, 80)
  return ext ? `${name}.${ext}` : name
}

/** Filename safe to use as a folder name inside the audit ZIP. */
export function sanitizeFolderName(input: string, fallback = 'unnamed'): string {
  const cleaned = String(input ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60)
  return cleaned || fallback
}

export function extensionForMime(mime: string, filename: string): string {
  const known = EXT_BY_MIME[mime]
  if (known) return known
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin'
}

export function validateUpload(
  file: { size: number; type: string; name: string } | null | undefined,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
): { ok: boolean; error?: string } {
  if (!file || file.size === 0) return { ok: false, error: 'Choose a file to upload.' }
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${(maxBytes / 1048576).toFixed(0)} MB.`,
    }
  }
  if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: 'Only PDF, JPG, PNG and WebP files are accepted.' }
  }
  return { ok: true }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Builds a storage path. Every component is sanitised and the entity id must be
 * a server-supplied UUID, so a caller cannot escape the bucket prefix.
 *
 *   vendors/{vendorId}/insurance/{year}/{stamp}-{filename}
 *   vendors/{vendorId}/licenses/{stamp}-{filename}
 *   projects/{projectId}/documents/{stamp}-{filename}
 *   projects/{projectId}/photos/{stamp}-{filename}
 *   estimates/{estimateId}/photos/{stamp}-{filename}
 *   audit-exports/{auditId}/{stamp}-{filename}
 */
export function buildStoragePath(parts: {
  scope: 'vendors' | 'projects' | 'contacts' | 'leads' | 'audit-exports' | 'estimates' | 'invoices'
  entityId: string
  folder: string
  filename: string
  year?: number
}): string {
  if (!UUID_RE.test(parts.entityId)) {
    throw new Error('Refusing to build a storage path from a non-UUID id.')
  }
  const folder = sanitizeFolderName(parts.folder, 'documents').toLowerCase()
  const filename = sanitizeFilename(parts.filename)
  const stamp = Date.now().toString(36)
  const year = parts.year ? String(parts.year) : null
  const segments = [parts.scope, parts.entityId, folder, year, `${stamp}-${filename}`].filter(Boolean)
  return segments.join('/')
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

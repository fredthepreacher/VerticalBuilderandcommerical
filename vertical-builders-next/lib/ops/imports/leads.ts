/**
 * ============================================================================
 * BULK LEAD IMPORT — parsing, mapping, validation, duplicate detection
 * ----------------------------------------------------------------------------
 * The client wants to import thousands of leads at once. Two things make that
 * work reliably:
 *
 *   1. Everything in this file is PURE. Parsing, normalising and duplicate
 *      matching are decided before a single row touches the database, so a
 *      10,000-row file can be validated in the browser and previewed honestly
 *      before anyone commits to it.
 *
 *   2. The actual write is chunked (see /api/leads/import/chunk). No single
 *      serverless request ever tries to hold or insert the whole file.
 *
 * The rule that matters most: NEVER silently merge two people. A "duplicate"
 * here is an exact match on a normalised email or phone, nothing fuzzier. A
 * near-match on name and street is reported to the operator for a decision, not
 * acted on automatically.
 * ============================================================================
 */

export const IMPORT_FIELDS = [
  'first_name', 'last_name', 'company_name', 'email', 'phone',
  'property_address', 'city', 'state', 'zip',
  'service_type', 'source', 'notes', 'assigned_to',
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  company_name: 'Company',
  email: 'Email',
  phone: 'Phone',
  property_address: 'Property address',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  service_type: 'Service type',
  source: 'Source',
  notes: 'Notes',
  assigned_to: 'Assigned to (email)',
}

export const REQUIRED_FIELDS: ImportField[] = ['first_name']

/** Header spellings seen in real exports from other CRMs and spreadsheets. */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  first_name: ['first name', 'firstname', 'fname', 'first', 'given name', 'contact first name'],
  last_name: ['last name', 'lastname', 'lname', 'last', 'surname', 'family name', 'contact last name'],
  company_name: ['company', 'company name', 'business', 'business name', 'organization', 'organisation', 'account'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'emailaddress', 'primary email', 'contact email'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'mobile phone', 'cell', 'cell phone', 'home phone', 'primary phone', 'contact phone'],
  property_address: ['address', 'property address', 'street', 'street address', 'address 1', 'address line 1', 'job address', 'service address'],
  city: ['city', 'town', 'municipality'],
  state: ['state', 'st', 'province', 'region'],
  zip: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode'],
  service_type: ['service', 'service type', 'job type', 'project type', 'trade', 'work type'],
  source: ['source', 'lead source', 'origin', 'campaign', 'referral source'],
  notes: ['notes', 'note', 'comments', 'description', 'details', 'message'],
  assigned_to: ['assigned to', 'assignee', 'owner', 'sales rep', 'rep'],
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180)
// ---------------------------------------------------------------------------

/**
 * A real CSV parser, not a `split(',')`.
 *
 * Contractor lead lists routinely contain quoted commas ("Smith, John"),
 * embedded newlines in a notes column, and escaped quotes. Splitting on commas
 * silently shifts every column after the first quoted one, which corrupts
 * thousands of records in a way nobody notices until they call the wrong number.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  // Strip a UTF-8 BOM — Excel writes one and it corrupts the first header.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 }
        else inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') { inQuotes = true; continue }
    if (char === ',') { row.push(field); field = ''; continue }
    if (char === '\r') { continue }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += char
  }

  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export type ColumnMapping = Partial<Record<ImportField, number>>

/**
 * Guesses which spreadsheet column is which. The operator always sees and can
 * correct the result before importing — this only saves them the tedium.
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const normalizeHeader = (value: string) =>
    value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  const normalized = headers.map(normalizeHeader)
  const taken = new Set<number>()

  for (const field of IMPORT_FIELDS) {
    // Aliases are normalised the same way as headers, so "E-mail Address"
    // matches the "e-mail" alias instead of falling through unmapped.
    const aliases = HEADER_ALIASES[field].map(normalizeHeader)
    // Exact alias match first, so "address" does not steal "email address".
    let index = normalized.findIndex((h, i) => !taken.has(i) && aliases.includes(h))
    if (index === -1) {
      index = normalized.findIndex((h, i) => !taken.has(i) && aliases.some(a => h === a.replace(/\s+/g, '')))
    }
    if (index !== -1) { mapping[field] = index; taken.add(index) }
  }
  return mapping
}

// ---------------------------------------------------------------------------
// Normalisation — the basis of duplicate detection
// ---------------------------------------------------------------------------

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

/**
 * Digits only, with the US country code dropped so
 * "+1 (941) 555-0142", "941-555-0142" and "9415550142" are one person.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null
  let digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return null
  return digits
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export interface ParsedLeadRow {
  rowNumber: number
  values: Partial<Record<ImportField, string>>
  normalizedEmail: string | null
  normalizedPhone: string | null
}

export type RowStatus = 'valid' | 'invalid' | 'duplicate'

export interface ValidatedRow extends ParsedLeadRow {
  status: RowStatus
  errors: { code: string; message: string }[]
  warnings: string[]
  /** Set when this row matches an existing lead already in the database. */
  duplicateOf?: { leadId: string; matchedOn: 'email' | 'phone' }
  /** Set when this row matches an earlier row in the same file. */
  duplicateOfRow?: number
}

export function mapRow(row: string[], mapping: ColumnMapping, rowNumber: number): ParsedLeadRow {
  const values: Partial<Record<ImportField, string>> = {}
  for (const field of IMPORT_FIELDS) {
    const index = mapping[field]
    if (index === undefined) continue
    const raw = row[index]
    if (typeof raw === 'string' && raw.trim() !== '') {
      values[field] = raw.trim().slice(0, field === 'notes' ? 4000 : 300)
    }
  }
  return {
    rowNumber,
    values,
    normalizedEmail: normalizeEmail(values.email),
    normalizedPhone: normalizePhone(values.phone),
  }
}

export interface ValidateOptions {
  /** Normalised email/phone of leads already in the database. */
  existingByEmail?: Map<string, string>
  existingByPhone?: Map<string, string>
  duplicateStrategy?: 'skip' | 'update' | 'import_anyway'
}

/**
 * Validates a batch and marks duplicates, both against the database and
 * against earlier rows in the same file (exports frequently contain the same
 * person twice).
 */
export function validateRows(rows: ParsedLeadRow[], options: ValidateOptions = {}): ValidatedRow[] {
  const seenEmail = new Map<string, number>()
  const seenPhone = new Map<string, number>()
  const results: ValidatedRow[] = []

  for (const row of rows) {
    const errors: ValidatedRow['errors'] = []
    const warnings: string[] = []

    // A lead with no name at all cannot be worked, and a blank record in the
    // pipeline is worse than a rejected row the operator can fix.
    const hasName = Boolean(row.values.first_name || row.values.last_name || row.values.company_name)
    if (!hasName) {
      errors.push({ code: 'missing_name', message: 'No first name, last name or company — nothing to identify this lead by.' })
    }

    // No way to reach them is also fatal: an unreachable lead is not a lead.
    if (!row.normalizedEmail && !row.normalizedPhone) {
      if (row.values.email) {
        errors.push({ code: 'invalid_email', message: `"${row.values.email}" is not a valid email address, and no valid phone was supplied.` })
      } else if (row.values.phone) {
        errors.push({ code: 'invalid_phone', message: `"${row.values.phone}" is not a valid 10-digit US phone number, and no valid email was supplied.` })
      } else {
        errors.push({ code: 'no_contact', message: 'No email or phone — this lead cannot be contacted.' })
      }
    } else {
      // One bad channel is a warning, not a rejection, if the other works.
      if (row.values.email && !row.normalizedEmail) {
        warnings.push(`Email "${row.values.email}" is not valid and was dropped.`)
      }
      if (row.values.phone && !row.normalizedPhone) {
        warnings.push(`Phone "${row.values.phone}" is not a valid 10-digit US number and was dropped.`)
      }
    }

    if (row.values.state && row.values.state.trim().length > 2) {
      warnings.push(`State "${row.values.state}" is longer than two letters and was truncated.`)
      row.values.state = row.values.state.trim().slice(0, 2).toUpperCase()
    }

    let status: RowStatus = errors.length > 0 ? 'invalid' : 'valid'
    let duplicateOf: ValidatedRow['duplicateOf']
    let duplicateOfRow: number | undefined

    if (status === 'valid') {
      // Database duplicates. Email is checked first: it is the stronger signal,
      // since households and businesses share phone numbers.
      if (row.normalizedEmail && options.existingByEmail?.has(row.normalizedEmail)) {
        duplicateOf = { leadId: options.existingByEmail.get(row.normalizedEmail)!, matchedOn: 'email' }
      } else if (row.normalizedPhone && options.existingByPhone?.has(row.normalizedPhone)) {
        duplicateOf = { leadId: options.existingByPhone.get(row.normalizedPhone)!, matchedOn: 'phone' }
      }

      // Within-file duplicates.
      if (!duplicateOf) {
        if (row.normalizedEmail && seenEmail.has(row.normalizedEmail)) {
          duplicateOfRow = seenEmail.get(row.normalizedEmail)
        } else if (row.normalizedPhone && seenPhone.has(row.normalizedPhone)) {
          duplicateOfRow = seenPhone.get(row.normalizedPhone)
        }
      }

      if (duplicateOf || duplicateOfRow !== undefined) status = 'duplicate'

      if (row.normalizedEmail && !seenEmail.has(row.normalizedEmail)) {
        seenEmail.set(row.normalizedEmail, row.rowNumber)
      }
      if (row.normalizedPhone && !seenPhone.has(row.normalizedPhone)) {
        seenPhone.set(row.normalizedPhone, row.rowNumber)
      }
    }

    results.push({ ...row, status, errors, warnings, duplicateOf, duplicateOfRow })
  }

  return results
}

export interface ValidationSummary {
  total: number
  valid: number
  invalid: number
  duplicates: number
  withWarnings: number
}

export function summarize(rows: ValidatedRow[]): ValidationSummary {
  return {
    total: rows.length,
    valid: rows.filter(r => r.status === 'valid').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    duplicates: rows.filter(r => r.status === 'duplicate').length,
    withWarnings: rows.filter(r => r.warnings.length > 0).length,
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * 400 rows per request. Comfortably inside a serverless function's time and
 * memory budget with room for a slow database, while keeping a 10,000-row
 * import to 25 requests rather than 100.
 */
export const CHUNK_SIZE = 400

export function chunk<T>(items: T[], size: number = CHUNK_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Error report
// ---------------------------------------------------------------------------

export function buildErrorCsv(rows: ValidatedRow[], headers: string[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    let s = String(value)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const problems = rows.filter(r => r.status !== 'valid' || r.warnings.length > 0)
  const lines = [
    ['Row', 'Outcome', 'Reason', ...headers].map(escape).join(','),
  ]

  for (const row of problems) {
    const reason =
      row.errors.length > 0
        ? row.errors.map(e => e.message).join(' ')
        : row.duplicateOf
          ? `Duplicate of an existing lead (matched on ${row.duplicateOf.matchedOn}).`
          : row.duplicateOfRow !== undefined
            ? `Duplicate of row ${row.duplicateOfRow} in this file.`
            : row.warnings.join(' ')

    lines.push([
      row.rowNumber,
      row.status === 'valid' ? 'Imported with warnings' : row.status === 'duplicate' ? 'Duplicate' : 'Rejected',
      reason,
      ...IMPORT_FIELDS.map(f => row.values[f] ?? ''),
    ].map(escape).join(','))
  }

  return '﻿' + lines.join('\r\n') + '\r\n'
}

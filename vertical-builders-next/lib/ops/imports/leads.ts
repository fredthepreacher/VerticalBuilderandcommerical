import { normalizeAddress, parseAddress, type ParsedAddress } from './address'

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
 * here is an exact match on a normalised email, phone or property address —
 * nothing fuzzier. A near-match on a name is reported to the operator for a
 * decision, never acted on automatically.
 *
 * TWO IMPORT MODES
 * ----------------
 *   'standard'          The original behaviour, unchanged. A row needs a name
 *                       and a way to reach the person.
 *
 *   'property_prospect' For storm lists, canvassing routes and door-knocking
 *                       sheets, which arrive as addresses and nothing else. A
 *                       row needs a usable property address; name, phone and
 *                       email are genuinely optional.
 *
 * The modes are separate on purpose. Loosening the standard rules to let
 * address-only rows through would mean a genuinely broken contact list imports
 * silently as junk — which is the failure the original rules existed to catch.
 * ============================================================================
 */

export const IMPORT_FIELDS = [
  'first_name', 'last_name', 'full_name', 'owner_name', 'company_name', 'email', 'phone',
  'property_address', 'city', 'state', 'zip',
  'stop_number', 'batch_tag',
  'service_type', 'source', 'notes', 'assigned_to',
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name (split automatically)',
  owner_name: 'Property owner',
  company_name: 'Company',
  email: 'Email',
  phone: 'Phone',
  property_address: 'Property address / street',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  stop_number: 'Stop / route number',
  batch_tag: 'Campaign / batch',
  service_type: 'Service type',
  source: 'Source',
  notes: 'Notes',
  assigned_to: 'Assigned to (email)',
}

export const REQUIRED_FIELDS: ImportField[] = ['first_name']

export const IMPORT_MODES = ['standard', 'property_prospect'] as const
export type ImportMode = (typeof IMPORT_MODES)[number]

export const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  standard: 'Standard leads',
  property_prospect: 'Property prospects',
}

export const IMPORT_MODE_HINTS: Record<ImportMode, string> = {
  standard: 'Best for lists with customer names, phone numbers and email addresses.',
  property_prospect: 'Best for storm lists, canvassing routes, door-knocking sheets and property-address lists.',
}

/** Fields that count as a way of reaching or identifying a person. */
const NAME_FIELDS: ImportField[] = ['first_name', 'last_name', 'full_name', 'owner_name', 'company_name']

/** Header spellings seen in real exports from other CRMs and spreadsheets. */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  first_name: ['first name', 'firstname', 'fname', 'first', 'given name', 'contact first name'],
  last_name: ['last name', 'lastname', 'lname', 'last', 'surname', 'family name', 'contact last name'],
  full_name: ['full name', 'fullname', 'name', 'contact name', 'contact', 'customer name', 'lead name'],
  owner_name: ['owner', 'owner name', 'property owner', 'homeowner', 'resident', 'occupant'],
  company_name: ['company', 'company name', 'business', 'business name', 'organization', 'organisation', 'account'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'emailaddress', 'primary email', 'contact email'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'mobile phone', 'cell', 'cell phone', 'home phone', 'primary phone', 'contact phone'],
  property_address: [
    'address', 'property address', 'street', 'street address', 'address 1', 'address line 1',
    'job address', 'service address', 'site address', 'full address', 'location', 'addr',
  ],
  city: ['city', 'town', 'municipality'],
  state: ['state', 'st', 'province', 'region'],
  zip: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode'],
  service_type: ['service', 'service type', 'job type', 'project type', 'trade', 'work type'],
  stop_number: ['stop', 'stop number', 'stop #', 'route', 'route number', 'route #', 'sequence', 'seq', 'order'],
  batch_tag: ['batch', 'batch tag', 'campaign', 'campaign name', 'list', 'list name', 'group'],
  source: ['source', 'lead source', 'origin', 'referral source', 'channel'],
  notes: ['notes', 'note', 'comments', 'description', 'details', 'message'],
  assigned_to: ['assigned to', 'assignee', 'assigned', 'sales rep', 'rep', 'salesperson', 'record owner'],
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
  /**
   * The address column decomposed into street/city/state/zip, with an explicit
   * confidence. Explicit columns in the file always win over anything parsed
   * out of a combined address — the operator's mapping is better evidence than
   * a regex.
   */
  address: ParsedAddress
  /** Duplicate key for the property, matching the DB's generated address_key. */
  normalizedAddress: string | null
}

export type RowStatus = 'valid' | 'invalid' | 'duplicate' | 'needs_review'

export type DuplicateMatch = 'email' | 'phone' | 'address'

export interface ValidatedRow extends ParsedLeadRow {
  status: RowStatus
  errors: { code: string; message: string }[]
  warnings: string[]
  /** Set when this row matches an existing lead already in the database. */
  duplicateOf?: { leadId: string; matchedOn: DuplicateMatch }
  /** Set when this row matches an earlier row in the same file. */
  duplicateOfRow?: number
  /** Set on a needs_review row: what a person should check after importing. */
  reviewReason?: string
}

/** needs_review rows DO import — flagged, not discarded. */
export function willImport(row: ValidatedRow, strategy: DuplicateStrategyLike): boolean {
  if (row.status === 'invalid') return false
  if (row.status === 'duplicate') return strategy !== 'skip'
  return true
}

type DuplicateStrategyLike = 'skip' | 'update' | 'import_anyway'

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

  // A single "ADDRESS" column is the common shape on canvassing lists, so it is
  // decomposed. Wherever the file also has its own city/state/zip column, that
  // column wins — the operator mapped it deliberately, and a parser guessing at
  // where a street ends is the weaker evidence of the two.
  const parsed = parseAddress(values.property_address)
  const address: ParsedAddress = {
    ...parsed,
    city: values.city ?? parsed.city,
    state: (values.state ?? parsed.state)?.toUpperCase().slice(0, 2) ?? null,
    zip: values.zip ?? parsed.zip,
  }

  return {
    rowNumber,
    values,
    normalizedEmail: normalizeEmail(values.email),
    normalizedPhone: normalizePhone(values.phone),
    address,
    normalizedAddress: normalizeAddress(address.street ?? values.property_address, address.zip),
  }
}

/**
 * A name for the row, from whichever column the operator mapped.
 * `full_name` and `owner_name` are single columns that get split; they feed the
 * same first/last pair rather than a parallel set of fields, so a prospect that
 * later gains an owner name is the same record, not a second one.
 */
export function resolveName(values: Partial<Record<ImportField, string>>): { first: string | null; last: string | null } {
  if (values.first_name) return { first: values.first_name, last: values.last_name ?? null }
  const combined = values.full_name ?? values.owner_name
  if (combined) {
    const parts = combined.trim().split(/\s+/)
    if (parts.length === 1) return { first: parts[0], last: null }
    return { first: parts[0], last: parts.slice(1).join(' ') }
  }
  if (values.last_name) return { first: null, last: values.last_name }
  return { first: null, last: null }
}

export interface ValidateOptions {
  /** Which rules apply. Defaults to the original standard-lead behaviour. */
  mode?: ImportMode
  /** Normalised email/phone/address of leads already in the database. */
  existingByEmail?: Map<string, string>
  existingByPhone?: Map<string, string>
  existingByAddress?: Map<string, string>
  duplicateStrategy?: 'skip' | 'update' | 'import_anyway'
}

/**
 * Validates a batch and marks duplicates, both against the database and
 * against earlier rows in the same file (exports frequently contain the same
 * person, or the same house, twice).
 *
 * The two modes diverge only in what makes a row usable. Everything after that
 * — normalisation, duplicate matching, warnings — is shared, so a property
 * prospect cannot end up under looser duplicate rules than a contact lead.
 */
export function validateRows(rows: ParsedLeadRow[], options: ValidateOptions = {}): ValidatedRow[] {
  const mode: ImportMode = options.mode ?? 'standard'
  const seenEmail = new Map<string, number>()
  const seenPhone = new Map<string, number>()
  const seenAddress = new Map<string, number>()
  const results: ValidatedRow[] = []

  for (const row of rows) {
    const errors: ValidatedRow['errors'] = []
    const warnings: string[] = []
    let reviewReason: string | undefined

    const { first, last } = resolveName(row.values)
    const hasName = Boolean(first || last || row.values.company_name)

    if (mode === 'property_prospect') {
      // The whole point of this mode: an address is enough. Name, phone and
      // email are genuinely optional, and their absence is not a warning
      // either — a storm list is not defective for being a storm list.
      if (!row.values.property_address) {
        errors.push({ code: 'no_address', message: 'No property address — there is nothing to knock on.' })
      } else if (!row.normalizedAddress) {
        errors.push({
          code: 'unusable_address',
          message: `"${row.values.property_address}" does not contain anything usable as an address.`,
        })
      } else if (row.address.confidence === 'low') {
        // Recoverable, so it imports and gets flagged rather than being thrown
        // away. A canvasser can still find the house.
        reviewReason = row.address.note ?? 'The address could not be split into street, city and state.'
      } else if (row.address.confidence === 'partial') {
        reviewReason = row.address.note ?? 'Part of the address could not be identified.'
      }
    } else {
      // Standard mode — unchanged rules.
      if (!hasName) {
        errors.push({ code: 'missing_name', message: 'No first name, last name or company — nothing to identify this lead by.' })
      }

      if (!row.normalizedEmail && !row.normalizedPhone) {
        if (row.values.email) {
          errors.push({ code: 'invalid_email', message: `"${row.values.email}" is not a valid email address, and no valid phone was supplied.` })
        } else if (row.values.phone) {
          errors.push({ code: 'invalid_phone', message: `"${row.values.phone}" is not a valid 10-digit US phone number, and no valid email was supplied.` })
        } else {
          errors.push({ code: 'no_contact', message: 'No email or phone — this lead cannot be contacted.' })
        }
      }
    }

    // One bad channel is a warning, not a rejection, in either mode.
    if (row.values.email && !row.normalizedEmail) {
      warnings.push(`Email "${row.values.email}" is not valid and was dropped.`)
    }
    if (row.values.phone && !row.normalizedPhone) {
      warnings.push(`Phone "${row.values.phone}" is not a valid 10-digit US number and was dropped.`)
    }

    if (row.values.state && row.values.state.trim().length > 2) {
      warnings.push(`State "${row.values.state}" is longer than two letters and was truncated.`)
      row.values.state = row.values.state.trim().slice(0, 2).toUpperCase()
    }

    let status: RowStatus = errors.length > 0
      ? 'invalid'
      : reviewReason
        ? 'needs_review'
        : 'valid'

    let duplicateOf: ValidatedRow['duplicateOf']
    let duplicateOfRow: number | undefined

    if (status !== 'invalid') {
      // Database duplicates, strongest signal first. Email beats phone because
      // households and businesses share numbers; address comes last because it
      // is the right key for a property and the wrong one for a person — two
      // tenants at one address are two leads.
      if (row.normalizedEmail && options.existingByEmail?.has(row.normalizedEmail)) {
        duplicateOf = { leadId: options.existingByEmail.get(row.normalizedEmail)!, matchedOn: 'email' }
      } else if (row.normalizedPhone && options.existingByPhone?.has(row.normalizedPhone)) {
        duplicateOf = { leadId: options.existingByPhone.get(row.normalizedPhone)!, matchedOn: 'phone' }
      } else if (
        mode === 'property_prospect'
        && row.normalizedAddress
        && options.existingByAddress?.has(row.normalizedAddress)
      ) {
        duplicateOf = { leadId: options.existingByAddress.get(row.normalizedAddress)!, matchedOn: 'address' }
      }

      // Within-file duplicates.
      if (!duplicateOf) {
        if (row.normalizedEmail && seenEmail.has(row.normalizedEmail)) {
          duplicateOfRow = seenEmail.get(row.normalizedEmail)
        } else if (row.normalizedPhone && seenPhone.has(row.normalizedPhone)) {
          duplicateOfRow = seenPhone.get(row.normalizedPhone)
        } else if (
          mode === 'property_prospect'
          && row.normalizedAddress
          && seenAddress.has(row.normalizedAddress)
        ) {
          duplicateOfRow = seenAddress.get(row.normalizedAddress)
        }
      }

      if (duplicateOf || duplicateOfRow !== undefined) status = 'duplicate'

      if (row.normalizedEmail && !seenEmail.has(row.normalizedEmail)) {
        seenEmail.set(row.normalizedEmail, row.rowNumber)
      }
      if (row.normalizedPhone && !seenPhone.has(row.normalizedPhone)) {
        seenPhone.set(row.normalizedPhone, row.rowNumber)
      }
      if (row.normalizedAddress && !seenAddress.has(row.normalizedAddress)) {
        seenAddress.set(row.normalizedAddress, row.rowNumber)
      }
    }

    results.push({ ...row, status, errors, warnings, duplicateOf, duplicateOfRow, reviewReason })
  }

  return results
}

/**
 * Reads a file's headers and its first rows and decides whether it looks like a
 * property list. Used only to SUGGEST a mode — the operator always confirms.
 */
export function suggestImportMode(mapping: ColumnMapping, rows: string[][]): ImportMode {
  const hasContactColumn = mapping.email !== undefined || mapping.phone !== undefined
  const hasNameColumn = NAME_FIELDS.some(f => mapping[f] !== undefined)
  const hasAddressColumn = mapping.property_address !== undefined

  if (!hasAddressColumn) return 'standard'
  if (hasContactColumn || hasNameColumn) {
    // A column being mapped is not the same as it holding anything. A list with
    // an empty Phone column is still an address list.
    const sample = rows.slice(0, 50)
    const anyContact = sample.some(row =>
      [mapping.email, mapping.phone, ...NAME_FIELDS.map(f => mapping[f])]
        .some(i => i !== undefined && typeof row[i] === 'string' && row[i].trim() !== ''))
    if (anyContact) return 'standard'
  }
  return 'property_prospect'
}

export interface ValidationSummary {
  total: number
  valid: number
  invalid: number
  duplicates: number
  needsReview: number
  withWarnings: number
}

export function summarize(rows: ValidatedRow[]): ValidationSummary {
  return {
    total: rows.length,
    valid: rows.filter(r => r.status === 'valid').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    duplicates: rows.filter(r => r.status === 'duplicate').length,
    // Imported and flagged — counted apart from `valid` so the operator knows
    // how many to look at, not so they can be mistaken for rejections.
    needsReview: rows.filter(r => r.status === 'needs_review').length,
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
            : [row.reviewReason, ...row.warnings].filter(Boolean).join(' ')

    const outcome =
      row.status === 'invalid' ? 'Rejected'
      : row.status === 'duplicate' ? 'Duplicate'
      : row.status === 'needs_review' ? 'Imported — needs review'
      : 'Imported with warnings'

    lines.push([
      row.rowNumber,
      outcome,
      reason,
      ...IMPORT_FIELDS.map(f => row.values[f] ?? ''),
    ].map(escape).join(','))
  }

  return '﻿' + lines.join('\r\n') + '\r\n'
}

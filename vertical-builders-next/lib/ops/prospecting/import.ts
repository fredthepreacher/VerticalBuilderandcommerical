import { normalizeAddress, parseAddress, type ParsedAddress } from '../imports/address'
import { normalizeEmail, normalizePhone } from '../imports/leads'

/**
 * ============================================================================
 * ROOF PROSPECTING IMPORT — parsing, mapping, validation, duplicate detection
 * ----------------------------------------------------------------------------
 * County roofing-permit spreadsheets go through here. It deliberately REUSES the
 * proven lead-import primitives — parseCsv, the address parser/normaliser, the
 * email/phone normalisers, chunk — so a prospect and an existing lead for the
 * same house produce the same address_key and can be matched. The lead importer
 * itself is untouched; this is a parallel field set and validator, because a
 * prospect carries permit/parcel/mailing data a lead never had and lands in a
 * different table (roof_prospects), never becoming a CRM lead on its own.
 *
 * Everything here is PURE: a whole file is validated and previewed in the
 * browser before a single row is written, and the write is chunked and
 * resumable exactly like the lead import.
 * ============================================================================
 */

export const PROSPECT_FIELDS = [
  'owner_name',
  'property_address', 'city', 'state', 'zip',
  'mailing_address', 'mailing_city', 'mailing_state', 'mailing_zip',
  'parcel_apn', 'permit_number', 'permit_date', 'permit_type', 'permit_description',
  'contractor', 'roof_type', 'phone', 'email', 'notes',
] as const
export type ProspectField = (typeof PROSPECT_FIELDS)[number]

export const PROSPECT_FIELD_LABELS: Record<ProspectField, string> = {
  owner_name: 'Owner name',
  property_address: 'Property address / street',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  mailing_address: 'Mailing address (if different)',
  mailing_city: 'Mailing city',
  mailing_state: 'Mailing state',
  mailing_zip: 'Mailing ZIP',
  parcel_apn: 'Parcel / APN',
  permit_number: 'Permit number',
  permit_date: 'Permit date',
  permit_type: 'Permit type',
  permit_description: 'Permit description',
  contractor: 'Contractor',
  roof_type: 'Roof type',
  phone: 'Phone',
  email: 'Email',
  notes: 'Notes',
}

/** Header spellings seen in real county permit exports. */
const HEADER_ALIASES: Record<ProspectField, string[]> = {
  owner_name: ['owner', 'owner name', 'property owner', 'homeowner', 'name', 'owner 1', 'owner1'],
  property_address: [
    'address', 'property address', 'site address', 'situs', 'situs address', 'location address',
    'street', 'street address', 'job address', 'location', 'property location', 'full address',
  ],
  city: ['city', 'property city', 'situs city', 'town'],
  state: ['state', 'property state', 'situs state', 'st'],
  zip: ['zip', 'zip code', 'zipcode', 'postal code', 'property zip', 'situs zip'],
  mailing_address: ['mailing address', 'mail address', 'owner address', 'owner mailing address', 'mailing', 'mail addr'],
  mailing_city: ['mailing city', 'mail city', 'owner city'],
  mailing_state: ['mailing state', 'mail state', 'owner state'],
  mailing_zip: ['mailing zip', 'mail zip', 'owner zip', 'mailing zip code'],
  parcel_apn: ['parcel', 'parcel id', 'parcel number', 'apn', 'parcel/apn', 'folio', 'folio number', 'account', 'account number', 'strap'],
  permit_number: ['permit', 'permit number', 'permit no', 'permit #', 'permit id', 'record number', 'case number'],
  permit_date: ['permit date', 'issue date', 'issued date', 'date issued', 'application date', 'date', 'final date', 'co date'],
  permit_type: ['permit type', 'type', 'work type', 'permit class', 'subtype', 'work class'],
  permit_description: ['description', 'permit description', 'work description', 'scope', 'details', 'work'],
  contractor: ['contractor', 'contractor name', 'company', 'business name', 'qualifier', 'builder'],
  roof_type: ['roof type', 'roof', 'roof material', 'roofing type', 'material', 'roof cover', 'roofing material'],
  phone: ['phone', 'phone number', 'owner phone', 'telephone', 'contact phone', 'mobile'],
  email: ['email', 'e-mail', 'owner email', 'email address', 'contact email'],
  notes: ['notes', 'note', 'comments', 'remarks'],
}

const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

export type ProspectMapping = Partial<Record<ProspectField, number>>

/** Guesses which spreadsheet column is which; the operator confirms/corrects it. */
export function suggestProspectMapping(headers: string[]): ProspectMapping {
  const mapping: ProspectMapping = {}
  const normalized = headers.map(normalizeHeader)
  const taken = new Set<number>()
  for (const field of PROSPECT_FIELDS) {
    const aliases = HEADER_ALIASES[field].map(normalizeHeader)
    let index = normalized.findIndex((h, i) => !taken.has(i) && aliases.includes(h))
    if (index === -1) {
      index = normalized.findIndex((h, i) => !taken.has(i) && aliases.some(a => h === a.replace(/\s+/g, '')))
    }
    if (index !== -1) { mapping[field] = index; taken.add(index) }
  }
  return mapping
}

/** Roof-type text → a coarse canonical family, for campaign filtering. */
export function classifyRoofType(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (/shingle|asphalt|comp\b|composition|arch/.test(s)) return 'shingle'
  if (/tile|clay|concrete tile/.test(s)) return 'tile'
  if (/metal|standing seam|steel|aluminum/.test(s)) return 'metal'
  if (/flat|tpo|epdm|modified|bitumen|built.?up|bur\b|membrane/.test(s)) return 'flat'
  if (/slate/.test(s)) return 'slate'
  if (/shake|wood/.test(s)) return 'wood'
  return 'other'
}

/** Best-effort date normalisation to YYYY-MM-DD; returns null if unparseable. */
export function normalizePermitDate(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // ISO already.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  // M/D/Y or M-D-Y (2- or 4-digit year).
  const m = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
    const dt = new Date(iso)
    if (!Number.isNaN(dt.getTime())) return iso
  }
  const dt = new Date(trimmed)
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

export interface ParsedProspectRow {
  rowNumber: number
  values: Partial<Record<ProspectField, string>>
  /** Property address decomposed; explicit columns win over parsed parts. */
  address: ParsedAddress
  normalizedAddress: string | null
  normalizedEmail: string | null
  normalizedPhone: string | null
  roofFamily: string | null
  permitDateIso: string | null
}

export function mapProspectRow(row: string[], mapping: ProspectMapping, rowNumber: number): ParsedProspectRow {
  const values: Partial<Record<ProspectField, string>> = {}
  for (const field of PROSPECT_FIELDS) {
    const index = mapping[field]
    if (index === undefined) continue
    const raw = row[index]
    if (typeof raw === 'string' && raw.trim() !== '') {
      values[field] = raw.trim().slice(0, field === 'permit_description' || field === 'notes' ? 4000 : 300)
    }
  }

  const parsed = parseAddress(values.property_address)
  const address: ParsedAddress = {
    ...parsed,
    city: values.city ?? parsed.city,
    state: (values.state ?? parsed.state)?.toUpperCase().slice(0, 2) ?? null,
    zip: values.zip ?? parsed.zip,
  }

  // County exports keep street, city, state and ZIP in separate columns. When
  // the operator has mapped those, the address is fully known regardless of what
  // the street-only parser made of it — so it is high confidence, not a guess.
  const street = address.street ?? values.property_address
  if (street && address.city && address.state) {
    address.confidence = 'high'
    address.note = null
  }

  return {
    rowNumber,
    values,
    address,
    normalizedAddress: normalizeAddress(address.street ?? values.property_address, address.zip),
    normalizedEmail: normalizeEmail(values.email),
    normalizedPhone: normalizePhone(values.phone),
    roofFamily: classifyRoofType(values.roof_type),
    permitDateIso: normalizePermitDate(values.permit_date),
  }
}

export type ProspectRowStatus = 'valid' | 'invalid' | 'duplicate' | 'needs_review'

export interface ValidatedProspectRow extends ParsedProspectRow {
  status: ProspectRowStatus
  errors: { code: string; message: string }[]
  warnings: string[]
  /** Matched an existing prospect or lead in the database. */
  duplicateOf?: { id: string; source: 'prospect' | 'lead' }
  /** Matched an earlier row in this same file. */
  duplicateOfRow?: number
  reviewReason?: string
}

export interface ValidateProspectOptions {
  /** Roof-type families this campaign accepts. Empty = accept all. */
  campaignRoofTypes?: string[]
  /** normalized address_key → id, for prospects already imported. */
  existingProspectsByAddress?: Map<string, string>
  /** normalized address_key → id, for leads/customers already in the CRM. */
  existingLeadsByAddress?: Map<string, string>
}

/**
 * Validates a batch. A usable PROPERTY ADDRESS is the only hard requirement —
 * permit lists arrive with wildly varying columns and we must not silently drop
 * a house because a permit number was blank. Duplicates (against prospects, then
 * leads, then earlier rows in the file) are MARKED, never deleted. A roof type
 * outside the campaign filter is flagged for review, not auto-rejected — the
 * screening step (Phase 3) owns the reject decision.
 */
export function validateProspectRows(
  rows: ParsedProspectRow[],
  options: ValidateProspectOptions = {},
): ValidatedProspectRow[] {
  const roofFilter = (options.campaignRoofTypes ?? []).filter(Boolean)
  const seenAddress = new Map<string, number>()
  const results: ValidatedProspectRow[] = []

  for (const row of rows) {
    const errors: ValidatedProspectRow['errors'] = []
    const warnings: string[] = []
    const reviewReasons: string[] = []

    if (!row.values.property_address) {
      errors.push({ code: 'no_address', message: 'No property address — there is nothing to prospect.' })
    } else if (!row.normalizedAddress) {
      errors.push({ code: 'unusable_address', message: `"${row.values.property_address}" is not a usable address.` })
    } else if (row.address.confidence === 'low') {
      reviewReasons.push(row.address.note ?? 'The address could not be split into street, city and state.')
    } else if (row.address.confidence === 'partial') {
      reviewReasons.push(row.address.note ?? 'Part of the address could not be identified.')
    }

    if (row.values.state && row.values.state.trim().length > 2) {
      warnings.push(`State "${row.values.state}" was truncated to two letters.`)
      row.values.state = row.values.state.trim().slice(0, 2).toUpperCase()
    }
    if (row.values.email && !row.normalizedEmail) {
      warnings.push(`Email "${row.values.email}" is not valid and was dropped.`)
    }
    if (row.values.phone && !row.normalizedPhone) {
      warnings.push(`Phone "${row.values.phone}" is not a valid 10-digit US number and was dropped.`)
    }

    // Roof-type filter: flag, do not reject. Keeps metal/tile visible instead of
    // silently qualifying them, and lets a human confirm before disqualifying.
    if (roofFilter.length > 0 && errors.length === 0) {
      if (!row.roofFamily) {
        reviewReasons.push('Roof type is unknown — confirm before qualifying.')
      } else if (!roofFilter.includes(row.roofFamily)) {
        reviewReasons.push(`Roof type "${row.values.roof_type}" is outside this campaign's filter (${roofFilter.join(', ')}).`)
      }
    }

    let status: ProspectRowStatus =
      errors.length > 0 ? 'invalid' : reviewReasons.length > 0 ? 'needs_review' : 'valid'

    let duplicateOf: ValidatedProspectRow['duplicateOf']
    let duplicateOfRow: number | undefined

    if (status !== 'invalid' && row.normalizedAddress) {
      if (options.existingProspectsByAddress?.has(row.normalizedAddress)) {
        duplicateOf = { id: options.existingProspectsByAddress.get(row.normalizedAddress)!, source: 'prospect' }
      } else if (options.existingLeadsByAddress?.has(row.normalizedAddress)) {
        duplicateOf = { id: options.existingLeadsByAddress.get(row.normalizedAddress)!, source: 'lead' }
      } else if (seenAddress.has(row.normalizedAddress)) {
        duplicateOfRow = seenAddress.get(row.normalizedAddress)
      }
      if (duplicateOf || duplicateOfRow !== undefined) status = 'duplicate'
      if (!seenAddress.has(row.normalizedAddress)) seenAddress.set(row.normalizedAddress, row.rowNumber)
    }

    results.push({
      ...row, status, errors, warnings,
      duplicateOf, duplicateOfRow,
      reviewReason: reviewReasons.length ? reviewReasons.join(' ') : undefined,
    })
  }

  return results
}

export interface ProspectValidationSummary {
  total: number
  valid: number
  invalid: number
  duplicates: number
  needsReview: number
  withWarnings: number
}

export function summarizeProspects(rows: ValidatedProspectRow[]): ProspectValidationSummary {
  return {
    total: rows.length,
    valid: rows.filter(r => r.status === 'valid').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    duplicates: rows.filter(r => r.status === 'duplicate').length,
    needsReview: rows.filter(r => r.status === 'needs_review').length,
    withWarnings: rows.filter(r => r.warnings.length > 0).length,
  }
}

/** needs_review rows DO import — flagged, not discarded. Duplicates depend on strategy. */
export function willImportProspect(row: ValidatedProspectRow, strategy: 'skip' | 'import_anyway'): boolean {
  if (row.status === 'invalid') return false
  if (row.status === 'duplicate') return strategy !== 'skip'
  return true
}

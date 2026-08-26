import { SERVICE_TYPES } from '../constants'

/**
 * ============================================================================
 * BUILT-IN LEAD EXTRACTION — labelled fields and unambiguous patterns only
 * ----------------------------------------------------------------------------
 * This is NOT a replacement for the AI lead structurer, and the UI says so.
 *
 * It handles the case the office actually hits most often: notes that were
 * typed with some structure, or pasted from an email, where the fields are
 * either labelled ("Phone: 941-555-0100") or unmistakable (a valid email, a
 * ten-digit US number, a five-digit ZIP).
 *
 * What it deliberately does NOT do is guess. An unlabelled "spoke to dave about
 * the roof at his mothers place" yields a service type and nothing else,
 * because a wrong first name on a customer record is worse than a blank one.
 * Everything unrecognised stays in Notes, so nothing is lost.
 * ============================================================================
 */

export interface ParsedLeadFields {
  first_name?: string
  last_name?: string
  company_name?: string
  email?: string
  phone?: string
  property_address?: string
  city?: string
  state?: string
  zip?: string
  service_type?: string
  timeline?: string
  project_description?: string
}

export interface ParsedLead {
  fields: ParsedLeadFields
  /** Which fields came from an explicit label vs. a pattern — shown in the UI. */
  found: string[]
  /** Honest statements about what was not attempted. */
  notes: string[]
}

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
])

/** Label → field. Only these labels are honoured; anything else stays in notes. */
const LABELS: { pattern: RegExp; field: keyof ParsedLeadFields }[] = [
  { pattern: /^(?:name|contact|customer|client)\s*[:\-]\s*(.+)$/i, field: 'first_name' },
  { pattern: /^(?:company|business|org(?:anisation|anization)?)\s*[:\-]\s*(.+)$/i, field: 'company_name' },
  { pattern: /^(?:phone|tel|telephone|mobile|cell|phone number)\s*[:\-]\s*(.+)$/i, field: 'phone' },
  { pattern: /^(?:e-?mail|email address)\s*[:\-]\s*(.+)$/i, field: 'email' },
  { pattern: /^(?:address|property|property address|site|job address)\s*[:\-]\s*(.+)$/i, field: 'property_address' },
  { pattern: /^(?:city|town)\s*[:\-]\s*(.+)$/i, field: 'city' },
  { pattern: /^(?:state)\s*[:\-]\s*(.+)$/i, field: 'state' },
  { pattern: /^(?:zip|zipcode|zip code|postcode|postal code)\s*[:\-]\s*(.+)$/i, field: 'zip' },
  { pattern: /^(?:service|work|job type|project type|scope)\s*[:\-]\s*(.+)$/i, field: 'service_type' },
  { pattern: /^(?:timeline|timing|when|urgency)\s*[:\-]\s*(.+)$/i, field: 'timeline' },
  { pattern: /^(?:notes?|details?|description|message)\s*[:\-]\s*(.+)$/i, field: 'project_description' },
]

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const ZIP = /\b(\d{5})(?:-\d{4})?\b/

/**
 * Ten or eleven digits, in any of the usual American shapes.
 *
 * Guarded on BOTH sides against a longer run of digits. Without the leading
 * guard, a sixteen-digit string — a card number, say — matches from its sixth
 * character and yields a plausible-looking phone number that belongs to nobody.
 */
export function extractUsPhone(text: string): string | null {
  const match = text.match(
    /(?<![\d])(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?![\d])/,
  )
  if (!match) return null
  return `(${match[1]}) ${match[2]}-${match[3]}`
}

/** A service type from the fixed taxonomy, or null. Never invents a category. */
export function matchServiceType(text: string): string | null {
  const lower = text.toLowerCase()
  const keywords: [string, string][] = [
    ['roof', 'Roofing'],
    ['shingle', 'Roofing'],
    ['storm', 'Storm Damage / Emergency Tarp'],
    ['tarp', 'Storm Damage / Emergency Tarp'],
    ['hurricane', 'Storm Damage / Emergency Tarp'],
    ['ceiling', 'Ceiling / Interior Repair'],
    ['drywall', 'Ceiling / Interior Repair'],
    ['water damage', 'Water Damage Repair'],
    ['leak', 'Water Damage Repair'],
    ['flood', 'Water Damage Repair'],
    ['kitchen', 'Kitchen & Bath Remodel'],
    ['bathroom', 'Kitchen & Bath Remodel'],
    ['bath remodel', 'Kitchen & Bath Remodel'],
    ['pool', 'Pool / Lanai / Outdoor Living'],
    ['lanai', 'Pool / Lanai / Outdoor Living'],
    ['screen enclosure', 'Pool / Lanai / Outdoor Living'],
    ['paver', 'Pavers & Concrete'],
    ['concrete', 'Pavers & Concrete'],
    ['driveway', 'Pavers & Concrete'],
    ['impact window', 'Impact Windows & Doors'],
    ['window', 'Impact Windows & Doors'],
    ['door', 'Impact Windows & Doors'],
    ['new construction', 'New Construction'],
    ['new build', 'New Construction'],
    ['addition', 'Additions / ADU'],
    ['adu', 'Additions / ADU'],
    ['permit', 'Permitting Help'],
    ['commercial', 'Commercial'],
  ]
  // An exact taxonomy name wins over a keyword.
  for (const service of SERVICE_TYPES) {
    if (lower.includes(service.toLowerCase())) return service
  }
  for (const [keyword, service] of keywords) {
    if (lower.includes(keyword)) return service
  }
  return null
}

export function parseLeadNotes(input: string): ParsedLead {
  const raw = (input ?? '').slice(0, 8_000)
  const fields: ParsedLeadFields = {}
  const found: string[] = []
  const notes: string[] = []
  const leftovers: string[] = []

  const record = (field: keyof ParsedLeadFields, value: string, label: string) => {
    const trimmed = value.trim()
    if (!trimmed || fields[field]) return
    fields[field] = trimmed
    if (!found.includes(label)) found.push(label)
  }

  // ---- Pass 1: labelled lines ------------------------------------------------
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    let matched = false
    for (const { pattern, field } of LABELS) {
      const m = text.match(pattern)
      if (!m) continue
      matched = true
      const value = m[1].trim()
      if (field === 'first_name') {
        // "Name: John Smith" — first token is the first name, the rest the last.
        // A single token becomes the first name only; nothing is invented.
        const parts = value.split(/\s+/).filter(Boolean)
        record('first_name', parts[0] ?? '', 'name')
        if (parts.length > 1) record('last_name', parts.slice(1).join(' '), 'name')
      } else if (field === 'state') {
        const abbr = value.trim().toUpperCase().slice(0, 2)
        if (US_STATES.has(abbr)) record('state', abbr, 'state')
        else leftovers.push(text)
      } else if (field === 'zip') {
        const zip = value.match(ZIP)
        if (zip) record('zip', zip[1], 'ZIP')
        else leftovers.push(text)
      } else if (field === 'phone') {
        const phone = extractUsPhone(value)
        if (phone) record('phone', phone, 'phone')
        else leftovers.push(text)
      } else if (field === 'email') {
        const email = value.match(EMAIL)
        if (email) record('email', email[0].toLowerCase(), 'email')
        else leftovers.push(text)
      } else if (field === 'service_type') {
        const service = matchServiceType(value)
        if (service) record('service_type', service, 'service')
        else leftovers.push(text)
      } else {
        record(field, value, field.replace(/_/g, ' '))
      }
      break
    }
    if (!matched) leftovers.push(text)
  }

  // ---- Pass 2: unambiguous patterns anywhere in the text ---------------------
  if (!fields.email) {
    const email = raw.match(EMAIL)
    if (email) record('email', email[0].toLowerCase(), 'email')
  }
  if (!fields.phone) {
    const phone = extractUsPhone(raw)
    if (phone) record('phone', phone, 'phone')
  }
  if (!fields.zip) {
    // Only trust a five-digit number that is not part of a longer number or an
    // address line already captured — a bare 34293 in prose is almost always a ZIP.
    const zip = raw.match(/(?:^|[\s,])(\d{5})(?:-\d{4})?(?=$|[\s,.])/m)
    if (zip) record('zip', zip[1], 'ZIP')
  }
  if (!fields.state) {
    const abbr = raw.match(/(?:^|[\s,])([A-Z]{2})(?=[\s,]|\s*\d{5}|$)/)
    if (abbr && US_STATES.has(abbr[1])) record('state', abbr[1], 'state')
  }
  if (!fields.service_type) {
    const service = matchServiceType(raw)
    if (service) record('service_type', service, 'service')
  }

  // ---- Everything else stays in the description ------------------------------
  const remainder = leftovers.join('\n').trim()
  if (remainder) {
    fields.project_description = fields.project_description
      ? `${fields.project_description}\n\n${remainder}`
      : remainder
  }

  // ---- Honesty about what was not attempted ----------------------------------
  if (!fields.first_name) {
    notes.push('No name was extracted — built-in extraction only reads a labelled "Name:" line rather than guessing one from prose.')
  }
  if (!fields.property_address && !fields.city) {
    notes.push('No address or city was extracted — those need a labelled line, because a wrong address on a job is expensive.')
  }
  if (found.length === 0) {
    notes.push('Nothing could be extracted from these notes. Everything has been left in the description for you to sort out by hand.')
  }

  return { fields, found, notes }
}

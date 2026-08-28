/**
 * ============================================================================
 * ADDRESS PARSING AND NORMALISATION
 * ----------------------------------------------------------------------------
 * Two jobs, deliberately separate:
 *
 *   parseAddress()     splits "4386 Sibley Bay St, Port Charlotte, FL 33980"
 *                      into street / city / state / zip, and says how confident
 *                      it is. Low confidence flags the row for review; it never
 *                      throws the row away, because a canvasser can still knock
 *                      on a door the parser could not decompose.
 *
 *   normalizeAddress() produces the canonical form used ONLY for duplicate
 *                      detection. Never displayed.
 *
 * `normalizeAddress` must produce byte-identical output to the SQL function
 * `public.normalize_address` in migration 0012. The browser uses this one to
 * flag within-file duplicates before anything is sent; the database uses the
 * SQL one for the generated `address_key` column that cross-file duplicates are
 * matched against. If the two drifted apart, duplicates would be missed
 * silently — so `tests/property-prospects.test.ts` pins the algorithm and the
 * migration harness checks the two implementations against the same fixtures.
 * ============================================================================
 */

/**
 * Ordered exactly as the SQL function applies them. Word-boundary matching, so
 * "northeast" is not caught by the "north" rule regardless of order — but the
 * order is kept identical anyway so the two implementations stay readable side
 * by side.
 */
const CANONICAL: [RegExp, string][] = [
  [/\bstreet\b/g, 'st'],
  [/\bavenue\b/g, 'ave'],
  [/\bav\b/g, 'ave'],
  [/\broad\b/g, 'rd'],
  [/\bdrive\b/g, 'dr'],
  [/\blane\b/g, 'ln'],
  [/\bboulevard\b/g, 'blvd'],
  [/\bcourt\b/g, 'ct'],
  [/\bcircle\b/g, 'cir'],
  [/\bplace\b/g, 'pl'],
  [/\bterrace\b/g, 'ter'],
  [/\bterr\b/g, 'ter'],
  [/\bparkway\b/g, 'pkwy'],
  [/\bhighway\b/g, 'hwy'],
  [/\btrail\b/g, 'trl'],
  [/\bsquare\b/g, 'sq'],
  [/\bpoint\b/g, 'pt'],
  [/\bridge\b/g, 'rdg'],
  [/\bcrossing\b/g, 'xing'],
  [/\bnortheast\b/g, 'ne'],
  [/\bnorthwest\b/g, 'nw'],
  [/\bsoutheast\b/g, 'se'],
  [/\bsouthwest\b/g, 'sw'],
  [/\bnorth\b/g, 'n'],
  [/\bsouth\b/g, 's'],
  [/\beast\b/g, 'e'],
  [/\bwest\b/g, 'w'],
  [/\bapartment\b/g, 'apt'],
  [/\bsuite\b/g, 'ste'],
  [/\bnumber\b/g, 'no'],
]

/**
 * The duplicate key for a property. Null when there is no usable address.
 *
 * Mirrors `public.normalize_address(street, postal)` exactly.
 */
export function normalizeAddress(
  street: string | null | undefined,
  postal?: string | null,
): string | null {
  let value = (street ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')

  for (const [pattern, replacement] of CANONICAL) {
    value = value.replace(pattern, replacement)
  }

  const canonical = value.replace(/\s+/g, ' ').trim()
  // No street means no key. A ZIP on its own is not a duplicate signal: two
  // different houses in 33980 are two different houses.
  if (canonical === '') return null

  const zipDigits = (postal ?? '').replace(/\D/g, '').slice(0, 5)
  return zipDigits ? `${canonical} ${zipDigits}` : canonical
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type AddressConfidence = 'high' | 'partial' | 'low'

export interface ParsedAddress {
  /** House number and street, e.g. "4386 Sibley Bay St". */
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  confidence: AddressConfidence
  /** Human-readable reason, shown in the preview when confidence is not high. */
  note: string | null
}

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU',
])

const ZIP = /\b(\d{5})(?:-\d{4})?\b/

const empty = (note: string): ParsedAddress =>
  ({ street: null, city: null, state: null, zip: null, confidence: 'low', note })

/**
 * Best-effort decomposition of a single-column address.
 *
 * Handles the shapes that actually turn up in canvassing exports:
 *   "4386 Sibley Bay St, Port Charlotte, FL 33980"
 *   "4386 Sibley Bay St, Port Charlotte, FL"
 *   "4386 Sibley Bay St Port Charlotte FL 33980"     (no commas)
 *   "123 Main St Apt 4, Venice, FL 34293"
 *   "4386 Sibley Bay St"                              (street only)
 *
 * Never throws. Anything it cannot decompose comes back as the whole string in
 * `street` with a low confidence and a note — the address is preserved, and the
 * operator is told which rows to look at.
 */
export function parseAddress(input: string | null | undefined): ParsedAddress {
  const raw = (input ?? '').trim().replace(/\s+/g, ' ')
  if (!raw) return empty('No address.')
  if (raw.length > 300) return { ...empty('Address is unusually long and was not split.'), street: raw.slice(0, 300) }

  // A usable street address starts with a house number, or a recognisable
  // unit-first form. Without one this is not an address, it is a note.
  const looksLikeStreet = /\d/.test(raw) && /[a-z]/i.test(raw)

  let working = raw
  let zip: string | null = null
  let state: string | null = null
  let city: string | null = null

  // ZIP, from the end.
  const zipMatch = working.match(new RegExp(`${ZIP.source}\\s*$`))
  if (zipMatch) {
    zip = zipMatch[1]
    working = working.slice(0, zipMatch.index).trim().replace(/[,\s]+$/, '')
  }

  // State: two letters at the end, or "FL" preceded by a comma.
  const stateMatch = working.match(/(?:^|[,\s])([A-Za-z]{2})\s*$/)
  if (stateMatch && US_STATES.has(stateMatch[1].toUpperCase())) {
    state = stateMatch[1].toUpperCase()
    working = working.slice(0, stateMatch.index).trim().replace(/[,\s]+$/, '')
  }

  const parts = working.split(',').map(p => p.trim()).filter(Boolean)

  if (parts.length >= 2) {
    // The last comma-separated part is the city; everything before is street.
    city = parts[parts.length - 1]
    working = parts.slice(0, -1).join(', ')
  } else if (state && parts.length === 1) {
    // No comma but we found a state — the words before it are probably
    // "<street> <city>". Splitting that reliably is not possible without a
    // gazetteer, so the street is kept whole and the row is flagged instead of
    // guessing where the street ends.
    working = parts[0]
  } else {
    working = parts[0] ?? working
  }

  const street = working.trim().replace(/[,\s]+$/, '') || null

  // A city that is obviously not one — a lone number, or a unit designator
  // that got separated by a comma — is dropped rather than stored.
  if (city && (/^\d+$/.test(city) || /^(apt|ste|suite|unit|#)/i.test(city))) {
    if (street) return finish(`${street}, ${city}`, null, state, zip, looksLikeStreet, raw)
    city = null
  }

  return finish(street, city, state, zip, looksLikeStreet, raw)
}

function finish(
  street: string | null,
  city: string | null,
  state: string | null,
  zip: string | null,
  looksLikeStreet: boolean,
  raw: string,
): ParsedAddress {
  if (!street) return empty('Nothing that looks like a street address.')

  if (!looksLikeStreet) {
    return {
      street: raw, city: null, state: null, zip: null,
      confidence: 'low',
      note: 'No house number — this may not be a street address. Kept as typed for review.',
    }
  }

  if (city && state) {
    return { street, city, state, zip, confidence: 'high', note: null }
  }

  if (state && !city) {
    return {
      street, city: null, state, zip,
      confidence: 'partial',
      note: 'City could not be separated from the street. The full address is preserved.',
    }
  }

  if (city && !state) {
    return {
      street, city, state: null, zip,
      confidence: 'partial',
      note: 'No state found in the address.',
    }
  }

  return {
    street, city: null, state: null, zip,
    confidence: 'partial',
    note: 'Only a street was found — no city or state.',
  }
}

/** How the address is shown when a prospect has no contact name yet. */
export function formatAddressLine(parts: {
  property_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}): string {
  const tail = [parts.city, [parts.state, parts.zip].filter(Boolean).join(' ')]
    .filter(v => v && String(v).trim())
    .join(', ')
  return [parts.property_address, tail].filter(v => v && String(v).trim()).join(', ')
}

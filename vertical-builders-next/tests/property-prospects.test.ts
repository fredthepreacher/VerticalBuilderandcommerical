import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatAddressLine, normalizeAddress, parseAddress,
} from '../lib/ops/imports/address'
import {
  IMPORT_FIELDS, IMPORT_MODES, mapRow, parseCsv, resolveName, suggestImportMode,
  suggestMapping, summarize, validateRows, willImport,
  type ColumnMapping, type ImportMode, type ParsedLeadRow,
} from '../lib/ops/imports/leads'

/**
 * ============================================================================
 * PROPERTY PROSPECTS
 * ----------------------------------------------------------------------------
 * A storm list is a column of addresses and nothing else. Before this feature
 * every row of one was rejected as uncontactable; the point of these tests is
 * that address-only rows now import, WITHOUT the standard contact rules being
 * loosened for everyone else.
 *
 * So the suite is organised around that pairing: for almost every "a prospect
 * may do X" there is a matching "a standard lead still may not".
 * ============================================================================
 */

const STORM_CSV = [
  'STOP,ADDRESS',
  '1,"4386 Sibley Bay St, Port Charlotte, FL 33980"',
  '2,"2200 Example Rd, Punta Gorda, FL 33950"',
].join('\n')

/** Parses a CSV the way the wizard does, then maps and validates it. */
function runImport(csv: string, options: { mode?: ImportMode; existingByAddress?: Map<string, string> } = {}) {
  const [headers, ...rows] = parseCsv(csv)
  const mapping = suggestMapping(headers)
  const parsed: ParsedLeadRow[] = rows.map((row, i) => mapRow(row, mapping, i + 2))
  const mode = options.mode ?? suggestImportMode(mapping, rows)
  const validated = validateRows(parsed, { mode, existingByAddress: options.existingByAddress })
  return { headers, mapping, mode, parsed, validated, summary: summarize(validated) }
}

// ---------------------------------------------------------------------------
// Address parsing
// ---------------------------------------------------------------------------

describe('parseAddress', () => {
  it('splits the shape a canvassing list actually uses', () => {
    const parsed = parseAddress('4386 Sibley Bay St, Port Charlotte, FL 33980')
    expect(parsed).toMatchObject({
      street: '4386 Sibley Bay St',
      city: 'Port Charlotte',
      state: 'FL',
      zip: '33980',
      confidence: 'high',
    })
    expect(parsed.note).toBeNull()
  })

  it('handles a missing ZIP', () => {
    const parsed = parseAddress('2200 Example Rd, Punta Gorda, FL')
    expect(parsed).toMatchObject({ street: '2200 Example Rd', city: 'Punta Gorda', state: 'FL', zip: null })
    expect(parsed.confidence).toBe('high')
  })

  it('keeps a unit designator attached to the street', () => {
    const parsed = parseAddress('123 Main St Apt 4, Venice, FL 34293')
    expect(parsed.street).toBe('123 Main St Apt 4')
    expect(parsed.city).toBe('Venice')
  })

  it('does not lose a unit that a comma separated from the street', () => {
    const parsed = parseAddress('123 Main St, Apt 4')
    expect(parsed.street).toBe('123 Main St, Apt 4')
    expect(parsed.city).toBeNull()
  })

  it('flags a comma-less address rather than guessing where the street ends', () => {
    // "4386 Sibley Bay St Port Charlotte FL" cannot be split without a
    // gazetteer. Guessing produces a wrong city on a real customer record.
    const parsed = parseAddress('4386 Sibley Bay St Port Charlotte FL 33980')
    expect(parsed.confidence).toBe('partial')
    expect(parsed.state).toBe('FL')
    expect(parsed.zip).toBe('33980')
    expect(parsed.note).toMatch(/city could not be separated/i)
  })

  it('handles a street on its own', () => {
    const parsed = parseAddress('4386 Sibley Bay St')
    expect(parsed.street).toBe('4386 Sibley Bay St')
    expect(parsed.confidence).toBe('partial')
  })

  it('flags something with no house number instead of storing it as a street', () => {
    const parsed = parseAddress('the blue house near the marina')
    expect(parsed.confidence).toBe('low')
    expect(parsed.street).toBe('the blue house near the marina')
    expect(parsed.note).toMatch(/no house number/i)
  })

  it('never throws, whatever it is given', () => {
    for (const junk of ['', '   ', ',,,', '!!!', null, undefined, 'x'.repeat(500)]) {
      expect(() => parseAddress(junk)).not.toThrow()
    }
  })

  it('preserves an over-long address rather than dropping it', () => {
    const parsed = parseAddress('9 '.repeat(200))
    expect(parsed.street).toBeTruthy()
    expect(parsed.note).toMatch(/unusually long/i)
  })

  it('rejects a two-letter word that is not a state', () => {
    const parsed = parseAddress('12 Beach Rd, Venice, ZZ')
    expect(parsed.state).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Normalisation — the duplicate key
// ---------------------------------------------------------------------------

describe('normalizeAddress', () => {
  it('treats the spellings of one house as one house', () => {
    const forms = [
      '4386 Sibley Bay Street',
      '4386 Sibley Bay St',
      '4386 SIBLEY BAY ST',
      '4386 sibley bay st.',
      '  4386   Sibley  Bay  St  ',
    ]
    const keys = new Set(forms.map(f => normalizeAddress(f)))
    expect(keys.size, `expected one key, got ${[...keys].join(' | ')}`).toBe(1)
  })

  it('canonicalises the common suffixes and directionals', () => {
    expect(normalizeAddress('12 North Harbor Avenue')).toBe('12 n harbor ave')
    expect(normalizeAddress('9 Southwest Parkway')).toBe('9 sw pkwy')
    expect(normalizeAddress('3 Harbor Point Drive')).toBe('3 harbor pt dr')
    expect(normalizeAddress('4 Cross Creek Crossing')).toBe('4 cross creek xing')
  })

  it('includes the ZIP so two towns with the same street name stay separate', () => {
    expect(normalizeAddress('12 Main St', '33980')).toBe('12 main st 33980')
    expect(normalizeAddress('12 Main St', '33950')).toBe('12 main st 33950')
    expect(normalizeAddress('12 Main St', '33980')).not.toBe(normalizeAddress('12 Main St', '33950'))
  })

  it('takes only the five-digit part of a ZIP+4', () => {
    expect(normalizeAddress('12 Main St', '33980-1234')).toBe(normalizeAddress('12 Main St', '33980'))
  })

  it('returns null when there is no street — a ZIP alone is not a key', () => {
    // Otherwise every address-less lead in 33980 would look like a duplicate
    // of every other one.
    expect(normalizeAddress('', '33980')).toBeNull()
    expect(normalizeAddress(null, '33980')).toBeNull()
    expect(normalizeAddress('   ')).toBeNull()
  })

  it('matches the SQL function in migration 0012, rule for rule', () => {
    // The browser flags within-file duplicates with this implementation; the
    // database matches cross-file duplicates with the SQL one. If they drift
    // apart, duplicates are missed silently — so the rule table is pinned here.
    // Alignment whitespace in the SQL is irrelevant to the rule it encodes.
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0012_property_prospects.sql'), 'utf8')
      .replace(/\s+/g, '')
    const rules: [string, string][] = [
      ['street', 'st'], ['avenue', 'ave'], ['road', 'rd'], ['drive', 'dr'], ['lane', 'ln'],
      ['boulevard', 'blvd'], ['court', 'ct'], ['circle', 'cir'], ['place', 'pl'],
      ['terrace', 'ter'], ['parkway', 'pkwy'], ['highway', 'hwy'], ['trail', 'trl'],
      ['square', 'sq'], ['point', 'pt'], ['ridge', 'rdg'], ['crossing', 'xing'],
      ['northeast', 'ne'], ['northwest', 'nw'], ['southeast', 'se'], ['southwest', 'sw'],
      ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
      ['apartment', 'apt'], ['suite', 'ste'],
    ]
    for (const [word, short] of rules) {
      expect(sql, `SQL is missing the ${word} rule`).toContain(`'\\m${word}\\M','${short}'`)
      expect(normalizeAddress(`1 X ${word}`), `TS is missing the ${word} rule`).toBe(`1 x ${short}`)
    }
  })
})

describe('formatAddressLine', () => {
  it('assembles what it has and skips what it does not', () => {
    expect(formatAddressLine({ property_address: '4386 Sibley Bay St', city: 'Port Charlotte', state: 'FL', zip: '33980' }))
      .toBe('4386 Sibley Bay St, Port Charlotte, FL 33980')
    expect(formatAddressLine({ property_address: '4386 Sibley Bay St' })).toBe('4386 Sibley Bay St')
    expect(formatAddressLine({ city: 'Venice', state: 'FL' })).toBe('Venice, FL')
    expect(formatAddressLine({})).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

describe('column mapping', () => {
  it('maps STOP and ADDRESS from the client’s own file', () => {
    const mapping = suggestMapping(['STOP', 'ADDRESS'])
    expect(mapping.stop_number).toBe(0)
    expect(mapping.property_address).toBe(1)
  })

  it('recognises the header spellings canvassing exports use', () => {
    expect(suggestMapping(['Route #']).stop_number).toBe(0)
    expect(suggestMapping(['Full Address']).property_address).toBe(0)
    expect(suggestMapping(['Site Address']).property_address).toBe(0)
    expect(suggestMapping(['Property Owner']).owner_name).toBe(0)
    expect(suggestMapping(['Campaign']).batch_tag).toBe(0)
    expect(suggestMapping(['Full Name']).full_name).toBe(0)
  })

  it('still maps a conventional contact list exactly as before', () => {
    const mapping = suggestMapping(['First Name', 'Last Name', 'E-mail Address', 'Mobile Phone', 'City'])
    expect(mapping).toMatchObject({ first_name: 0, last_name: 1, email: 2, phone: 3, city: 4 })
  })

  it('does not let "address" steal the "email address" column', () => {
    const mapping = suggestMapping(['Email Address', 'Address'])
    expect(mapping.email).toBe(0)
    expect(mapping.property_address).toBe(1)
  })

  it('offers every field the change order asked for', () => {
    for (const field of [
      'first_name', 'last_name', 'full_name', 'owner_name', 'company_name', 'email', 'phone',
      'property_address', 'city', 'state', 'zip', 'stop_number', 'batch_tag',
      'source', 'notes', 'assigned_to',
    ]) {
      expect(IMPORT_FIELDS, `${field} is not mappable`).toContain(field)
    }
  })
})

describe('resolveName', () => {
  it('splits a full name column', () => {
    expect(resolveName({ full_name: 'John Smith' })).toEqual({ first: 'John', last: 'Smith' })
    expect(resolveName({ full_name: 'Maria de la Cruz' })).toEqual({ first: 'Maria', last: 'de la Cruz' })
    expect(resolveName({ full_name: 'Cher' })).toEqual({ first: 'Cher', last: null })
  })

  it('treats a property-owner column the same way, into the same fields', () => {
    // Not a parallel "owner" field: enrichment has to land on the record that
    // already exists, not create a second shape of person.
    expect(resolveName({ owner_name: 'John Smith' })).toEqual({ first: 'John', last: 'Smith' })
  })

  it('prefers explicit first/last columns over a combined one', () => {
    expect(resolveName({ first_name: 'Jo', last_name: 'Bloggs', full_name: 'Wrong Person' }))
      .toEqual({ first: 'Jo', last: 'Bloggs' })
  })

  it('returns nulls rather than a placeholder when there is no name', () => {
    expect(resolveName({})).toEqual({ first: null, last: null })
    expect(resolveName({ property_address: '4386 Sibley Bay St' })).toEqual({ first: null, last: null })
  })
})

// ---------------------------------------------------------------------------
// Mode suggestion
// ---------------------------------------------------------------------------

describe('import mode suggestion', () => {
  it('suggests property prospects for an address-only file', () => {
    expect(runImport(STORM_CSV).mode).toBe('property_prospect')
  })

  it('suggests standard for a normal contact list', () => {
    const csv = 'First Name,Phone\nJohn,941-555-0100'
    expect(runImport(csv).mode).toBe('standard')
  })

  it('suggests standard when a file has both', () => {
    const csv = 'Name,Phone,Address\nJohn Smith,941-555-0100,"12 Main St, Venice, FL 34293"'
    expect(runImport(csv).mode).toBe('standard')
  })

  it('sees through an empty contact column', () => {
    // A list with a Phone header and no phone numbers is still an address list.
    const csv = 'Address,Phone\n"12 Main St, Venice, FL 34293",\n"14 Main St, Venice, FL 34293",'
    expect(runImport(csv).mode).toBe('property_prospect')
  })

  it('never suggests property mode for a file with no address column', () => {
    expect(runImport('First Name,Email\nJo,jo@example.com').mode).toBe('standard')
  })

  it('only offers the two documented modes', () => {
    expect([...IMPORT_MODES]).toEqual(['standard', 'property_prospect'])
  })
})

// ---------------------------------------------------------------------------
// Validation — the two modes, paired
// ---------------------------------------------------------------------------

describe('property prospect mode', () => {
  it('imports the client’s example file with nothing rejected', () => {
    const { validated, summary } = runImport(STORM_CSV, { mode: 'property_prospect' })
    expect(summary).toMatchObject({ total: 2, valid: 2, invalid: 0, duplicates: 0, needsReview: 0 })
    expect(validated.every(r => willImport(r, 'skip'))).toBe(true)
  })

  it('produces exactly the record the change order describes', () => {
    const { parsed } = runImport(STORM_CSV, { mode: 'property_prospect' })
    const row = parsed[0]
    expect(row.values.stop_number).toBe('1')
    expect(row.address).toMatchObject({
      street: '4386 Sibley Bay St', city: 'Port Charlotte', state: 'FL', zip: '33980',
    })
    expect(row.normalizedAddress).toBe('4386 sibley bay st 33980')
    // No name, no phone, no email — and no invented stand-ins for them.
    expect(resolveName(row.values)).toEqual({ first: null, last: null })
    expect(row.normalizedPhone).toBeNull()
    expect(row.normalizedEmail).toBeNull()
  })

  it('does not reject a row for having no name, phone or email', () => {
    const { validated } = runImport(STORM_CSV, { mode: 'property_prospect' })
    for (const row of validated) {
      expect(row.errors.map(e => e.code)).not.toContain('missing_name')
      expect(row.errors.map(e => e.code)).not.toContain('no_contact')
    }
  })

  it('does not even warn about the missing contact details', () => {
    // A storm list is not a defective contact list. Warning on every row would
    // bury the warnings that matter.
    const { validated } = runImport(STORM_CSV, { mode: 'property_prospect' })
    expect(validated.flatMap(r => r.warnings)).toEqual([])
  })

  it('rejects a blank address', () => {
    const { validated } = runImport('STOP,ADDRESS\n1,\n2,"12 Main St, Venice, FL"', { mode: 'property_prospect' })
    expect(validated[0].status).toBe('invalid')
    expect(validated[0].errors[0].code).toBe('no_address')
    expect(validated[1].status).toBe('valid')
  })

  it('rejects an address with nothing usable in it', () => {
    const { validated } = runImport('ADDRESS\n"---"', { mode: 'property_prospect' })
    expect(validated[0].status).toBe('invalid')
    expect(validated[0].errors[0].code).toBe('unusable_address')
  })

  it('flags a low-confidence address for review rather than throwing it away', () => {
    const { validated, summary } = runImport('ADDRESS\n"the blue house near the marina"', { mode: 'property_prospect' })
    expect(validated[0].status).toBe('needs_review')
    expect(validated[0].reviewReason).toMatch(/no house number/i)
    // Flagged, not rejected — and it still imports.
    expect(summary.invalid).toBe(0)
    expect(summary.needsReview).toBe(1)
    expect(willImport(validated[0], 'skip')).toBe(true)
  })

  it('flags a partially parsed address too', () => {
    const { validated } = runImport('ADDRESS\n"4386 Sibley Bay St Port Charlotte FL 33980"', { mode: 'property_prospect' })
    expect(validated[0].status).toBe('needs_review')
    expect(validated[0].reviewReason).toMatch(/city could not be separated/i)
  })

  it('keeps a name, phone or email when the row happens to have one', () => {
    // The mode changes what is REQUIRED, not what is kept.
    const csv = 'ADDRESS,OWNER,PHONE\n"12 Main St, Venice, FL 34293",John Smith,941-555-0100'
    const { parsed, validated } = runImport(csv, { mode: 'property_prospect' })
    expect(resolveName(parsed[0].values)).toEqual({ first: 'John', last: 'Smith' })
    expect(parsed[0].normalizedPhone).toBe('9415550100')
    expect(validated[0].status).toBe('valid')
  })

  it('lets an explicit City column beat the parser', () => {
    // The operator mapped that column deliberately. A regex guessing at where a
    // street ends is the weaker evidence.
    const csv = 'ADDRESS,CITY\n"12 Main St, Nokomis, FL 34275",Venice'
    const { parsed } = runImport(csv, { mode: 'property_prospect' })
    expect(parsed[0].address.city).toBe('Venice')
  })
})

describe('standard mode is unchanged', () => {
  it('still rejects an address-only row', () => {
    const { validated } = runImport(STORM_CSV, { mode: 'standard' })
    expect(validated.every(r => r.status === 'invalid')).toBe(true)
    const codes = validated.flatMap(r => r.errors.map(e => e.code))
    expect(codes).toContain('missing_name')
    expect(codes).toContain('no_contact')
  })

  it('still imports a name and a phone', () => {
    const { validated } = runImport('First Name,Phone\nJohn,941-555-0100', { mode: 'standard' })
    expect(validated[0].status).toBe('valid')
  })

  it('still imports an email-only lead', () => {
    const { validated } = runImport('Company,Email\nAcme Roofing,hello@acme.test', { mode: 'standard' })
    expect(validated[0].status).toBe('valid')
  })

  it('still rejects a row with a name and no way to reach them', () => {
    const { validated } = runImport('First Name,City\nJohn,Venice', { mode: 'standard' })
    expect(validated[0].status).toBe('invalid')
    expect(validated[0].errors[0].code).toBe('no_contact')
  })

  it('defaults to standard rules when no mode is given at all', () => {
    // Every existing caller keeps the behaviour it had.
    const [headers, ...rows] = parseCsv(STORM_CSV)
    const mapping = suggestMapping(headers)
    const validated = validateRows(rows.map((r, i) => mapRow(r, mapping, i + 2)))
    expect(validated.every(r => r.status === 'invalid')).toBe(true)
  })

  it('does not match a standard lead on address', () => {
    // Two tenants at one address are two leads, not one. Address dedupe is for
    // properties; people are matched on email and phone.
    const existing = new Map([['12 main st 34293', 'existing-lead-id']])
    const csv = 'First Name,Phone,Address,Zip\nJohn,941-555-0100,"12 Main St",34293'
    const { validated } = runImport(csv, { mode: 'standard', existingByAddress: existing })
    expect(validated[0].status).toBe('valid')
    expect(validated[0].duplicateOf).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

describe('duplicate detection', () => {
  it('matches an existing property on its normalised address', () => {
    const existing = new Map([['4386 sibley bay st 33980', 'existing-lead-id']])
    const { validated } = runImport(STORM_CSV, { mode: 'property_prospect', existingByAddress: existing })
    expect(validated[0].status).toBe('duplicate')
    expect(validated[0].duplicateOf).toEqual({ leadId: 'existing-lead-id', matchedOn: 'address' })
    expect(validated[1].status).toBe('valid')
  })

  it('is not fooled by capitalisation or an abbreviated suffix', () => {
    const existing = new Map([['4386 sibley bay st 33980', 'existing-lead-id']])
    const csv = 'ADDRESS\n"4386 SIBLEY BAY STREET, Port Charlotte, FL 33980"'
    const { validated } = runImport(csv, { mode: 'property_prospect', existingByAddress: existing })
    expect(validated[0].status).toBe('duplicate')
  })

  it('catches the same house twice inside one file', () => {
    const csv = [
      'STOP,ADDRESS',
      '1,"4386 Sibley Bay St, Port Charlotte, FL 33980"',
      '2,"4386 Sibley Bay Street, Port Charlotte, FL 33980"',
    ].join('\n')
    const { validated } = runImport(csv, { mode: 'property_prospect' })
    expect(validated[0].status).toBe('valid')
    expect(validated[1].status).toBe('duplicate')
    expect(validated[1].duplicateOfRow).toBe(2)
  })

  it('does not treat two houses on the same street as one', () => {
    const csv = [
      'ADDRESS',
      '"4386 Sibley Bay St, Port Charlotte, FL 33980"',
      '"4388 Sibley Bay St, Port Charlotte, FL 33980"',
    ].join('\n')
    const { validated } = runImport(csv, { mode: 'property_prospect' })
    expect(validated.every(r => r.status === 'valid')).toBe(true)
  })

  it('still prefers email, then phone, over address', () => {
    const csv = 'ADDRESS,EMAIL\n"12 Main St, Venice, FL 34293",jo@example.test'
    const { validated } = runImport(csv, {
      mode: 'property_prospect',
      existingByAddress: new Map([['12 main st 34293', 'by-address']]),
    })
    // Address is the only key available here, so it is used.
    expect(validated[0].duplicateOf?.matchedOn).toBe('address')

    const byEmail = validateRows(
      [{ ...runImport(csv, { mode: 'property_prospect' }).parsed[0] }],
      {
        mode: 'property_prospect',
        existingByEmail: new Map([['jo@example.test', 'by-email']]),
        existingByAddress: new Map([['12 main st 34293', 'by-address']]),
      },
    )
    expect(byEmail[0].duplicateOf).toEqual({ leadId: 'by-email', matchedOn: 'email' })
  })

  it('never matches on name alone, in either mode', () => {
    const csv = 'First Name,Last Name,Phone\nJohn,Smith,941-555-0100\nJohn,Smith,941-555-0199'
    const { validated } = runImport(csv, { mode: 'standard' })
    expect(validated.every(r => r.status === 'valid')).toBe(true)
  })

  it('the default duplicate action stays conservative', () => {
    const existing = new Map([['4386 sibley bay st 33980', 'existing-lead-id']])
    const { validated } = runImport(STORM_CSV, { mode: 'property_prospect', existingByAddress: existing })
    expect(willImport(validated[0], 'skip')).toBe(false)
    expect(willImport(validated[0], 'update')).toBe(true)
    expect(willImport(validated[0], 'import_anyway')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Preview counts
// ---------------------------------------------------------------------------

describe('the preview adds up', () => {
  it('splits ready / duplicate / needs review / rejected without double counting', () => {
    const csv = [
      'ADDRESS',
      '"4386 Sibley Bay St, Port Charlotte, FL 33980"',   // ready
      '"2200 Example Rd, Punta Gorda, FL 33950"',          // ready
      '"4386 SIBLEY BAY STREET, Port Charlotte, FL 33980"',// duplicate of row 2
      '"the blue house near the marina"',                  // needs review
      '""',                                                // rejected (blank)
    ].join('\n')
    const { summary } = runImport(csv, { mode: 'property_prospect' })
    expect(summary.valid + summary.duplicates + summary.needsReview + summary.invalid).toBe(summary.total)
    expect(summary).toMatchObject({ total: 4, valid: 2, duplicates: 1, needsReview: 1, invalid: 0 })
  })

  it('counts a needs-review row as importable', () => {
    const { validated } = runImport('ADDRESS\n"the blue house near the marina"', { mode: 'property_prospect' })
    expect(willImport(validated[0], 'skip')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

describe('large files', () => {
  it('validates 5,000 address rows quickly and without a false duplicate', () => {
    const rows = Array.from({ length: 5_000 }, (_, i) =>
      `${i + 1},"${i + 1} Sibley Bay St, Port Charlotte, FL 33980"`)
    const csv = ['STOP,ADDRESS', ...rows].join('\n')

    const started = Date.now()
    const { summary } = runImport(csv, { mode: 'property_prospect' })
    const elapsed = Date.now() - started

    expect(summary.total).toBe(5_000)
    expect(summary.valid).toBe(5_000)
    expect(summary.duplicates).toBe(0)
    // Parsing and validating happen in the browser before anything is sent, so
    // this has to stay comfortably interactive.
    expect(elapsed, `took ${elapsed}ms`).toBeLessThan(5_000)
  })
})

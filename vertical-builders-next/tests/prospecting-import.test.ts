import { describe, expect, it } from 'vitest'
import {
  suggestProspectMapping, mapProspectRow, validateProspectRows, summarizeProspects,
  classifyRoofType, normalizePermitDate,
} from '../lib/ops/prospecting/import'
import { applyWasteRule } from '../lib/ops/prospecting/constants'

/**
 * ============================================================================
 * ROOF PROSPECTING IMPORT — realistic county-permit scenario
 * ----------------------------------------------------------------------------
 * Mirrors the spec's required test data: valid records, duplicate properties, an
 * address already in the CRM, a malformed row, separate property and mailing
 * addresses, permit metadata, parcel/APN, and mixed roof types.
 * ============================================================================
 */

const HEADERS = [
  'Owner Name', 'Situs Address', 'City', 'State', 'Zip',
  'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip',
  'Parcel ID', 'Permit Number', 'Issue Date', 'Permit Type', 'Roof Material', 'Contractor',
]

// One realistic row builder aligned to HEADERS order.
function row(over: Partial<Record<string, string>>): string[] {
  const base: Record<string, string> = {
    owner: '', situs: '', city: '', state: '', zip: '',
    maddr: '', mcity: '', mstate: '', mzip: '',
    parcel: '', permit: '', date: '', ptype: '', roof: '', contractor: '',
  }
  const v = { ...base, ...over }
  return [v.owner, v.situs, v.city, v.state, v.zip, v.maddr, v.mcity, v.mstate, v.mzip,
    v.parcel, v.permit, v.date, v.ptype, v.roof, v.contractor]
}

describe('column mapping', () => {
  it('recognises county permit headers including situs, parcel and mailing', () => {
    const m = suggestProspectMapping(HEADERS)
    expect(m.owner_name).toBe(0)
    expect(m.property_address).toBe(1)
    expect(m.mailing_address).toBe(5)
    expect(m.parcel_apn).toBe(9)
    expect(m.permit_number).toBe(10)
    expect(m.permit_date).toBe(11)
    expect(m.roof_type).toBe(13)
  })
})

describe('roof type classification', () => {
  it('maps real material strings to families', () => {
    expect(classifyRoofType('Asphalt Shingle')).toBe('shingle')
    expect(classifyRoofType('Architectural')).toBe('shingle')
    expect(classifyRoofType('Concrete Tile')).toBe('tile')
    expect(classifyRoofType('Standing Seam Metal')).toBe('metal')
    expect(classifyRoofType('TPO')).toBe('flat')
    expect(classifyRoofType('')).toBeNull()
  })
})

describe('permit date normalisation', () => {
  it('accepts common county formats', () => {
    expect(normalizePermitDate('2019-06-15')).toBe('2019-06-15')
    expect(normalizePermitDate('6/15/2019')).toBe('2019-06-15')
    expect(normalizePermitDate('06-05-2004')).toBe('2004-06-05')
    expect(normalizePermitDate('not a date')).toBeNull()
    expect(normalizePermitDate('')).toBeNull()
  })
})

describe('mapping a full permit row', () => {
  it('captures property, separate mailing, parcel and permit fields', () => {
    const r = mapProspectRow(row({
      owner: 'Maria Delgado', situs: '4386 Sibley Bay St', city: 'Port Charlotte', state: 'FL', zip: '33980',
      maddr: 'PO Box 210', mcity: 'Punta Gorda', mstate: 'FL', mzip: '33950',
      parcel: '402205551007', permit: 'ROOF-2019-1183', date: '6/15/2019', ptype: 'Reroof',
      roof: 'Asphalt Shingle', contractor: 'ABC Roofing',
    }), suggestProspectMapping(HEADERS), 2)
    expect(r.values.owner_name).toBe('Maria Delgado')
    expect(r.address.street).toContain('4386 Sibley Bay')
    expect(r.values.mailing_address).toBe('PO Box 210')      // distinct from property
    expect(r.values.parcel_apn).toBe('402205551007')
    expect(r.permitDateIso).toBe('2019-06-15')
    expect(r.roofFamily).toBe('shingle')
    expect(r.normalizedAddress).toBeTruthy()
  })
})

describe('validation of a realistic batch', () => {
  const mapping = suggestProspectMapping(HEADERS)
  const rows = [
    // valid shingle
    row({ situs: '4386 Sibley Bay St', city: 'Port Charlotte', state: 'FL', zip: '33980', roof: 'Shingle', permit: 'P1', date: '2010-01-01' }),
    // valid shingle, different house
    row({ situs: '110 Palm Dr', city: 'Nokomis', state: 'FL', zip: '34275', roof: 'Architectural', permit: 'P2' }),
    // duplicate of row 1 (same house, messy spelling)
    row({ situs: '4386 SIBLEY BAY STREET', city: 'Port Charlotte', state: 'FL', zip: '33980', roof: 'Shingle' }),
    // metal roof — outside a shingle campaign, must be flagged not auto-qualified
    row({ situs: '900 Harbor Rd', city: 'Venice', state: 'FL', zip: '34285', roof: 'Standing Seam Metal', permit: 'P4' }),
    // malformed: no address at all
    row({ owner: 'No Address Here', roof: 'Shingle' }),
    // already in the CRM as a lead
    row({ situs: '55 Existing Ln', city: 'Sarasota', state: 'FL', zip: '34236', roof: 'Shingle' }),
  ].map((r, i) => mapProspectRow(r, mapping, i + 2))

  const existingLeadKey = rows[5].normalizedAddress!

  const validated = validateProspectRows(rows, {
    campaignRoofTypes: ['shingle'],
    existingLeadsByAddress: new Map([[existingLeadKey, 'lead-123']]),
  })

  it('accepts clean shingle rows', () => {
    expect(validated[0].status).toBe('valid')
    expect(validated[1].status).toBe('valid')
  })

  it('marks the in-file duplicate, matched on normalised address', () => {
    expect(validated[2].status).toBe('duplicate')
    expect(validated[2].duplicateOfRow).toBe(2) // row 1 was rowNumber 2
  })

  it('flags a metal roof for review under a shingle campaign — never auto-qualified', () => {
    expect(validated[3].status).toBe('needs_review')
    expect(validated[3].reviewReason).toMatch(/roof type/i)
  })

  it('rejects a row with no usable property address', () => {
    expect(validated[4].status).toBe('invalid')
    expect(validated[4].errors[0].code).toBe('no_address')
  })

  it('flags a property already present as a CRM lead, without deleting anything', () => {
    expect(validated[5].status).toBe('duplicate')
    expect(validated[5].duplicateOf).toEqual({ id: 'lead-123', source: 'lead' })
  })

  it('summary counts add up', () => {
    const s = summarizeProspects(validated)
    expect(s.total).toBe(6)
    expect(s.invalid).toBe(1)
    expect(s.duplicates).toBe(2)
    expect(s.needsReview).toBe(1)
    expect(s.valid).toBe(2)
  })
})

describe('waste rule (never a hard-coded +2)', () => {
  it('percent adds a percentage', () => {
    // 53 squares + ~3.77% waste example from the meeting is configurable
    expect(applyWasteRule(53, { type: 'percent', value: 10, minSquares: null })).toEqual({ waste: 5.3, final: 58.3 })
  })
  it('fixed squares adds a flat amount (e.g. +2)', () => {
    expect(applyWasteRule(53, { type: 'fixed_squares', value: 2, minSquares: null })).toEqual({ waste: 2, final: 55 })
  })
  it('minimum applies a floor', () => {
    expect(applyWasteRule(8, { type: 'minimum', value: 10, minSquares: null })).toEqual({ waste: 2, final: 10 })
  })
  it('none adds nothing', () => {
    expect(applyWasteRule(53, { type: 'none', value: null, minSquares: null })).toEqual({ waste: 0, final: 53 })
  })
})

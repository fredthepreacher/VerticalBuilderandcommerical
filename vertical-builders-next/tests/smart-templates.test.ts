import { describe, expect, it } from 'vitest'
import { renderTemplate, templateKeys, isTemplateKey, TEMPLATE_LABELS } from '../lib/ops/smart/templates'
import { parseLeadNotes, extractUsPhone, matchServiceType } from '../lib/ops/smart/lead-parser'
import { SERVICE_TYPES } from '../lib/ops/constants'

/**
 * ============================================================================
 * TEMPLATES AND THE BUILT-IN LEAD PARSER
 * ----------------------------------------------------------------------------
 * The recurring theme: visible gaps beat invented content. A template with a
 * missing name shows "[name]" rather than an empty space, and the parser leaves
 * a field blank rather than guessing at it.
 * ============================================================================
 */

describe('templates', () => {
  it('offers the six the change order asked for', () => {
    expect(templateKeys().sort()).toEqual([
      'coi_renewal', 'inspection_confirmation', 'lead_first_response',
      'lead_follow_up', 'missing_document', 'unable_to_reach',
    ])
  })

  it('every template renders a subject and a body', () => {
    for (const key of templateKeys()) {
      const rendered = renderTemplate(key)
      expect(rendered.subject.length, `${key} has no subject`).toBeGreaterThan(0)
      expect(rendered.body.length, `${key} has no body`).toBeGreaterThan(40)
      expect(rendered.label).toBe(TEMPLATE_LABELS[key])
    }
  })

  it('uses CRM values when it has them', () => {
    const rendered = renderTemplate('lead_follow_up', {
      contactName: 'John Smith', serviceType: 'Roofing', senderName: 'Fred',
    })
    expect(rendered.body).toContain('Hi John Smith,')
    expect(rendered.body).toContain('Roofing')
    expect(rendered.body).toContain('Fred')
    expect(rendered.placeholders).toEqual([])
  })

  it('shows a visible bracket for anything it does not have, and lists it', () => {
    const rendered = renderTemplate('lead_follow_up')
    // Never "Hi ," — a half-filled message that goes out is worse than an
    // obviously unfinished one.
    expect(rendered.body).toContain('[name]')
    expect(rendered.body).not.toContain('Hi ,')
    expect(rendered.placeholders).toContain('name')
  })

  it('builds a COI renewal request naming the coverage and the date', () => {
    const rendered = renderTemplate('coi_renewal', {
      companyName: 'ZZ Roofing LLC', coverageType: 'general liability',
      expirationDate: '2026-11-30', senderName: 'Fred',
    })
    expect(rendered.subject).toContain('ZZ Roofing LLC')
    expect(rendered.body).toContain('general liability')
    expect(rendered.body).toContain('2026-11-30')
    // The four endorsements the compliance rules actually check for.
    expect(rendered.body).toMatch(/certificate holder/i)
    expect(rendered.body).toMatch(/additional insured/i)
    expect(rendered.body).toMatch(/waiver of subrogation/i)
  })

  it('names the missing document rather than saying "some paperwork"', () => {
    const rendered = renderTemplate('missing_document', {
      companyName: 'ZZ Roofing LLC', documentName: 'signed W-9',
    })
    expect(rendered.body).toContain('signed W-9')
  })

  it('never claims anything has been sent', () => {
    for (const key of templateKeys()) {
      const body = renderTemplate(key).body.toLowerCase()
      expect(body).not.toMatch(/we have (sent|emailed|scheduled)/)
    }
  })

  it('rejects a template key it does not have', () => {
    expect(isTemplateKey('lead_follow_up')).toBe(true)
    expect(isTemplateKey('fire_the_client')).toBe(false)
  })
})

describe('extractUsPhone', () => {
  it('reads the usual American shapes', () => {
    for (const input of [
      '941-555-0100', '(941) 555-0100', '941.555.0100', '9415550100',
      '+1 941 555 0100', 'call me on 941 555 0100 tomorrow',
    ]) {
      expect(extractUsPhone(input), input).toBe('(941) 555-0100')
    }
  })

  it('returns null rather than a wrong number', () => {
    for (const input of ['', '12345', 'no phone here', '1234567890123456']) {
      expect(extractUsPhone(input)).toBeNull()
    }
  })
})

describe('matchServiceType', () => {
  it('maps keywords onto the fixed taxonomy and nothing else', () => {
    expect(matchServiceType('the roof is leaking')).toBe('Roofing')
    expect(matchServiceType('needs a new lanai screen')).toBe('Pool / Lanai / Outdoor Living')
    expect(matchServiceType('impact windows please')).toBe('Impact Windows & Doors')
    expect(matchServiceType('help with a permit')).toBe('Permitting Help')
  })

  it('only ever returns a value the CRM can store', () => {
    const allowed = new Set<string>(SERVICE_TYPES)
    for (const text of ['roof', 'kitchen', 'pool', 'driveway pavers', 'adu', 'commercial job', 'nothing relevant']) {
      const result = matchServiceType(text)
      if (result !== null) expect(allowed.has(result), `${result} is not in the taxonomy`).toBe(true)
    }
  })

  it('returns null rather than inventing a category', () => {
    expect(matchServiceType('they want something done at some point')).toBeNull()
  })
})

describe('the built-in lead parser', () => {
  it('reads a labelled block completely', () => {
    const { fields, found } = parseLeadNotes([
      'Name: John Smith',
      'Phone: 941-555-0100',
      'Email: JOHN@example.com',
      'Address: 123 Main St',
      'City: Venice',
      'State: FL',
      'Zip: 34293',
      'Service: Roofing',
      'Notes: leak near the garage, wants someone Friday',
    ].join('\n'))

    expect(fields.first_name).toBe('John')
    expect(fields.last_name).toBe('Smith')
    expect(fields.phone).toBe('(941) 555-0100')
    expect(fields.email).toBe('john@example.com')
    expect(fields.property_address).toBe('123 Main St')
    expect(fields.city).toBe('Venice')
    expect(fields.state).toBe('FL')
    expect(fields.zip).toBe('34293')
    expect(fields.service_type).toBe('Roofing')
    expect(fields.project_description).toContain('leak near the garage')
    expect(found).toContain('name')
    expect(found).toContain('phone')
  })

  it('finds an email, a phone and a ZIP in unlabelled prose', () => {
    const { fields } = parseLeadNotes(
      'Spoke to someone about a roof leak, reach them on 941-555-0100 or dave@example.com, property is in 34293.',
    )
    expect(fields.phone).toBe('(941) 555-0100')
    expect(fields.email).toBe('dave@example.com')
    expect(fields.zip).toBe('34293')
    expect(fields.service_type).toBe('Roofing')
  })

  it('does NOT guess a name out of prose, and says so', () => {
    // The honest limitation. A wrong first name on a customer record is worse
    // than a blank one, and AI Enhanced is what handles this case properly.
    const { fields, notes } = parseLeadNotes('spoke to dave about the roof at his mothers place')
    expect(fields.first_name).toBeUndefined()
    expect(notes.join(' ')).toMatch(/no name was extracted/i)
  })

  it('does NOT guess an address out of prose, and says so', () => {
    const { fields, notes } = parseLeadNotes('the job is round the back of the old bakery')
    expect(fields.property_address).toBeUndefined()
    expect(fields.city).toBeUndefined()
    expect(notes.join(' ')).toMatch(/no address or city/i)
  })

  it('keeps everything it could not read, so nothing is lost', () => {
    const { fields } = parseLeadNotes(
      'Name: John Smith\nHe mentioned the neighbour had the same problem and got quoted 12k',
    )
    expect(fields.project_description).toContain('neighbour had the same problem')
  })

  it('rejects a state abbreviation that is not a real state', () => {
    const { fields } = parseLeadNotes('Name: A\nState: ZZ')
    expect(fields.state).toBeUndefined()
  })

  it('rejects a phone label whose value is not a phone number', () => {
    const { fields } = parseLeadNotes('Name: A\nPhone: he will call us')
    expect(fields.phone).toBeUndefined()
  })

  it('says plainly when it found nothing at all', () => {
    const { found, notes } = parseLeadNotes('call them back sometime next week maybe')
    expect(found).toEqual([])
    expect(notes.join(' ')).toMatch(/nothing could be extracted/i)
  })

  it('never sets a pipeline stage or an assignee — those are not its business', () => {
    const { fields } = parseLeadNotes('Name: John Smith\nStage: won\nAssigned: Fred')
    expect(fields).not.toHaveProperty('pipeline_stage')
    expect(fields).not.toHaveProperty('assigned_to')
  })

  it('survives an enormous paste without hanging', () => {
    const huge = 'Name: John Smith\n' + 'noise line\n'.repeat(5_000)
    expect(() => parseLeadNotes(huge)).not.toThrow()
    expect(parseLeadNotes(huge).fields.first_name).toBe('John')
  })
})

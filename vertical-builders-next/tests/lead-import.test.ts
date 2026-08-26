import { describe, expect, it } from 'vitest'
import {
  buildErrorCsv, chunk, CHUNK_SIZE, mapRow, normalizeEmail, normalizePhone,
  parseCsv, suggestMapping, summarize, validateRows, type ColumnMapping,
} from '../lib/ops/imports/leads'

describe('parseCsv', () => {
  it('parses a plain file', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,address\n"Smith, John","123 Main St, Unit 4"'))
      .toEqual([['name', 'address'], ['Smith, John', '123 Main St, Unit 4']])
  })

  it('keeps newlines inside quoted fields', () => {
    const rows = parseCsv('name,notes\n"Jo","line one\nline two"')
    expect(rows).toHaveLength(2)
    expect(rows[1][1]).toBe('line one\nline two')
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"He said ""hi"""')[1][0]).toBe('He said "hi"')
  })

  it('strips a UTF-8 BOM so the first header still matches', () => {
    expect(parseCsv('﻿First Name,Email')[0][0]).toBe('First Name')
  })

  it('handles CRLF line endings from Excel', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('returns nothing for an empty file rather than one blank row', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('   \n  ')).toEqual([])
  })
})

describe('suggestMapping', () => {
  it('recognises common header spellings from other CRMs', () => {
    const mapping = suggestMapping(['First Name', 'Last Name', 'E-mail Address', 'Mobile Phone', 'Zip Code'])
    expect(mapping.first_name).toBe(0)
    expect(mapping.last_name).toBe(1)
    expect(mapping.email).toBe(2)
    expect(mapping.phone).toBe(3)
    expect(mapping.zip).toBe(4)
  })

  it('leaves unknown columns unmapped rather than guessing', () => {
    const mapping = suggestMapping(['Widget Code', 'Internal Ref'])
    expect(Object.keys(mapping)).toHaveLength(0)
  })
})

describe('normalizeEmail / normalizePhone', () => {
  it('lowercases and trims an email', () => {
    expect(normalizeEmail('  Fred@Example.COM ')).toBe('fred@example.com')
  })

  it('rejects anything that is not an email', () => {
    for (const bad of ['', 'not-an-email', 'a@b', '@example.com', 'a b@c.com', null, undefined]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
  })

  it('reduces a US phone to ten digits regardless of punctuation', () => {
    for (const input of ['(941) 877-2009', '941.877.2009', '941 877 2009', '9418772009']) {
      expect(normalizePhone(input)).toBe('9418772009')
    }
  })

  it('strips a leading US country code', () => {
    expect(normalizePhone('+1 (941) 877-2009')).toBe('9418772009')
    expect(normalizePhone('19418772009')).toBe('9418772009')
  })

  it('rejects numbers that are not ten digits', () => {
    for (const bad of ['12345', '441234567890', '', null]) {
      expect(normalizePhone(bad)).toBeNull()
    }
  })
})

const MAPPING: ColumnMapping = { first_name: 0, last_name: 1, email: 2, phone: 3, state: 4 }
const row = (n: number, ...cells: string[]) => mapRow(cells, MAPPING, n)

describe('validateRows', () => {
  it('accepts a row with a name and one reachable channel', () => {
    const [result] = validateRows([row(2, 'Fred', 'Pierre', 'fred@example.com', '', '')])
    expect(result.status).toBe('valid')
    expect(result.errors).toEqual([])
  })

  it('rejects a row with no name at all', () => {
    const [result] = validateRows([row(2, '', '', 'fred@example.com', '', '')])
    expect(result.status).toBe('invalid')
    expect(result.errors[0].code).toBe('missing_name')
  })

  it('rejects a row with no way to contact the person', () => {
    const [result] = validateRows([row(2, 'Fred', 'Pierre', '', '', '')])
    expect(result.status).toBe('invalid')
    expect(result.errors[0].code).toBe('no_contact')
  })

  it('warns rather than rejects when one channel is bad and the other works', () => {
    const [result] = validateRows([row(2, 'Fred', '', 'not-an-email', '9418772009', '')])
    expect(result.status).toBe('valid')
    expect(result.warnings.join(' ')).toMatch(/not valid/i)
  })

  it('matches an existing lead on email before phone', () => {
    const [result] = validateRows([row(2, 'Fred', '', 'fred@example.com', '9418772009', '')], {
      existingByEmail: new Map([['fred@example.com', 'lead-email']]),
      existingByPhone: new Map([['9418772009', 'lead-phone']]),
    })
    expect(result.status).toBe('duplicate')
    expect(result.duplicateOf).toEqual({ leadId: 'lead-email', matchedOn: 'email' })
  })

  it('falls back to a phone match when there is no email match', () => {
    const [result] = validateRows([row(2, 'Fred', '', '', '9418772009', '')], {
      existingByPhone: new Map([['9418772009', 'lead-phone']]),
    })
    expect(result.duplicateOf).toEqual({ leadId: 'lead-phone', matchedOn: 'phone' })
  })

  it('never matches on name alone', () => {
    const [result] = validateRows([row(2, 'Fred', 'Pierre', 'different@example.com', '', '')], {
      existingByEmail: new Map([['fred@example.com', 'other-lead']]),
    })
    expect(result.status).toBe('valid')
  })

  it('catches the same person appearing twice in one file', () => {
    const results = validateRows([
      row(2, 'Fred', 'Pierre', 'fred@example.com', '', ''),
      row(3, 'Frederick', 'Pierre', 'FRED@example.com', '', ''),
    ])
    expect(results[0].status).toBe('valid')
    expect(results[1].status).toBe('duplicate')
    expect(results[1].duplicateOfRow).toBe(2)
  })

  it('truncates an over-long state and says so', () => {
    const [result] = validateRows([row(2, 'Fred', '', 'fred@example.com', '', 'Florida')])
    expect(result.values.state).toBe('FL')
    expect(result.warnings.join(' ')).toMatch(/truncated/i)
  })

  it('does not treat an invalid row as a duplicate candidate', () => {
    const results = validateRows([row(2, '', '', 'fred@example.com', '', '')], {
      existingByEmail: new Map([['fred@example.com', 'lead-1']]),
    })
    expect(results[0].status).toBe('invalid')
    expect(results[0].duplicateOf).toBeUndefined()
  })
})

describe('summarize', () => {
  it('counts each outcome once and the totals reconcile', () => {
    const rows = validateRows([
      row(2, 'A', '', 'a@example.com', '', ''),
      row(3, 'B', '', 'a@example.com', '', ''),
      row(4, '', '', '', '', ''),
    ])
    const summary = summarize(rows)
    expect(summary.total).toBe(3)
    expect(summary.valid).toBe(1)
    expect(summary.duplicates).toBe(1)
    expect(summary.invalid).toBe(1)
    expect(summary.valid + summary.duplicates + summary.invalid).toBe(summary.total)
  })
})

describe('chunk', () => {
  it('splits work into slices the server can finish inside one request', () => {
    const items = Array.from({ length: 1_000 }, (_, i) => i)
    const chunks = chunk(items)
    expect(CHUNK_SIZE).toBe(400)
    expect(chunks.map(c => c.length)).toEqual([400, 400, 200])
    expect(chunks.flat()).toEqual(items)
  })

  it('returns nothing for an empty list, and one chunk for a short one', () => {
    expect(chunk([])).toEqual([])
    expect(chunk([1, 2, 3])).toEqual([[1, 2, 3]])
  })

  it('loses no rows at an exact multiple of the chunk size', () => {
    const items = Array.from({ length: 800 }, (_, i) => i)
    expect(chunk(items).flat()).toHaveLength(800)
  })
})

describe('buildErrorCsv', () => {
  it('reports only the rows the operator has to fix, with the reason', () => {
    const rows = validateRows([
      row(2, 'Fred', '', 'fred@example.com', '', ''),
      row(3, '', '', '', '', ''),
    ])
    const csv = buildErrorCsv(rows, ['First Name', 'Last Name', 'Email', 'Phone', 'State'])
    expect(csv).toMatch(/missing_name|No first name/i)
    expect(csv).not.toMatch(/fred@example\.com/)
  })
})

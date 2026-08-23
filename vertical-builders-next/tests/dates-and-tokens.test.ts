import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, defaultAuditPeriod, overlapsPeriod, toIsoDate, toUtcDate } from '../lib/ops/utils/dates'
import { checkTokenState, generateUploadToken, hashToken, safeEqual } from '../lib/ops/utils/tokens'
import { publicLeadSchema, splitName } from '../lib/ops/validations/lead'
import { parseLimit, dollarsToCents, formatLimit } from '../lib/ops/utils/money'
import { buildStoragePath, sanitizeFilename, sanitizeFolderName, validateUpload } from '../lib/ops/utils/files'

/**
 * Audit period overlap (spec §21). Getting this wrong means a subcontractor who
 * WAS covered during the window is reported as a gap, or worse, one who was not
 * is reported as covered.
 */
describe('overlapsPeriod', () => {
  const START = '2026-01-01'
  const END = '2026-06-30'

  it('includes a policy entirely inside the window', () => {
    expect(overlapsPeriod('2026-02-01', '2026-05-01', START, END)).toBe(true)
  })

  it('includes a policy that spans the whole window', () => {
    expect(overlapsPeriod('2025-06-01', '2027-06-01', START, END)).toBe(true)
  })

  it('excludes a policy that ended before the window opened', () => {
    expect(overlapsPeriod('2025-01-01', '2025-12-31', START, END)).toBe(false)
  })

  it('excludes a policy that starts after the window closed', () => {
    expect(overlapsPeriod('2026-07-01', '2027-07-01', START, END)).toBe(false)
  })

  it('includes a policy that expires exactly on the first day (inclusive)', () => {
    expect(overlapsPeriod('2025-01-01', '2026-01-01', START, END)).toBe(true)
  })

  it('includes a policy that takes effect exactly on the last day (inclusive)', () => {
    expect(overlapsPeriod('2026-06-30', '2027-06-30', START, END)).toBe(true)
  })

  it('includes a policy with unrecorded dates rather than dropping the vendor silently', () => {
    expect(overlapsPeriod(null, null, START, END)).toBe(true)
    expect(overlapsPeriod(null, '2026-03-01', START, END)).toBe(true)
    expect(overlapsPeriod('2026-03-01', null, START, END)).toBe(true)
  })
})

describe('date helpers', () => {
  it('parses a date string to UTC midnight regardless of server timezone', () => {
    const d = toUtcDate('2026-03-04')!
    expect(d.toISOString()).toBe('2026-03-04T00:00:00.000Z')
  })

  it('parses an ISO timestamp down to its calendar date', () => {
    expect(toIsoDate('2026-03-04T23:45:00.000Z')).toBe('2026-03-04')
  })

  it('returns null for empty or unparseable input', () => {
    expect(toUtcDate(null)).toBeNull()
    expect(toUtcDate('')).toBeNull()
    expect(toUtcDate('not a date')).toBeNull()
  })

  it('counts whole days in both directions', () => {
    const a = toUtcDate('2026-03-01')!
    expect(daysBetween(a, toUtcDate('2026-03-31')!)).toBe(30)
    expect(daysBetween(a, toUtcDate('2026-02-27')!)).toBe(-2)
    expect(daysBetween(a, a)).toBe(0)
  })

  it('does not drift across a daylight-saving boundary', () => {
    // US DST starts 8 March 2026; a naive local-time implementation returns 30.
    expect(daysBetween(toUtcDate('2026-03-01')!, addDays(toUtcDate('2026-03-01')!, 31))).toBe(31)
  })

  it('suggests a trailing six-month audit window', () => {
    const period = defaultAuditPeriod(new Date('2026-08-21T00:00:00Z'))
    expect(period.end).toBe('2026-08-21')
    expect(period.start).toBe('2026-02-21')
  })
})

describe('upload tokens', () => {
  it('generates a long random token and stores only its hash', () => {
    const { token, hash } = generateUploadToken()
    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
    expect(hashToken(token)).toBe(hash)
  })

  it('produces a different token every time', () => {
    const a = generateUploadToken().token
    const b = generateUploadToken().token
    expect(a).not.toBe(b)
  })

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })

  const NOW = new Date('2026-06-15T12:00:00Z')

  it('rejects a token that does not exist', () => {
    const state = checkTokenState(null, NOW)
    expect(state.valid).toBe(false)
    expect(state.reason).toBe('not_found')
  })

  it('rejects an expired token', () => {
    const state = checkTokenState(
      { expires_at: '2026-06-14T12:00:00Z', revoked_at: null, used_at: null }, NOW,
    )
    expect(state.valid).toBe(false)
    expect(state.reason).toBe('expired')
    expect(state.message).toMatch(/expired/i)
  })

  it('rejects a revoked token even when it has not expired', () => {
    const state = checkTokenState(
      { expires_at: '2026-07-01T12:00:00Z', revoked_at: '2026-06-10T00:00:00Z', used_at: null }, NOW,
    )
    expect(state.valid).toBe(false)
    expect(state.reason).toBe('revoked')
  })

  it('accepts a live token', () => {
    expect(checkTokenState({ expires_at: '2026-07-01T12:00:00Z', revoked_at: null, used_at: null }, NOW).valid)
      .toBe(true)
  })

  it('still accepts a token that was already used, so a vendor can send a second page', () => {
    expect(checkTokenState(
      { expires_at: '2026-07-01T12:00:00Z', revoked_at: null, used_at: '2026-06-14T00:00:00Z' }, NOW,
    ).valid).toBe(true)
  })
})

describe('public lead validation', () => {
  const valid = {
    name: 'Marie Delacroix',
    email: 'marie@example.com',
    phone: '941-555-0142',
    projectType: 'Roofing',
  }

  it('accepts a minimal valid submission', () => {
    expect(publicLeadSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing name', () => {
    const result = publicLeadSchema.safeParse({ ...valid, name: '  ' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed email', () => {
    const result = publicLeadSchema.safeParse({ ...valid, email: 'marie@' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toMatch(/valid email/i)
    }
  })

  it('rejects a phone number with fewer than ten digits', () => {
    expect(publicLeadSchema.safeParse({ ...valid, phone: '555-014' }).success).toBe(false)
  })

  it('accepts a phone number written any way a human might type it', () => {
    for (const phone of ['(941) 555-0142', '941.555.0142', '+1 941 555 0142']) {
      expect(publicLeadSchema.safeParse({ ...valid, phone }).success).toBe(true)
    }
  })

  it('treats blank optional fields as absent rather than as empty strings', () => {
    const result = publicLeadSchema.safeParse({ ...valid, city: '   ', message: '' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.city).toBeUndefined()
      expect(result.data.message).toBeUndefined()
    }
  })

  it('caps an oversized message instead of accepting unbounded input', () => {
    expect(publicLeadSchema.safeParse({ ...valid, message: 'x'.repeat(5000) }).success).toBe(false)
  })

  it('keeps the honeypot value so the route can detect a bot', () => {
    const result = publicLeadSchema.safeParse({ ...valid, company: 'spam-bot' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.company).toBe('spam-bot')
  })

  it('splits names without losing any part', () => {
    expect(splitName('Marie')).toEqual({ first: 'Marie', last: null })
    expect(splitName('Marie Delacroix')).toEqual({ first: 'Marie', last: 'Delacroix' })
    expect(splitName('Ana Maria de la Cruz')).toEqual({ first: 'Ana', last: 'Maria de la Cruz' })
  })
})

describe('money helpers', () => {
  it('parses insurance limits written the way people write them', () => {
    expect(parseLimit('1,000,000')).toBe(1_000_000)
    expect(parseLimit('$2,000,000')).toBe(2_000_000)
    expect(parseLimit('1M')).toBe(1_000_000)
    expect(parseLimit('500k')).toBe(500_000)
    expect(parseLimit('')).toBeNull()
    expect(parseLimit('abc')).toBeNull()
  })

  it('converts dollars to integer cents without floating point drift', () => {
    expect(dollarsToCents('24,500.35')).toBe(2_450_035)
    expect(dollarsToCents('0.1')).toBe(10)
    expect(Number.isInteger(dollarsToCents('19.99'))).toBe(true)
  })

  it('formats a limit for display', () => {
    expect(formatLimit(1_000_000)).toBe('$1,000,000')
    expect(formatLimit(null)).toBe('—')
  })
})

describe('file safety', () => {
  it('strips directory traversal out of a filename', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe')
  })

  it('normalises awkward filenames without losing the extension', () => {
    expect(sanitizeFilename('ABC Roofing COI 2026.pdf')).toBe('ABC_Roofing_COI_2026.pdf')
    expect(sanitizeFilename('résumé*?.PDF')).toBe('r_sum.pdf')
  })

  it('always returns something usable', () => {
    expect(sanitizeFilename('')).toBe('document')
    expect(sanitizeFilename('...')).toBe('document')
    expect(sanitizeFolderName('')).toBe('unnamed')
  })

  it('builds a storage path only from a real UUID', () => {
    const path = buildStoragePath({
      scope: 'vendors',
      entityId: '44444444-0000-4000-8000-000000000001',
      folder: 'insurance',
      filename: '../evil.pdf',
      year: 2026,
    })
    expect(path).toMatch(/^vendors\/44444444-0000-4000-8000-000000000001\/insurance\/2026\/[a-z0-9]+-evil\.pdf$/)
    expect(path).not.toContain('..')
  })

  it('refuses to build a path from a non-UUID entity id', () => {
    expect(() => buildStoragePath({
      scope: 'vendors', entityId: '../../etc', folder: 'x', filename: 'a.pdf',
    })).toThrow(/non-UUID/)
  })

  it('enforces upload type and size limits', () => {
    expect(validateUpload({ size: 1000, type: 'application/pdf', name: 'a.pdf' }).ok).toBe(true)
    expect(validateUpload({ size: 0, type: 'application/pdf', name: 'a.pdf' }).ok).toBe(false)
    expect(validateUpload({ size: 20 * 1024 * 1024, type: 'application/pdf', name: 'a.pdf' }).ok).toBe(false)
    expect(validateUpload({ size: 1000, type: 'application/x-msdownload', name: 'a.exe' }).ok).toBe(false)
  })
})

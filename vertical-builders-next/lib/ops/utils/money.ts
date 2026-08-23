/**
 * Money helpers.
 *
 * Two different units live in this app and they must not be mixed up:
 *   * Project / lead amounts are stored as *_cents  (bigint)
 *   * Insurance limits are stored in WHOLE DOLLARS as integers inside
 *     limits_json, because certificates are always written in whole dollars
 *     ("$1,000,000 each occurrence") and cents would be noise.
 * Neither is ever a floating point value in the database.
 */

export function centsToDollars(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null
  return Math.round(Number(cents)) / 100
}

export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null
  const cleaned = typeof input === 'string' ? input.replace(/[$,\s]/g, '') : String(input)
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

export function formatCents(cents: number | null | undefined): string {
  const dollars = centsToDollars(cents)
  if (dollars === null) return '—'
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Insurance limits: whole dollars in, "$1,000,000" out. */
export function formatLimit(dollars: number | null | undefined): string {
  if (dollars === null || dollars === undefined) return '—'
  return Number(dollars).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Parses "1,000,000" / "$1M" / "1000000" into whole dollars. */
export function parseLimit(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') return Math.round(input)
  const raw = input.trim().replace(/[$,\s]/g, '')
  const millions = /^(\d+(?:\.\d+)?)m$/i.exec(raw)
  if (millions) return Math.round(Number(millions[1]) * 1_000_000)
  const thousands = /^(\d+(?:\.\d+)?)k$/i.exec(raw)
  if (thousands) return Math.round(Number(thousands[1]) * 1_000)
  const value = Number(raw)
  return Number.isFinite(value) ? Math.round(value) : null
}

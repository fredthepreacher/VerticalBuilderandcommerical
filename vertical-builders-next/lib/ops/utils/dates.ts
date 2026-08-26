/**
 * Date helpers. Everything compliance-related works on calendar dates
 * (YYYY-MM-DD) in UTC so a policy never appears to expire a day early or late
 * because of the server's timezone.
 */

/** Parse a YYYY-MM-DD (or ISO timestamp) into a UTC midnight Date. Null-safe. */
export function toUtcDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

export function toIsoDate(value: string | Date | null | undefined): string | null {
  const d = toUtcDate(value)
  return d ? d.toISOString().slice(0, 10) : null
}

const MS_PER_DAY = 86_400_000

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

/**
 * Inclusive overlap test used by the Audit Center.
 *
 *   policy.effective_date <= period_end  AND  policy.expiration_date >= period_start
 *
 * A missing effective date is treated as "always was in force"; a missing
 * expiration date as "still in force". Both are flagged separately by the
 * evaluator, this helper only answers the overlap question.
 */
export function overlapsPeriod(
  effective: string | Date | null | undefined,
  expiration: string | Date | null | undefined,
  periodStart: string | Date,
  periodEnd: string | Date,
): boolean {
  const start = toUtcDate(periodStart)
  const end = toUtcDate(periodEnd)
  if (!start || !end) return false
  const eff = toUtcDate(effective)
  const exp = toUtcDate(expiration)
  if (eff && eff.getTime() > end.getTime()) return false
  if (exp && exp.getTime() < start.getTime()) return false
  return true
}

/** Formats a date for UI display, e.g. "Mar 4, 2026". Returns em dash when null. */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toUtcDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Formats a timestamp with time, e.g. "Mar 4, 2026, 2:15 PM". */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  })
}

/** "in 12 days" / "8 days ago" / "today" */
export function relativeDays(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'today'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  const n = Math.abs(days)
  return `${n} day${n === 1 ? '' : 's'} ago`
}

/** Six-month audit window ending today, used to prefill the Audit Center. */
export function defaultAuditPeriod(today = new Date()): { start: string; end: string } {
  const end = toUtcDate(today)!
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 6, end.getUTCDate()))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

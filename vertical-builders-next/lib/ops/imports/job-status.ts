/**
 * ============================================================================
 * IMPORT JOB STATUS — the pure half of the lifecycle
 * ----------------------------------------------------------------------------
 * Thresholds, the "did this write anything" predicate, and the display
 * derivation. No database, no `server-only`, so the same rules are used by the
 * sweep on the server and by Recent Imports when it renders — and both are
 * testable without a Postgres.
 *
 * Keeping the thresholds here rather than in two places is the point: if the
 * sweep considered a job abandoned after an hour while the table still called
 * it "awaiting import", the office would be told two different things about the
 * same row.
 * ============================================================================
 */

/**
 * How long a job may sit in `validating` before it counts as abandoned.
 *
 * Generous on purpose. The gap between a preview being generated and the first
 * chunk landing is seconds; an hour is far beyond any plausible pause,
 * including an operator who walks away mid-review and comes back to it.
 */
export const STALE_VALIDATING_MINUTES = 60

/**
 * The equivalent for a job that started importing and stopped.
 *
 * Longer, because this one DID write rows and getting it wrong is costlier. A
 * 50,000-row import is roughly 125 chunked requests — minutes, not hours.
 */
export const STALE_IMPORTING_HOURS = 6

export const ABANDONED_REASON = 'Abandoned before importing — cleaned up automatically.'
export const SUPERSEDED_REASON = 'Abandoned — a new import was started before this one finished.'
export const BACKED_OUT_REASON = 'Cancelled before importing.'
export const INTERRUPTED_REASON = 'Interrupted before finishing — the rows already imported were saved.'

/** The counters that must all be zero for a job to count as "wrote nothing". */
export const ROW_COUNTERS = [
  'processed_rows', 'imported_rows', 'updated_rows', 'skipped_rows', 'failed_rows',
] as const

export interface JobCounters {
  processed_rows?: number | null
  imported_rows?: number | null
  updated_rows?: number | null
  skipped_rows?: number | null
  failed_rows?: number | null
}

/**
 * Did this job write anything at all?
 *
 * The single question the whole safety story rests on: a job that wrote
 * something is never cancelled, never relabelled, and never has its leads
 * touched. Pure, so it cannot quietly acquire a database dependency later.
 */
export function wroteNothing(job: JobCounters): boolean {
  return ROW_COUNTERS.every(key => (job[key] ?? 0) === 0)
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export type JobTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'

export interface JobRowForDisplay extends JobCounters {
  status: string
  status_reason?: string | null
  total_rows?: number | null
  created_at: string
}

export interface JobOutcome {
  label: string
  tone: JobTone
  detail: string | null
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

/**
 * What actually happened, in words the office can act on.
 *
 * The raw status is not enough on its own. `validating` is equally true of a
 * preview generated four seconds ago and one abandoned last Tuesday, and
 * showing the same word for both is exactly what made Recent Imports
 * untrustworthy. The distinction is age plus whether anything was written, so
 * it is derived at render time rather than stored — a row does not become
 * abandoned at the moment somebody happens to run a sweep.
 *
 * @param now injectable so the boundaries are testable without waiting an hour.
 */
export function describeJob(job: JobRowForDisplay, now: number = Date.now()): JobOutcome {
  const ageMinutes = (now - new Date(job.created_at).getTime()) / 60_000
  const total = job.total_rows ?? 0
  const processed = job.processed_rows ?? 0
  const imported = job.imported_rows ?? 0
  const failed = job.failed_rows ?? 0
  const partial = processed > 0 && total > 0 && processed < total

  switch (job.status) {
    case 'completed':
      return {
        label: partial ? 'Ended early' : 'Completed',
        tone: partial ? 'warn' : 'ok',
        detail: job.status_reason
          ?? (partial ? `Stopped after ${processed.toLocaleString()} of ${total.toLocaleString()} rows.` : null),
      }

    case 'completed_with_errors':
      return {
        label: 'Completed with errors',
        tone: 'warn',
        detail: job.status_reason ?? `${plural(failed, 'row')} rejected.`,
      }

    case 'cancelled':
      return {
        label: 'Cancelled',
        tone: 'neutral',
        detail: job.status_reason ?? 'Cancelled before importing. Nothing was saved.',
      }

    case 'failed':
      return { label: 'Failed', tone: 'bad', detail: job.status_reason ?? 'Nothing was imported.' }

    case 'importing':
      // Genuinely in flight, or a tab closed mid-import. Either way rows have
      // landed, so this is never called cancelled and the counters stand.
      return ageMinutes > STALE_VALIDATING_MINUTES
        ? {
            label: 'Interrupted',
            tone: 'warn',
            detail: `${plural(imported, 'row')} imported and saved before it stopped.`,
          }
        : {
            label: 'Importing',
            tone: 'info',
            detail: `${processed.toLocaleString()} of ${total.toLocaleString()} rows processed.`,
          }

    case 'validating':
    case 'pending':
      if (ageMinutes <= STALE_VALIDATING_MINUTES) {
        return { label: 'Awaiting import', tone: 'info', detail: 'Previewed but not imported yet.' }
      }
      // An old job that nonetheless wrote rows is not abandoned, whatever its
      // status says. Telling the office "never imported" about a job holding 97
      // leads would send them off to re-import a file they already have. The
      // sweep leaves this row alone for the same reason, so the label has to
      // agree with it.
      return wroteNothing(job)
        ? {
            label: 'Abandoned',
            tone: 'neutral',
            detail: job.status_reason ?? 'Never imported. It will be tidied away automatically.',
          }
        : {
            label: 'Interrupted',
            tone: 'warn',
            detail: `${plural(imported, 'row')} imported and saved before it stopped.`,
          }

    default:
      return {
        label: String(job.status).replace(/_/g, ' '),
        tone: 'neutral',
        detail: job.status_reason ?? null,
      }
  }
}

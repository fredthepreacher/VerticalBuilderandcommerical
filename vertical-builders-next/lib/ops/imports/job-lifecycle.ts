import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ABANDONED_REASON, BACKED_OUT_REASON, INTERRUPTED_REASON, ROW_COUNTERS,
  STALE_IMPORTING_HOURS, STALE_VALIDATING_MINUTES, wroteNothing,
  type JobCounters,
} from './job-status'

// Re-exported so callers have one import for the whole lifecycle.
export {
  ABANDONED_REASON, BACKED_OUT_REASON, INTERRUPTED_REASON, SUPERSEDED_REASON,
  STALE_IMPORTING_HOURS, STALE_VALIDATING_MINUTES, wroteNothing,
} from './job-status'
export type { JobCounters } from './job-status'

/**
 * ============================================================================
 * IMPORT JOB LIFECYCLE
 * ----------------------------------------------------------------------------
 * A job row is created when the operator asks for a preview — before they have
 * committed to importing anything. Most of the time they go on to import. When
 * they do not, the row has to reach a terminal state on its own, or Recent
 * Imports fills up with jobs that look like work in progress and never were.
 *
 * Three layers, because no single one covers every way a flow gets abandoned:
 *
 *   1. ON BACK-OUT      the wizard cancels its own job when the operator
 *                       returns to mapping or starts over. Immediate and exact.
 *   2. ON SUPERSEDE     starting a new import cancels this user's earlier
 *                       abandoned ones. Covers a closed tab, because the next
 *                       import is when we learn the previous one was dropped.
 *   3. ON A SCHEDULE    the daily cron sweeps anything the first two missed —
 *                       a tab closed by someone who never imports again.
 *
 * THE SAFETY RULE, enforced in one place: a job is only ever cancelled when
 * every row counter is zero. A job that wrote even one lead is never called
 * cancelled, never has its counters rewritten, and never has its leads touched.
 * ============================================================================
 */

/** Applies the zero-counter condition to a PostgREST query builder. */
function requireEmpty<T>(query: T): T {
  let q = query as unknown as { eq: (column: string, value: number) => unknown }
  for (const counter of ROW_COUNTERS) q = q.eq(counter, 0) as typeof q
  return q as unknown as T
}

export interface SweepResult {
  cancelled: number
  interrupted: number
}

/**
 * Marks abandoned jobs as ended.
 *
 * Every failure here is swallowed: a cleanup routine must never break the thing
 * it was called from. The worst case of a failed sweep is a stale row surviving
 * until the next run.
 *
 * @param scopeToUser when set, only that user's jobs are considered. Used on
 *   the supersede path, where we know one specific person just abandoned a
 *   flow; the scheduled sweep passes nothing and covers everybody.
 */
export async function sweepStaleImportJobs(
  supabase: SupabaseClient,
  options: { scopeToUser?: string; reason?: string } = {},
): Promise<SweepResult> {
  const result: SweepResult = { cancelled: 0, interrupted: 0 }
  const now = Date.now()

  try {
    const validatingCutoff = new Date(now - STALE_VALIDATING_MINUTES * 60_000).toISOString()

    let cancelQuery = supabase
      .from('lead_import_jobs')
      .update({
        status: 'cancelled',
        status_reason: options.reason ?? ABANDONED_REASON,
        completed_at: new Date().toISOString(),
      })
      .eq('status', 'validating')
      .is('completed_at', null)
      .lt('created_at', validatingCutoff)

    // Nothing written — the condition that makes this safe.
    cancelQuery = requireEmpty(cancelQuery)
    if (options.scopeToUser) cancelQuery = cancelQuery.eq('created_by', options.scopeToUser)

    const { data: cancelled, error: cancelError } = await cancelQuery.select('id')
    if (cancelError) throw cancelError
    result.cancelled = cancelled?.length ?? 0

    // Interrupted imports are a different case and get a different label. These
    // DID write leads, so they are recorded as ended rather than cancelled, and
    // their counters are left exactly as they are.
    const importingCutoff = new Date(now - STALE_IMPORTING_HOURS * 3_600_000).toISOString()
    const { data: stalled } = await supabase
      .from('lead_import_jobs')
      .select('id, failed_rows')
      .eq('status', 'importing')
      .is('completed_at', null)
      .lt('created_at', importingCutoff)
      .limit(100)

    for (const job of stalled ?? []) {
      await supabase.from('lead_import_jobs').update({
        status: (job.failed_rows as number ?? 0) > 0 ? 'completed_with_errors' : 'completed',
        status_reason: INTERRUPTED_REASON,
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)
      result.interrupted += 1
    }
  } catch (error) {
    console.error('[import] stale job sweep failed', error instanceof Error ? error.message : 'unknown')
  }

  return result
}

/**
 * Cancels one specific job the operator backed out of.
 *
 * Refuses if the job wrote anything, so a mis-sent request — or a stale button
 * on a tab left open while the import ran to completion elsewhere — cannot
 * relabel a real import.
 */
export async function cancelImportJob(
  supabase: SupabaseClient,
  jobId: string,
  reason: string = BACKED_OUT_REASON,
): Promise<{ ok: boolean; error?: string }> {
  const { data: job } = await supabase
    .from('lead_import_jobs')
    .select('id, status, processed_rows, imported_rows, updated_rows, skipped_rows, failed_rows')
    .eq('id', jobId)
    .maybeSingle()

  if (!job) return { ok: false, error: 'Import not found.' }

  if (!['validating', 'pending'].includes(job.status as string)) {
    return { ok: false, error: 'That import has already started and cannot be cancelled here.' }
  }
  if (!wroteNothing(job as JobCounters)) {
    return { ok: false, error: 'That import has already written rows and was left as it is.' }
  }

  const { error } = await supabase
    .from('lead_import_jobs')
    .update({ status: 'cancelled', status_reason: reason, completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', job.status as string)

  if (error) {
    console.error('[import] cancel failed', error.message)
    return { ok: false, error: 'That import could not be cancelled.' }
  }
  return { ok: true }
}

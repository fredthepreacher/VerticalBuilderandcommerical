import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ABANDONED_REASON, BACKED_OUT_REASON, INTERRUPTED_REASON, STALE_IMPORTING_HOURS,
  STALE_VALIDATING_MINUTES, describeJob, wroteNothing,
  type JobRowForDisplay,
} from '../lib/ops/imports/job-status'

/**
 * ============================================================================
 * IMPORT JOB LIFECYCLE
 * ----------------------------------------------------------------------------
 * A job row is created the moment a preview is requested, before the operator
 * has committed to anything. If they back out, those rows used to sit in Recent
 * Imports as `validating` forever, looking like work in progress that never was.
 *
 * Two things are being protected here, and the second matters more:
 *
 *   1. An abandoned job reaches a terminal state.
 *   2. Cleanup NEVER touches a job that wrote rows, and never touches a lead.
 *      Tidying the history is worth nothing if it can lose an import.
 * ============================================================================
 */

const NOW = Date.parse('2026-08-28T12:00:00Z')
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString()
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString()

const job = (over: Partial<JobRowForDisplay> = {}): JobRowForDisplay => ({
  status: 'validating',
  status_reason: null,
  total_rows: 100,
  processed_rows: 0,
  imported_rows: 0,
  updated_rows: 0,
  skipped_rows: 0,
  failed_rows: 0,
  created_at: minutesAgo(1),
  ...over,
})

// ---------------------------------------------------------------------------
// The safety predicate
// ---------------------------------------------------------------------------

describe('wroteNothing — the condition the whole cleanup rests on', () => {
  it('is true only when every counter is zero', () => {
    expect(wroteNothing({})).toBe(true)
    expect(wroteNothing({ processed_rows: 0, imported_rows: 0 })).toBe(true)
  })

  it('is false if ANY counter moved, including ones that imported nothing', () => {
    // A job that skipped or rejected rows still did work worth keeping a record
    // of, and its counters must never be relabelled as "cancelled, nothing saved".
    for (const counter of [
      'processed_rows', 'imported_rows', 'updated_rows', 'skipped_rows', 'failed_rows',
    ] as const) {
      expect(wroteNothing({ [counter]: 1 }), `${counter} was ignored`).toBe(false)
    }
  })

  it('treats null and undefined as zero rather than throwing', () => {
    expect(wroteNothing({ processed_rows: null, imported_rows: undefined })).toBe(true)
  })

  it('is false for a single imported row', () => {
    // The exact boundary. One lead is enough to make a job real.
    expect(wroteNothing({ imported_rows: 1 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// What the office is told
// ---------------------------------------------------------------------------

describe('a fresh preview reads as in progress, not as a problem', () => {
  it('is "Awaiting import" a minute after it was created', () => {
    const outcome = describeJob(job({ created_at: minutesAgo(1) }), NOW)
    expect(outcome.label).toBe('Awaiting import')
    expect(outcome.tone).toBe('info')
  })

  it('is still awaiting right up to the threshold', () => {
    expect(describeJob(job({ created_at: minutesAgo(STALE_VALIDATING_MINUTES - 1) }), NOW).label)
      .toBe('Awaiting import')
  })
})

describe('an abandoned preview stops looking active', () => {
  it('reads as "Abandoned" once past the threshold', () => {
    const outcome = describeJob(job({ created_at: minutesAgo(STALE_VALIDATING_MINUTES + 1) }), NOW)
    expect(outcome.label).toBe('Abandoned')
    expect(outcome.tone).toBe('neutral')
    expect(outcome.detail).toMatch(/never imported/i)
  })

  it('says so even before a sweep has run — the row does not become abandoned when somebody happens to look', () => {
    const outcome = describeJob(job({ created_at: hoursAgo(48), status: 'validating' }), NOW)
    expect(outcome.label).toBe('Abandoned')
  })

  it('does NOT call an old job abandoned when it actually wrote rows', () => {
    // The sweep leaves such a job alone, so the label has to agree with it.
    // "Never imported" about a job holding 97 leads would send the office off
    // to re-import a file they already have.
    const outcome = describeJob(
      job({ created_at: hoursAgo(72), status: 'validating', processed_rows: 100, imported_rows: 97, failed_rows: 3 }),
      NOW,
    )
    expect(outcome.label).toBe('Interrupted')
    expect(outcome.detail).toMatch(/97 rows imported and saved/i)
    expect(outcome.detail).not.toMatch(/never imported/i)
  })

  it('shows the recorded reason once a sweep has cancelled it', () => {
    const outcome = describeJob(job({ status: 'cancelled', status_reason: ABANDONED_REASON }), NOW)
    expect(outcome.label).toBe('Cancelled')
    expect(outcome.detail).toBe(ABANDONED_REASON)
  })

  it('explains a cancellation even when no reason was stored', () => {
    const outcome = describeJob(job({ status: 'cancelled' }), NOW)
    expect(outcome.detail).toMatch(/nothing was saved/i)
  })
})

describe('a real import is never mistaken for an abandoned one', () => {
  it('reads as importing while it is genuinely in flight', () => {
    const outcome = describeJob(
      job({ status: 'importing', processed_rows: 800, total_rows: 2_000, created_at: minutesAgo(2) }),
      NOW,
    )
    expect(outcome.label).toBe('Importing')
    expect(outcome.tone).toBe('info')
    expect(outcome.detail).toBe('800 of 2,000 rows processed.')
  })

  it('reads as interrupted — never cancelled — when a tab was closed mid-import', () => {
    // These rows landed. Calling this "cancelled" would tell the office nothing
    // was saved, which is false, and would invite them to re-import duplicates.
    const outcome = describeJob(
      job({ status: 'importing', processed_rows: 800, imported_rows: 780, total_rows: 2_000, created_at: hoursAgo(9) }),
      NOW,
    )
    expect(outcome.label).toBe('Interrupted')
    expect(outcome.label).not.toBe('Cancelled')
    expect(outcome.detail).toMatch(/780 rows imported and saved/i)
  })

  it('says a completed import completed', () => {
    const outcome = describeJob(
      job({ status: 'completed', processed_rows: 100, imported_rows: 100, total_rows: 100 }),
      NOW,
    )
    expect(outcome.label).toBe('Completed')
    expect(outcome.tone).toBe('ok')
  })

  it('distinguishes a completed import that ended early', () => {
    const outcome = describeJob(
      job({ status: 'completed', processed_rows: 40, imported_rows: 40, total_rows: 100 }),
      NOW,
    )
    expect(outcome.label).toBe('Ended early')
    expect(outcome.detail).toMatch(/40 of 100/)
  })

  it('reports rejected rows on a partial success', () => {
    const outcome = describeJob(
      job({ status: 'completed_with_errors', processed_rows: 100, imported_rows: 97, failed_rows: 3, total_rows: 100 }),
      NOW,
    )
    expect(outcome.label).toBe('Completed with errors')
    expect(outcome.detail).toMatch(/3 rows rejected/i)
  })

  it('gets the singular right on one rejected row', () => {
    expect(describeJob(job({ status: 'completed_with_errors', failed_rows: 1 }), NOW).detail)
      .toMatch(/^1 row rejected/)
  })

  it('marks a failure as a failure', () => {
    const outcome = describeJob(job({ status: 'failed' }), NOW)
    expect(outcome.tone).toBe('bad')
  })

  it('never returns an empty label, whatever the status', () => {
    for (const status of [
      'pending', 'validating', 'importing', 'completed', 'completed_with_errors',
      'failed', 'cancelled', 'something_unexpected',
    ]) {
      const outcome = describeJob(job({ status }), NOW)
      expect(outcome.label.length, `${status} has no label`).toBeGreaterThan(0)
    }
  })

  it('never shows a raw enum with underscores', () => {
    expect(describeJob(job({ status: 'completed_with_errors' }), NOW).label).not.toMatch(/_/)
    expect(describeJob(job({ status: 'a_weird_status' }), NOW).label).not.toMatch(/_/)
  })
})

describe('the thresholds are set where a person would set them', () => {
  it('gives a preview long enough that nobody loses one to a coffee break', () => {
    expect(STALE_VALIDATING_MINUTES).toBeGreaterThanOrEqual(30)
  })

  it('gives an in-flight import far longer than the biggest file could need', () => {
    // 50,000 rows at 400 per request is ~125 requests. Minutes, not hours.
    expect(STALE_IMPORTING_HOURS).toBeGreaterThanOrEqual(2)
    expect(STALE_IMPORTING_HOURS * 60).toBeGreaterThan(STALE_VALIDATING_MINUTES)
  })
})

// ---------------------------------------------------------------------------
// The sweep, read as code
// ---------------------------------------------------------------------------

describe('the cleanup cannot damage anything', () => {
  const lifecycle = readFileSync(join(process.cwd(), 'lib/ops/imports/job-lifecycle.ts'), 'utf8')

  it('never deletes a job', () => {
    expect(lifecycle).not.toMatch(/\.delete\s*\(/)
  })

  it('never touches the leads table', () => {
    // The one thing that would make this feature worse than the bug it fixes.
    expect(lifecycle).not.toMatch(/from\(['"]leads['"]\)/)
    expect(lifecycle).not.toMatch(/lead_import_errors/)
  })

  it('only ever considers jobs still in a non-terminal state', () => {
    expect(lifecycle).toMatch(/\.eq\('status', 'validating'\)/)
    expect(lifecycle).toMatch(/\.eq\('status', 'importing'\)/)
    expect(lifecycle).not.toMatch(/\.eq\('status', 'completed'\)/)
  })

  it('requires every row counter to be zero before cancelling', () => {
    expect(lifecycle).toMatch(/requireEmpty\(cancelQuery\)/)
  })

  it('requires an age cutoff on both paths', () => {
    const cutoffs = lifecycle.match(/\.lt\('created_at'/g) ?? []
    expect(cutoffs.length).toBe(2)
  })

  it('will not cancel a job that already completed', () => {
    expect(lifecycle).toMatch(/\.is\('completed_at', null\)/)
  })

  it('swallows its own failures — a broken sweep must not break the caller', () => {
    expect(lifecycle).toMatch(/catch \(error\)/)
    expect(lifecycle).toMatch(/stale job sweep failed/)
  })

  it('an interrupted import keeps its counters and is not called cancelled', () => {
    // Bounded to the sweep's own interrupted branch — `cancelImportJob` further
    // down the file legitimately sets 'cancelled', for a job that wrote nothing.
    const start = lifecycle.indexOf('Interrupted imports are a different case')
    const interrupted = lifecycle.slice(start, lifecycle.indexOf('} catch (error)', start))
    expect(interrupted).toMatch(/completed_with_errors/)
    expect(interrupted).not.toMatch(/status: 'cancelled'/)
    // And nothing in this branch rewrites a counter.
    for (const counter of ['imported_rows', 'processed_rows', 'failed_rows']) {
      expect(interrupted).not.toMatch(new RegExp(`${counter}:`))
    }
  })
})

describe('cancelling one job by hand', () => {
  const lifecycle = readFileSync(join(process.cwd(), 'lib/ops/imports/job-lifecycle.ts'), 'utf8')

  it('refuses a job that has already started', () => {
    expect(lifecycle).toMatch(/\['validating', 'pending'\]\.includes/)
  })

  it('refuses a job that wrote rows', () => {
    // Guards a stale beacon arriving after the import ran to completion.
    expect(lifecycle).toMatch(/if \(!wroteNothing\(job as JobCounters\)\)/)
  })

  it('writes the status conditionally, so a race cannot overwrite a finished job', () => {
    expect(lifecycle).toMatch(/\.eq\('status', job\.status as string\)/)
  })
})

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('all three layers are wired up', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('1. the wizard cancels the job it created when the operator backs out', () => {
    const wizard = read('components/ops/LeadImportWizard.tsx')
    expect(wizard).toMatch(/cancelPendingJob\(importJobId\)/)
    expect(wizard).toMatch(/method: 'DELETE'/)
  })

  it('1b. and on a closed tab, via a beacon', () => {
    const wizard = read('components/ops/LeadImportWizard.tsx')
    expect(wizard).toMatch(/navigator\.sendBeacon/)
    expect(wizard).toMatch(/'pagehide'/)
  })

  it('1c. but stops treating the job as pending the moment importing starts', () => {
    const wizard = read('components/ops/LeadImportWizard.tsx')
    const runImport = wizard.slice(wizard.indexOf('async function runImport'))
    expect(runImport.slice(0, 400)).toMatch(/pendingJobRef\.current = null/)
  })

  it('2. starting a new import supersedes this user’s abandoned ones', () => {
    const validate = read('app/api/leads/import/validate/route.ts')
    expect(validate).toMatch(/sweepStaleImportJobs\(supabase, \{ scopeToUser: user\.id/)
  })

  it('2b. scoped to the user, so it cannot reach across accounts', () => {
    const lifecycle = read('lib/ops/imports/job-lifecycle.ts')
    expect(lifecycle).toMatch(/if \(options\.scopeToUser\) cancelQuery = cancelQuery\.eq\('created_by', options\.scopeToUser\)/)
  })

  it('3. the daily cron sweeps whatever the first two missed', () => {
    const cron = read('app/api/cron/compliance-reminders/route.ts')
    expect(cron).toMatch(/sweepStaleImportJobs\(admin\)/)
    expect(cron).toMatch(/staleImportJobs/)
  })

  it('the cancel endpoint is permission-gated like the rest of the importer', () => {
    const route = read('app/api/leads/import/[id]/route.ts')
    expect(route).toMatch(/export async function DELETE/)
    const del = route.slice(route.indexOf('export async function DELETE'))
    expect(del).toMatch(/user\.can\('leadsImport'\)/)
    expect(del).toMatch(/status: 403/)
  })

  it('sendBeacon can only POST, so POST reuses the same implementation', () => {
    const route = read('app/api/leads/import/[id]/route.ts')
    expect(route).toMatch(/export async function POST[\s\S]{0,200}return DELETE\(/)
  })
})

describe('migration 0013', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0013_import_job_lifecycle.sql'), 'utf8')

  it('is additive — it deletes nothing', () => {
    expect(sql).not.toMatch(/delete from/i)
    expect(sql).not.toMatch(/drop table/i)
    expect(sql).not.toMatch(/drop column/i)
    expect(sql).not.toMatch(/truncate/i)
  })

  it('never touches the leads table', () => {
    expect(sql).not.toMatch(/\bpublic\.leads\b/)
  })

  it('only relabels jobs that wrote nothing', () => {
    const cleanup = sql.slice(sql.indexOf("set status = 'cancelled'"))
    for (const counter of ['processed_rows', 'imported_rows', 'updated_rows', 'skipped_rows', 'failed_rows']) {
      expect(cleanup, `${counter} is not checked`).toMatch(new RegExp(`coalesce\\(${counter}, 0\\) = 0`))
    }
  })

  it('only relabels jobs old enough to be certainly abandoned', () => {
    expect(sql).toMatch(/created_at < now\(\) - interval '1 hour'/)
    expect(sql).toMatch(/created_at < now\(\) - interval '6 hours'/)
  })

  it('leaves a completed job alone', () => {
    expect(sql).toMatch(/completed_at is null/)
  })

  it('does not call a partial import "cancelled"', () => {
    const interrupted = sql.slice(sql.indexOf("where status = 'importing'") - 600)
    expect(interrupted).toMatch(/completed_with_errors/)
    expect(interrupted).not.toMatch(/set status = 'cancelled'/)
  })

  it('adds the reason column re-runnably', () => {
    expect(sql).toMatch(/add column if not exists status_reason text/)
  })

  it('does not weaken RLS or grant anything to anon', () => {
    expect(sql).not.toMatch(/disable row level security/i)
    expect(sql).not.toMatch(/grant[^\n]*to anon/i)
  })
})

describe('the Import leads button', () => {
  const page = readFileSync(join(process.cwd(), 'app/ops/(app)/leads/page.tsx'), 'utf8')

  it('is on the leads page and points at the importer', () => {
    expect(page).toMatch(/href="\/ops\/leads\/import"/)
    expect(page).toMatch(/Import leads/)
  })

  it('sits with the other page actions and uses the standard button style', () => {
    const actions = page.slice(page.indexOf('ops-page-actions'), page.indexOf('ops-page-actions') + 900)
    expect(actions).toMatch(/Import leads/)
    expect(actions).toMatch(/className="ops-btn"/)
  })

  it('is only shown to an account that may actually import', () => {
    // Offering a button that answers with a permission wall is worse than not
    // offering it.
    expect(page).toMatch(/user\.can\('leadsImport'\) && \(/)
  })

  it('is also offered from the empty state, where someone has a list in hand', () => {
    expect(page).toMatch(/secondaryHref=\{user\.can\('leadsImport'\) \? '\/ops\/leads\/import'/)
  })
})

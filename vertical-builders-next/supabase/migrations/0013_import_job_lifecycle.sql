-- ============================================================================
-- Vertical Ops — Migration 0013: import job lifecycle
-- ----------------------------------------------------------------------------
-- A `lead_import_jobs` row is created the moment the operator asks for a
-- preview, before they have committed to anything. If they then back out, pick
-- a different file, or simply close the tab, that row stayed `validating`
-- forever and sat at the top of Recent Imports looking like work in progress.
--
-- Nothing was ever wrong with the DATA — those jobs imported nothing. The
-- problem is that the CRM was telling the office something untrue about its own
-- state, which is the kind of small lie that erodes trust in the whole screen.
--
-- This migration adds a reason column and cleans up the rows that already
-- exist. The application-side prevention lives in lib/ops/imports/job-lifecycle.ts.
--
-- Additive and non-destructive: no job is deleted, no lead is touched, and no
-- job that imported anything is relabelled.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Why a job ended the way it did
-- ---------------------------------------------------------------------------
alter table public.lead_import_jobs
  add column if not exists status_reason text;

comment on column public.lead_import_jobs.status_reason is
  'Plain-language explanation shown beside the status in Recent Imports, e.g. '
  '"Abandoned before importing". Null for a job that finished normally.';

-- The sweep filters on (status, created_at); this keeps it an index scan rather
-- than a table scan once the company has a few thousand imports behind them.
create index if not exists idx_import_jobs_status_created
  on public.lead_import_jobs (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. One-time cleanup of jobs that are already stuck
-- ---------------------------------------------------------------------------
-- Deliberately conservative. Every one of these conditions must hold:
--
--   · status is still 'validating'      — it never reached the importing phase
--   · every row counter is zero         — nothing was written, so nothing is lost
--   · completed_at is null              — it was never finished
--   · created_at is over an hour old    — far longer than any real preview
--
-- A job that imported even one row fails the second condition and is left
-- exactly as it is. An import genuinely in flight is 'importing', not
-- 'validating', so it is not a candidate either.
update public.lead_import_jobs
   set status = 'cancelled',
       status_reason = 'Abandoned before importing — cleaned up automatically.',
       completed_at = coalesce(completed_at, now())
 where status = 'validating'
   and coalesce(processed_rows, 0) = 0
   and coalesce(imported_rows, 0) = 0
   and coalesce(updated_rows, 0) = 0
   and coalesce(skipped_rows, 0) = 0
   and coalesce(failed_rows, 0) = 0
   and completed_at is null
   and created_at < now() - interval '1 hour';

-- ---------------------------------------------------------------------------
-- 3. Interrupted imports — separate case, separate treatment
-- ---------------------------------------------------------------------------
-- A job stuck in 'importing' DID write leads before the tab was closed. Calling
-- that "cancelled" would be false, and deleting the leads it created would be
-- worse. It is marked as ended, with the reason saying what happened; the row
-- counters on screen show exactly how far it got.
update public.lead_import_jobs
   set status = case when coalesce(failed_rows, 0) > 0 then 'completed_with_errors' else 'completed' end,
       status_reason = 'Interrupted before finishing — the rows already imported were saved.',
       completed_at = coalesce(completed_at, now())
 where status = 'importing'
   and completed_at is null
   and created_at < now() - interval '6 hours';

-- No RLS change. `lead_import_jobs` already has RLS enabled and forced, and the
-- new column inherits the existing policies. Anonymous access is unchanged.

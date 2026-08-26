-- ============================================================================
-- Vertical Ops — Migration 0010: Data API grants
-- ----------------------------------------------------------------------------
-- Fixes a real production failure found while connecting the first Supabase
-- project: the dashboard rendered completely blank.
--
-- Cause: migrations 0001–0009 create tables, enable RLS and write policies, but
-- never GRANT anything to the `authenticated` role. Supabase normally papers
-- over that with its "Automatically expose new tables" project setting, which
-- issues those grants for you. That setting was disabled when this project was
-- created, so `authenticated` had row-level *policies* permitting access and no
-- table-level *privileges* to exercise them. PostgREST returned permission
-- errors for every query and every screen came back empty.
--
-- Relying on a project-level toggle for something the schema depends on was the
-- mistake. The grants belong in the migration, so any future Supabase project —
-- staging, a rebuild, a restored backup — comes up working regardless of how
-- that toggle is set.
--
-- ---------------------------------------------------------------------------
-- THIS DOES NOT WEAKEN SECURITY
-- ---------------------------------------------------------------------------
-- Grants and RLS are two independent gates and a query must pass BOTH.
--
--   GRANT  — "this role may issue this kind of statement against this table"
--   RLS    — "and these are the rows it may actually touch"
--
-- RLS is enabled AND FORCED on all 36 public tables, so granting `authenticated`
-- table privileges changes nothing about which rows anyone can see. Every
-- policy written in 0002, 0006 and 0009 still applies in full:
--   * the auditor (read_only) still gets zero job_costs rows
--   * project-manager cost visibility still follows app_settings
--   * payments, insurance_policies and the other history tables still have no
--     DELETE policy, so nobody can delete from them
--
-- `anon` is explicitly revoked here, exactly as in 0002 and 0006. Nothing public
-- needs it: website lead intake, the COI upload endpoint and the vendor upload
-- portal all run through the service-role client, and the browser client is
-- used only for sign-in and sign-out.
--
-- Additive and idempotent. No table, column, policy or function is changed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema access
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Privileges on everything that exists today
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

-- Needed by project_number_seq, estimate_number_seq and invoice_number_seq:
-- without USAGE the column defaults that call nextval() fail on insert, so a
-- new project, estimate or invoice cannot be created at all.
grant usage, select
  on all sequences in schema public
  to authenticated, service_role;

grant execute
  on all functions in schema public
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Privileges on everything created from now on
-- ---------------------------------------------------------------------------
-- Step 2 only touches objects that exist at the moment it runs. Without this
-- block, the very next migration that adds a table would reintroduce the same
-- blank-screen bug, and it would again look like an application fault rather
-- than a missing grant. Default privileges apply to objects created by the role
-- running the migration, which in the Supabase SQL editor is `postgres`.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Anonymous access stays closed
-- ---------------------------------------------------------------------------
-- Restated from 0002 and 0006 so this migration is self-contained: reading it
-- tells you the whole grant position without cross-referencing two other files.
-- The default-privileges revokes keep future tables closed to anon too.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

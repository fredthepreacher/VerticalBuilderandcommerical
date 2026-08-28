-- ============================================================================
-- Vertical Ops — Migration 0012: Property Prospects
-- ----------------------------------------------------------------------------
-- Storm lists, canvassing routes and door-knocking sheets arrive as addresses
-- with no contact details. Those are real prospects and the CRM should hold
-- them, so this migration lets a lead exist on the strength of a property
-- address alone.
--
-- The important decision: `first_name` becomes nullable, but the RULE IT WAS
-- ENFORCING DOES NOT GO AWAY. It moves into a CHECK constraint that says a lead
-- must be identifiable by SOMETHING — a name, a company, or a property address.
-- Dropping the NOT NULL without that would let a genuinely empty row into the
-- pipeline, which is the failure this whole feature has to avoid.
--
-- Additive and non-destructive: no column is dropped, no data is rewritten,
-- and every existing lead keeps the record type it always effectively had.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Record type
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists record_type text not null default 'contact_lead';

do $$
begin
  alter table public.leads drop constraint if exists leads_record_type_check;
  alter table public.leads add constraint leads_record_type_check
    check (record_type in ('contact_lead', 'property_prospect'));
end $$;

comment on column public.leads.record_type is
  'contact_lead = came in with a name/phone/email. property_prospect = imported from an address list. '
  'This records PROVENANCE and does not change when the prospect is later enriched with a name — the '
  'record simply starts displaying the name instead of the address.';

-- ---------------------------------------------------------------------------
-- 2. Canvassing fields
-- ---------------------------------------------------------------------------
-- Text, not integer: real route sheets number stops "1", "12A", "R4-07".
alter table public.leads add column if not exists stop_number       text;
alter table public.leads add column if not exists import_batch_tag  text;

comment on column public.leads.stop_number is
  'Stop / route number from a canvassing list. Free text — route sheets are not always numeric.';
comment on column public.leads.import_batch_tag is
  'Campaign or batch label, e.g. "Storm List Aug 2026". Also written into source_metadata for history, '
  'but promoted to a real column so the lead list can filter on it without scanning jsonb.';

-- ---------------------------------------------------------------------------
-- 3. first_name becomes nullable — and the rule moves, it does not vanish
-- ---------------------------------------------------------------------------
alter table public.leads alter column first_name drop not null;

do $$
begin
  alter table public.leads drop constraint if exists leads_identifiable_check;
  alter table public.leads add constraint leads_identifiable_check check (
    coalesce(nullif(trim(first_name),   ''), '') <> ''
    or coalesce(nullif(trim(last_name),    ''), '') <> ''
    or coalesce(nullif(trim(company_name), ''), '') <> ''
    or coalesce(nullif(trim(property_address), ''), '') <> ''
  );
end $$;

comment on constraint leads_identifiable_check on public.leads is
  'A lead must be identifiable by something. Replaces the old first_name NOT NULL: a property '
  'prospect is identified by its address, a contact lead by a name. A row with neither is not a '
  'lead, it is an empty row, and the database refuses it.';

-- ---------------------------------------------------------------------------
-- 4. Canvassing pipeline stages
-- ---------------------------------------------------------------------------
-- Three additions to the EXISTING stage list rather than a parallel status
-- system for prospects. The rest of the canvassing workflow already has a home:
--   Appointment Set    → consultation_scheduled
--   Estimate Scheduled → estimate_in_progress
--   Contacted/Follow-Up/Won/Lost → the stages of those names
--   Assigned           → the assigned_to column, which is not a stage
do $$
begin
  alter table public.leads drop constraint if exists leads_pipeline_stage_check;
  alter table public.leads add constraint leads_pipeline_stage_check
    check (pipeline_stage in (
      'new', 'needs_contact_info', 'door_knocked', 'contact_attempted', 'contacted',
      'consultation_scheduled', 'inspection_complete', 'estimate_in_progress',
      'estimate_sent', 'follow_up', 'won', 'lost', 'do_not_contact'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Address normalisation, for duplicate detection
-- ---------------------------------------------------------------------------
-- "4386 Sibley Bay Street", "4386 Sibley Bay St" and "4386 SIBLEY BAY ST" are
-- one house. Without this, a second import of the same storm list produces a
-- second copy of every property on it.
--
-- IMMUTABLE so it can back a generated column, which means existing rows are
-- normalised automatically and the value can never drift out of sync with the
-- address it came from.
--
-- `lib/ops/imports/address.ts` implements the identical algorithm in TypeScript
-- so the browser can flag within-file duplicates before anything is sent. The
-- two are checked against each other in the migration verification harness —
-- if they ever disagree, duplicates get missed silently, which is why they are
-- tested together rather than trusted.
create or replace function public.normalize_address(street text, postal text default null)
returns text
language sql
immutable
as $$
  -- A ZIP with no street is not a key: two different houses in 33980 are two
  -- different houses. The street must survive normalisation for a key to exist;
  -- the ZIP only ever disambiguates one.
  with canonical as (
    select nullif(trim(
      regexp_replace(
        -- Suffixes and directionals, canonicalised to their short form.
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
          -- Lowercase, drop punctuation, collapse whitespace.
          regexp_replace(regexp_replace(lower(coalesce(street, '')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'),
          '\mstreet\M',     'st',   'g'),
          '\mavenue\M',     'ave',  'g'),
          '\mav\M',         'ave',  'g'),
          '\mroad\M',       'rd',   'g'),
          '\mdrive\M',      'dr',   'g'),
          '\mlane\M',       'ln',   'g'),
          '\mboulevard\M',  'blvd', 'g'),
          '\mcourt\M',      'ct',   'g'),
          '\mcircle\M',     'cir',  'g'),
          '\mplace\M',      'pl',   'g'),
          '\mterrace\M',    'ter',  'g'),
          '\mterr\M',       'ter',  'g'),
          '\mparkway\M',    'pkwy', 'g'),
          '\mhighway\M',    'hwy',  'g'),
          '\mtrail\M',      'trl',  'g'),
          '\msquare\M',     'sq',   'g'),
          '\mpoint\M',      'pt',   'g'),
          '\mridge\M',      'rdg',  'g'),
          '\mcrossing\M',   'xing', 'g'),
          '\mnortheast\M',  'ne',   'g'),
          '\mnorthwest\M',  'nw',   'g'),
          '\msoutheast\M',  'se',   'g'),
          '\msouthwest\M',  'sw',   'g'),
          '\mnorth\M',      'n',    'g'),
          '\msouth\M',      's',    'g'),
          '\meast\M',       'e',    'g'),
          '\mwest\M',       'w',    'g'),
          '\mapartment\M',  'apt',  'g'),
          '\msuite\M',      'ste',  'g'),
          '\mnumber\M',     'no',   'g')
      , '\s+', ' ', 'g')
    ), '') as street
  )
  select case
    when street is null then null
    when coalesce(postal, '') <> ''
      then street || ' ' || substring(regexp_replace(postal, '\D', '', 'g') from 1 for 5)
    else street
  end
  from canonical;
$$;

comment on function public.normalize_address(text, text) is
  'Canonical form of a street address, used only for duplicate detection. Never displayed. '
  'Mirrored by normalizeAddress() in lib/ops/imports/address.ts.';

-- The generated column: always correct, never stale, indexable.
alter table public.leads
  add column if not exists address_key text
  generated always as (public.normalize_address(property_address, zip)) stored;

comment on column public.leads.address_key is
  'Generated. The normalised property address used as the duplicate key for property prospects. '
  'Never shown to a user and never written to directly.';

-- Partial: only rows that actually have an address, and only live ones.
create index if not exists idx_leads_address_key
  on public.leads (address_key) where address_key is not null and archived_at is null;

create index if not exists idx_leads_record_type on public.leads (record_type, created_at desc);
create index if not exists idx_leads_batch_tag   on public.leads (import_batch_tag) where import_batch_tag is not null;
create index if not exists idx_leads_zip         on public.leads (zip) where zip is not null;
create index if not exists idx_leads_city        on public.leads (city) where city is not null;

-- ---------------------------------------------------------------------------
-- 5b. The import job records which mode it ran in
-- ---------------------------------------------------------------------------
-- Auditability: months later, "why does this lead have no phone number" is
-- answered by the job that created it, not by guesswork.
alter table public.lead_import_jobs
  add column if not exists import_mode text not null default 'standard';

do $$
begin
  alter table public.lead_import_jobs drop constraint if exists lead_import_jobs_mode_check;
  alter table public.lead_import_jobs add constraint lead_import_jobs_mode_check
    check (import_mode in ('standard', 'property_prospect'));
end $$;

alter table public.lead_import_jobs
  add column if not exists needs_review_rows integer not null default 0;

alter table public.lead_import_jobs
  add column if not exists lead_source text;

-- ---------------------------------------------------------------------------
-- 6. Backfill the batch tag for imports that already ran
-- ---------------------------------------------------------------------------
-- Previous imports stored the tag inside source_metadata. Promoting it keeps
-- the new filter honest for batches imported before this migration.
update public.leads
   set import_batch_tag = source_metadata->>'import_tag'
 where import_batch_tag is null
   and coalesce(source_metadata->>'import_tag', '') <> '';

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
-- 0010's default privileges cover new tables, not new functions on an existing
-- one. Restating costs nothing.
grant execute on function public.normalize_address(text, text) to authenticated, service_role;
revoke all on function public.normalize_address(text, text) from anon;

-- No RLS change: `leads` already has RLS enabled and forced, and the new
-- columns inherit the existing policies. Anonymous access is unchanged.

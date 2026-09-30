-- ============================================================================
-- Vertical Ops — Migration 0016: Roof Prospecting enrichment (Phase 2)
-- ----------------------------------------------------------------------------
-- Additive only. Adds the columns the enrichment/screening layer needs and one
-- small provider-lookup cache table. No existing column, policy or function is
-- changed except two CHECKs that are WIDENED (never narrowed):
--   · lead_import_jobs.kind gains 'enrichment'
--   · (roof_prospects.status already covers every screening outcome from 0015)
--
-- Design decisions carried from the approved Phase 2 architecture:
--   · Reuse roof_measurements as the home for every measurement, prospect ones
--     included — link it to a prospect rather than inventing a parallel table.
--   · A measurement's TRUSTWORTHINESS (type + confidence) is stored next to the
--     geometry, so a footprint estimate can never be mistaken for a verified
--     roof surface.
--   · Auto-qualify is OFF by default and per-campaign — the column exists so it
--     can be turned on later, but launch leaves it false.
--   · Nothing here fabricates a measurement, a roof age, or a dollar cost.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. roof_measurements — link to prospects + trustworthiness + footprint
-- ---------------------------------------------------------------------------
alter table public.roof_measurements
  add column if not exists roof_prospect_id uuid references public.roof_prospects(id) on delete set null;

-- How much to trust this measurement. NULL until assessed.
--   verified_roof_surface — a provider measured the roof (e.g. EagleView)
--   provider_estimate     — AI/model-derived roof surface (e.g. Nearmap)
--   building_footprint     — footprint only; NOT a roof surface, needs review
--   manual                — a person measured or uploaded it
alter table public.roof_measurements add column if not exists measurement_type text;
do $$
begin
  alter table public.roof_measurements drop constraint if exists roof_measurements_type_check;
  alter table public.roof_measurements add constraint roof_measurements_type_check
    check (measurement_type is null or measurement_type in
      ('verified_roof_surface', 'provider_estimate', 'building_footprint', 'manual'));
end $$;

alter table public.roof_measurements add column if not exists confidence_band text;
do $$
begin
  alter table public.roof_measurements drop constraint if exists roof_measurements_confidence_band_check;
  alter table public.roof_measurements add constraint roof_measurements_confidence_band_check
    check (confidence_band is null or confidence_band in ('high', 'medium', 'low'));
end $$;

-- Human-readable evidence behind the confidence band. Never a black-box number.
alter table public.roof_measurements add column if not exists confidence_reasons jsonb not null default '[]'::jsonb;
-- Footprint kept distinct from roof surface so the two can never be conflated.
alter table public.roof_measurements add column if not exists building_footprint_sqft numeric
  check (building_footprint_sqft is null or building_footprint_sqft >= 0);

create index if not exists idx_roof_measurements_prospect
  on public.roof_measurements (roof_prospect_id) where roof_prospect_id is not null;

-- ---------------------------------------------------------------------------
-- 2. roof_prospects — enrichment stage + permit classification + confidence
-- ---------------------------------------------------------------------------
-- Which enrichment stage a prospect has reached, for resumable jobs.
alter table public.roof_prospects add column if not exists enrichment_stage text not null default 'not_started';
do $$
begin
  alter table public.roof_prospects drop constraint if exists roof_prospects_enrichment_stage_check;
  alter table public.roof_prospects add constraint roof_prospects_enrichment_stage_check
    check (enrichment_stage in
      ('not_started', 'address_resolution', 'permit_classification', 'measurement', 'screening', 'finalized'));
end $$;
alter table public.roof_prospects add column if not exists enriched_at timestamptz;

-- Deterministic permit classification (§4). Source text stays in permit_description.
alter table public.roof_prospects add column if not exists permit_class text;
do $$
begin
  alter table public.roof_prospects drop constraint if exists roof_prospects_permit_class_check;
  alter table public.roof_prospects add constraint roof_prospects_permit_class_check
    check (permit_class is null or permit_class in
      ('full_replacement', 'recover', 'repair', 'inspection', 'solar_roof', 'unknown_roof', 'not_roof'));
end $$;
alter table public.roof_prospects add column if not exists permit_class_source text;

-- Screening confidence band + its evidence (distinct from the measurement's).
-- Named confidence_band because 0015 already defined a numeric `confidence`
-- (0..1) on this table; the band is the user-facing HIGH/MEDIUM/LOW.
alter table public.roof_prospects add column if not exists confidence_band text;
do $$
begin
  alter table public.roof_prospects drop constraint if exists roof_prospects_confidence_band_check;
  alter table public.roof_prospects add constraint roof_prospects_confidence_band_check
    check (confidence_band is null or confidence_band in ('high', 'medium', 'low'));
end $$;
alter table public.roof_prospects add column if not exists confidence_reasons jsonb not null default '[]'::jsonb;
-- The rule/values used to reach final billable squares, for provenance.
alter table public.roof_prospects add column if not exists waste_rule_applied text;

create index if not exists idx_roof_prospects_enrichment_stage
  on public.roof_prospects (enrichment_stage, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. prospecting_campaigns — provider + auto-qualify + cost caps
-- ---------------------------------------------------------------------------
-- Per-campaign measurement provider override (else global default). NULL = default.
alter table public.prospecting_campaigns add column if not exists measurement_provider text;
-- Auto-qualify for mailing. OFF by default and left off at launch (client decision):
-- the engine may auto-DISQUALIFY on high-confidence rules but never auto-qualify
-- until a human turns this on for a campaign it trusts.
alter table public.prospecting_campaigns add column if not exists auto_qualify_enabled boolean not null default false;
-- Spend guards. NULL = no cap. Counts of PAID measurement lookups.
alter table public.prospecting_campaigns add column if not exists per_batch_measurement_cap integer
  check (per_batch_measurement_cap is null or per_batch_measurement_cap >= 0);
alter table public.prospecting_campaigns add column if not exists per_campaign_measurement_cap integer
  check (per_campaign_measurement_cap is null or per_campaign_measurement_cap >= 0);

-- ---------------------------------------------------------------------------
-- 4. lead_import_jobs.kind gains 'enrichment' (widened, never narrowed)
-- ---------------------------------------------------------------------------
do $$
begin
  alter table public.lead_import_jobs drop constraint if exists lead_import_jobs_kind_check;
  alter table public.lead_import_jobs add constraint lead_import_jobs_kind_check
    check (kind in ('lead', 'roof_prospect', 'enrichment'));
end $$;

-- ---------------------------------------------------------------------------
-- 5. provider_lookup_cache — cross-batch reuse + cost control
-- ---------------------------------------------------------------------------
-- Caches normalized results of provider lookups (geocode / parcel / permit /
-- measurement) keyed by a stable lookup key so a second batch over the same
-- county does not pay to resolve the same address twice, and a retry never
-- double-charges. Stores NORMALIZED derived data + minimal provenance — not raw
-- provider payloads or imagery, whose retention rights are unconfirmed.
create table if not exists public.provider_lookup_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  lookup_type text not null check (lookup_type in ('geocode', 'parcel', 'permit', 'measurement')),
  lookup_key text not null,
  result jsonb not null default '{}'::jsonb,
  source_record_id text,
  source_captured_at timestamptz,
  fetched_at timestamptz not null default now(),
  -- NULL = does not expire (e.g. a parcel geocode). Set for data that goes stale.
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_provider_lookup
  on public.provider_lookup_cache (provider, lookup_type, lookup_key);
create index if not exists idx_provider_lookup_expires
  on public.provider_lookup_cache (expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.provider_lookup_cache enable row level security;
alter table public.provider_lookup_cache force  row level security;

-- Cache is staff infrastructure: readable by staff, written by staff/server.
drop policy if exists provider_lookup_select on public.provider_lookup_cache;
create policy provider_lookup_select on public.provider_lookup_cache
  for select using (public.can_read());
drop policy if exists provider_lookup_write on public.provider_lookup_cache;
create policy provider_lookup_write on public.provider_lookup_cache
  for all using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.provider_lookup_cache to authenticated, service_role;
revoke all on public.provider_lookup_cache from anon;

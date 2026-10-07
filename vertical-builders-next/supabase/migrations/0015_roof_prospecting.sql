-- ============================================================================
-- Vertical Ops — Migration 0015: Roof Prospecting foundation (Phase 1)
-- ----------------------------------------------------------------------------
-- Turns raw county roofing-permit spreadsheets into screened, measurable,
-- estimate-ready prospects. Additive only: no existing table, column, policy or
-- function is changed except one CHECK that is WIDENED (estimate line source),
-- and pricebook_items which only GAINS lifecycle columns.
--
-- Design notes:
--   · roof_prospects is deliberately separate from leads. A prospect is a
--     property being screened; it becomes a lead only when qualified and
--     converted (converted_lead_id). Keeping them apart is what lets the funnel
--     report "imported vs real" without polluting the sales pipeline.
--   · The dedupe key reuses the SAME public.normalize_address() that backs
--     leads.address_key (migration 0012), so a prospect and an existing lead
--     that are the same house produce the same key and can be matched.
--   · Nothing here fabricates a measurement or a price. Squares are null until a
--     real measurement lands; billable squares are derived only when present.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Campaigns — reusable per-county / per-source configuration (§14)
-- ---------------------------------------------------------------------------
create table if not exists public.prospecting_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  county text,
  data_source text,
  -- Empty array = accept all roof types. Otherwise an allow-list, e.g. {shingle}.
  roof_types text[] not null default '{}',
  permit_date_from date,
  permit_date_to date,
  -- A roof at least this old is a potential opportunity; newer is low-priority.
  min_roof_age_years numeric check (min_roof_age_years is null or min_roof_age_years >= 0),
  -- Waste rule is configurable, never a hard-coded "+2". §6/D.
  waste_rule_type text not null default 'percent'
    check (waste_rule_type in ('percent', 'fixed_squares', 'minimum', 'none')),
  waste_rule_value numeric check (waste_rule_value is null or waste_rule_value >= 0),
  waste_min_squares numeric check (waste_min_squares is null or waste_min_squares >= 0),
  -- Pricing/paperwork this campaign applies when generating estimates.
  pricebook_service_type text,
  proposal_template_id uuid references public.estimate_proposal_templates(id) on delete set null,
  default_batch_size integer not null default 60 check (default_batch_size between 1 and 500),
  mail_tag text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  alter table public.prospecting_campaigns drop constraint if exists prospecting_campaigns_name_check;
  alter table public.prospecting_campaigns add constraint prospecting_campaigns_name_check
    check (length(trim(name)) between 1 and 120);
end $$;

create index if not exists idx_campaigns_active on public.prospecting_campaigns (active, created_at desc);

drop trigger if exists set_updated_at on public.prospecting_campaigns;
create trigger set_updated_at before update on public.prospecting_campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Roof prospects — one row per property being screened (§13)
-- ---------------------------------------------------------------------------
create table if not exists public.roof_prospects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.prospecting_campaigns(id) on delete set null,
  import_job_id uuid references public.lead_import_jobs(id) on delete set null,
  source_row integer,

  status text not null default 'imported' check (status in (
    'imported','normalizing','duplicate','enrichment_pending','enriched',
    'review_required','qualified',
    'disqualified_new_roof','disqualified_wrong_roof_type','disqualified_bad_address',
    'manual_measurement_required','crm_created','estimate_ready','document_ready',
    'printed','mailed','responded','appointment','sold','no_response','error'
  )),

  -- Owner + PROPERTY address (the roof).
  owner_name text,
  property_address text,
  city text,
  state text default 'FL',
  zip text,

  -- MAILING address, kept distinct from the property (§11/§22). May differ.
  mailing_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,

  parcel_apn text,
  permit_number text,
  permit_date date,
  permit_type text,
  permit_description text,
  contractor text,
  roof_type text,

  -- Same dedupe basis as leads.address_key (migration 0012).
  address_key text generated always as (public.normalize_address(property_address, zip)) stored,

  -- Screening (§7). Decision is null until screened; reason is always explicit.
  screening_decision text check (screening_decision is null or screening_decision in (
    'qualify','reject_new_roof','reject_wrong_roof_type','reject_bad_address',
    'reject_duplicate','needs_follow_up','manual_measurement'
  )),
  screening_reason text,
  roof_age_years numeric,
  roof_age_source text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Measurement + billable squares. Null until a real measurement exists.
  measurement_id uuid references public.roof_measurements(id) on delete set null,
  measured_squares numeric check (measured_squares is null or measured_squares >= 0),
  waste_squares numeric check (waste_squares is null or waste_squares >= 0),
  final_squares numeric check (final_squares is null or final_squares >= 0),

  -- Links created on conversion. A prospect never overwrites a lead/estimate.
  converted_lead_id uuid references public.leads(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,

  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prospects_address_key on public.roof_prospects (address_key) where address_key is not null;
create index if not exists idx_prospects_status      on public.roof_prospects (status, created_at desc);
create index if not exists idx_prospects_campaign    on public.roof_prospects (campaign_id, created_at desc);
create index if not exists idx_prospects_import_job  on public.roof_prospects (import_job_id);
create index if not exists idx_prospects_parcel      on public.roof_prospects (parcel_apn) where parcel_apn is not null;
create index if not exists idx_prospects_lead        on public.roof_prospects (converted_lead_id) where converted_lead_id is not null;

drop trigger if exists set_updated_at on public.roof_prospects;
create trigger set_updated_at before update on public.roof_prospects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Link import jobs to a campaign / county (additive)
-- ---------------------------------------------------------------------------
alter table public.lead_import_jobs add column if not exists campaign_id uuid
  references public.prospecting_campaigns(id) on delete set null;
alter table public.lead_import_jobs add column if not exists county text;
-- Distinguishes a roof-prospecting import (writes roof_prospects) from an
-- ordinary lead import (writes leads). Defaults to 'lead' so every existing job
-- keeps its meaning. The two share this table and its lifecycle, not their rows.
alter table public.lead_import_jobs add column if not exists kind text not null default 'lead';
do $$
begin
  alter table public.lead_import_jobs drop constraint if exists lead_import_jobs_kind_check;
  alter table public.lead_import_jobs add constraint lead_import_jobs_kind_check
    check (kind in ('lead', 'roof_prospect'));
end $$;
create index if not exists idx_import_jobs_kind on public.lead_import_jobs (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Price book lifecycle: ACTIVE / RETIRED / ARCHIVED (§8, additive)
-- ---------------------------------------------------------------------------
-- The boolean `active` stays authoritative for "usable now". These add an
-- audit-friendly lifecycle without deleting priced history.
alter table public.pricebook_items add column if not exists retired_at timestamptz;
alter table public.pricebook_items add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. Estimate lines may now record that they came from a prospect import
-- ---------------------------------------------------------------------------
-- Widening a CHECK, never narrowing: 'import' already existed; this is a no-op
-- re-assertion kept for clarity and forward-safety.
do $$
begin
  alter table public.estimate_line_items drop constraint if exists estimate_line_items_source_check;
  alter table public.estimate_line_items add constraint estimate_line_items_source_check
    check (source in ('manual', 'pricebook', 'ai', 'measurement', 'import', 'template'));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.prospecting_campaigns enable row level security;
alter table public.prospecting_campaigns force  row level security;
alter table public.roof_prospects        enable row level security;
alter table public.roof_prospects        force  row level security;

drop policy if exists campaigns_select on public.prospecting_campaigns;
create policy campaigns_select on public.prospecting_campaigns
  for select using (public.can_read());
drop policy if exists campaigns_write on public.prospecting_campaigns;
create policy campaigns_write on public.prospecting_campaigns
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists prospects_select on public.roof_prospects;
create policy prospects_select on public.roof_prospects
  for select using (public.can_read());
drop policy if exists prospects_write on public.roof_prospects;
create policy prospects_write on public.roof_prospects
  for all using (public.can_write()) with check (public.can_write());

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on public.prospecting_campaigns, public.roof_prospects
  to authenticated, service_role;
revoke all
  on public.prospecting_campaigns, public.roof_prospects
  from anon;

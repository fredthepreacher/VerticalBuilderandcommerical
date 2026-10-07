-- ============================================================================
-- Vertical Ops — Migration 0019: Response tracking + campaign analytics (Phase 4)
-- ----------------------------------------------------------------------------
-- Closes the loop on prospecting. Additive only. The key design decision:
-- CONVERSIONS ARE DERIVED, NOT DUPLICATED. Appointment / sold / lost / revenue
-- already live authoritatively in the CRM (leads.pipeline_stage, leads.lost_reason,
-- leads.converted_project_id → projects.contract_amount_cents). Phase 4 does not
-- copy them into a second pipeline; it JOINS them.
--
-- Only two things genuinely cannot be derived, so only these are added:
--   1. mail_responses  — when/through-what-channel a mailed prospect first
--      responded (the CRM cannot infer an inbound phone call).
--   2. campaign_costs  — manual per-campaign costs (printing, postage, list),
--      kept separate from future provider-generated costs. NULL/absent means
--      "not configured" — never shown as $0.
--
-- Plus a read-only view + aggregation functions so campaign funnels are computed
-- in the database (one row per prospect = natural dedup), never by loading raw
-- rows into the app (spec §26).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. mail_responses — first inbound response from a mailed prospect (§4)
-- ---------------------------------------------------------------------------
create table if not exists public.mail_responses (
  id uuid primary key default gen_random_uuid(),
  -- The prospect is the dedup key: one first-response row per prospect, so three
  -- phone calls from one property are one responding prospect (§22).
  roof_prospect_id uuid not null references public.roof_prospects(id) on delete cascade,
  -- Denormalised links for fast grouping; all derivable from the prospect but
  -- kept here so channel analytics never needs a four-table join.
  lead_id uuid references public.leads(id) on delete set null,
  campaign_id uuid references public.prospecting_campaigns(id) on delete set null,
  mail_batch_id uuid references public.mail_batches(id) on delete set null,

  channel text not null default 'unknown' check (channel in (
    'phone','website','email','walk_in','referral','other','unknown'
  )),
  responded_at timestamptz not null default now(),
  note text,
  -- 'manual' (staff entry) or 'derived' (inferred from CRM state). Never guessed.
  source text not null default 'manual' check (source in ('manual','derived')),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One first-response row per prospect. Recording again updates it in place.
  constraint mail_responses_unique_prospect unique (roof_prospect_id)
);

create index if not exists idx_mail_responses_campaign on public.mail_responses (campaign_id, responded_at desc);
create index if not exists idx_mail_responses_batch    on public.mail_responses (mail_batch_id);
create index if not exists idx_mail_responses_channel  on public.mail_responses (channel);

drop trigger if exists set_updated_at on public.mail_responses;
create trigger set_updated_at before update on public.mail_responses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. campaign_costs — manual per-campaign cost entries (§19)
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_costs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.prospecting_campaigns(id) on delete cascade,
  category text not null default 'other' check (category in (
    'printing','postage','list_acquisition','measurement','geocoder','other'
  )),
  amount_cents integer not null check (amount_cents >= 0),
  note text,
  incurred_on date,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaign_costs_campaign on public.campaign_costs (campaign_id, created_at desc);

drop trigger if exists set_updated_at on public.campaign_costs;
create trigger set_updated_at before update on public.campaign_costs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security + grants (mirror 0015/0018)
-- ---------------------------------------------------------------------------
alter table public.mail_responses enable row level security;
alter table public.mail_responses force  row level security;
alter table public.campaign_costs enable row level security;
alter table public.campaign_costs force  row level security;

drop policy if exists mail_responses_select on public.mail_responses;
create policy mail_responses_select on public.mail_responses for select using (public.can_read());
drop policy if exists mail_responses_write on public.mail_responses;
create policy mail_responses_write on public.mail_responses for all using (public.can_write()) with check (public.can_write());

drop policy if exists campaign_costs_select on public.campaign_costs;
create policy campaign_costs_select on public.campaign_costs for select using (public.can_read());
drop policy if exists campaign_costs_write on public.campaign_costs;
create policy campaign_costs_write on public.campaign_costs for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.mail_responses, public.campaign_costs to authenticated, service_role;
revoke all on public.mail_responses, public.campaign_costs from anon;

-- ---------------------------------------------------------------------------
-- 4. v_prospect_outcomes — one row per prospect, outcome resolved (dedup by build)
-- ----------------------------------------------------------------------------
-- security_invoker so the querying user's RLS on the underlying tables applies
-- (PG15+). One row per roof_prospect: reprints and multi-batch mailings collapse
-- to the prospect's earliest mailed_at; multiple phone calls collapse to the one
-- mail_responses row. This is where all the join + dedup logic lives; the
-- functions below only aggregate it.
-- ---------------------------------------------------------------------------
drop view if exists public.v_prospect_outcomes;
create view public.v_prospect_outcomes with (security_invoker = true) as
with mailed as (
  -- Earliest mailed batch per prospect (the batch that gets attribution credit).
  select distinct on (mbi.roof_prospect_id)
    mbi.roof_prospect_id,
    mbi.mailed_at,
    mbi.batch_id as mail_batch_id
  from public.mail_batch_items mbi
  where mbi.mailed_at is not null and mbi.roof_prospect_id is not null
  order by mbi.roof_prospect_id, mbi.mailed_at asc
),
proposals as (
  select distinct roof_prospect_id
  from public.mail_batch_items
  where document_id is not null and roof_prospect_id is not null
)
select
  rp.id                             as prospect_id,
  rp.campaign_id,
  c.county,
  rp.import_job_id,
  rp.roof_type,
  rp.permit_date,
  rp.created_at                     as imported_at,
  rp.status,
  rp.screening_decision,
  rp.converted_lead_id,
  rp.estimate_id,
  -- Acquisition / screening booleans (campaign totals).
  (rp.status = 'duplicate')                                   as is_duplicate,
  (rp.status = 'error')                                       as is_invalid,
  (rp.status not in ('imported','normalizing','duplicate','error')) as is_enriched,
  (rp.status = 'manual_measurement_required')                as is_manual_measurement,
  (rp.status = 'review_required')                            as is_review_required,
  (rp.converted_lead_id is not null
     or rp.status in ('qualified','crm_created','estimate_ready','document_ready','printed','mailed')) as is_approved,
  (rp.status like 'disqualified_%')                          as is_rejected,
  case
    when rp.status = 'disqualified_new_roof'          then 'new_roof'
    when rp.status = 'disqualified_wrong_roof_type'   then 'wrong_roof_type'
    when rp.status = 'disqualified_bad_address'       then 'bad_address'
    when rp.status = 'disqualified_not_opportunity'   then 'not_opportunity'
    when rp.status = 'duplicate'                       then 'duplicate'
    else null
  end                                                        as rejection_reason,
  (rp.estimate_id is not null)                              as has_estimate,
  (rp.status = 'pricing_configuration_required')            as is_pricing_blocked,
  (pr.roof_prospect_id is not null)                         as proposal_generated,
  -- Mail cohort.
  m.mailed_at,
  m.mail_batch_id,
  (m.mailed_at is not null)                                 as is_mailed,
  -- Response (explicit signal).
  mr.responded_at                                           as first_response_at,
  mr.channel                                                as first_response_channel,
  (mr.id is not null)                                       as has_response_row,
  -- CRM-authoritative sales state (via the converted lead).
  l.pipeline_stage                                         as lead_stage,
  l.lost_reason,
  (l.pipeline_stage in ('consultation_scheduled','inspection_complete','estimate_in_progress',
                        'estimate_sent','follow_up','won'))  as reached_appointment,
  (l.pipeline_stage = 'won')                               as is_sold,
  (l.pipeline_stage = 'lost')                              as is_lost,
  -- A prospect responded if it has an explicit response OR its lead advanced past
  -- the pre-contact stages (you cannot book an appointment without responding).
  (mr.id is not null
     or l.pipeline_stage in ('contacted','consultation_scheduled','inspection_complete',
                             'estimate_in_progress','estimate_sent','follow_up','won')) as responded,
  -- Actual sold revenue = the linked project's contract amount. NULL when sold but
  -- no project/amount recorded — reported as "unknown", never as $0.
  case when l.pipeline_stage = 'won' then p.contract_amount_cents else null end as sold_revenue_cents
from public.roof_prospects rp
left join public.prospecting_campaigns c on c.id = rp.campaign_id
left join proposals   pr on pr.roof_prospect_id = rp.id
left join mailed      m  on m.roof_prospect_id  = rp.id
left join public.mail_responses mr on mr.roof_prospect_id = rp.id
left join public.leads l on l.id = rp.converted_lead_id
left join public.projects p on p.id = l.converted_project_id;

grant select on public.v_prospect_outcomes to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. campaign_funnel(p_from, p_to) — per-campaign aggregates (§7)
-- ----------------------------------------------------------------------------
-- Acquisition/screening/production counts are campaign totals. The mail-cohort
-- metrics (mailed/responded/appointment/sold/revenue) are restricted to prospects
-- whose mail was sent within [p_from, p_to] when a range is given (NULL = all
-- time), because comparing a campaign mailed yesterday with one mailed last
-- quarter on raw totals would mislead (§16/§24).
-- ---------------------------------------------------------------------------
-- Small helper: inclusive range test that treats NULL bounds as open. Defined
-- before the aggregate functions that call it (SQL functions resolve references
-- at creation time).
drop function if exists public.in_range(timestamptz, timestamptz, timestamptz);
create function public.in_range(v timestamptz, lo timestamptz, hi timestamptz)
returns boolean language sql immutable as $$
  select v is not null and (lo is null or v >= lo) and (hi is null or v <= hi);
$$;
grant execute on function public.in_range(timestamptz, timestamptz, timestamptz) to authenticated, service_role;

drop function if exists public.campaign_funnel(timestamptz, timestamptz);
create function public.campaign_funnel(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  campaign_id uuid, campaign_name text, county text,
  imported bigint, duplicates bigint, invalid bigint, valid bigint, enriched bigint,
  manual_measurement bigint, review_required bigint, approved bigint, rejected bigint,
  rej_new_roof bigint, rej_wrong_type bigint, rej_bad_address bigint, rej_not_opportunity bigint,
  rej_duplicate bigint, rej_other bigint,
  crm_leads bigint, estimates bigint, pricing_blocked bigint, proposals bigint,
  mailed bigint, responded bigint, appointments bigint, sold bigint, lost bigint,
  sold_with_revenue bigint, sold_revenue_cents bigint
)
language sql stable security invoker as $$
  select
    o.campaign_id,
    co.name as campaign_name,
    o.county,
    count(*)                                                            as imported,
    count(*) filter (where o.is_duplicate)                             as duplicates,
    count(*) filter (where o.is_invalid)                              as invalid,
    count(*) filter (where not o.is_duplicate and not o.is_invalid)   as valid,
    count(*) filter (where o.is_enriched)                            as enriched,
    count(*) filter (where o.is_manual_measurement)                 as manual_measurement,
    count(*) filter (where o.is_review_required)                    as review_required,
    count(*) filter (where o.is_approved)                           as approved,
    count(*) filter (where o.is_rejected)                           as rejected,
    count(*) filter (where o.rejection_reason = 'new_roof')         as rej_new_roof,
    count(*) filter (where o.rejection_reason = 'wrong_roof_type')  as rej_wrong_type,
    count(*) filter (where o.rejection_reason = 'bad_address')      as rej_bad_address,
    count(*) filter (where o.rejection_reason = 'not_opportunity')  as rej_not_opportunity,
    count(*) filter (where o.rejection_reason = 'duplicate')        as rej_duplicate,
    count(*) filter (where o.is_rejected and o.rejection_reason is null) as rej_other,
    count(*) filter (where o.converted_lead_id is not null)         as crm_leads,
    count(*) filter (where o.has_estimate)                          as estimates,
    count(*) filter (where o.is_pricing_blocked)                    as pricing_blocked,
    count(*) filter (where o.proposal_generated)                    as proposals,
    -- Mail cohort (date-filtered on mailed_at).
    count(*) filter (where o.is_mailed and in_range(o.mailed_at, p_from, p_to))                as mailed,
    count(*) filter (where o.is_mailed and in_range(o.mailed_at, p_from, p_to) and o.responded)          as responded,
    count(*) filter (where o.is_mailed and in_range(o.mailed_at, p_from, p_to) and o.reached_appointment) as appointments,
    count(*) filter (where o.is_mailed and in_range(o.mailed_at, p_from, p_to) and o.is_sold)             as sold,
    count(*) filter (where o.is_mailed and in_range(o.mailed_at, p_from, p_to) and o.is_lost)             as lost,
    count(*) filter (where o.is_mailed and in_range(o.mailed_at, p_from, p_to) and o.is_sold and o.sold_revenue_cents is not null) as sold_with_revenue,
    coalesce(sum(o.sold_revenue_cents) filter (where o.is_mailed and in_range(o.mailed_at, p_from, p_to) and o.is_sold), 0)        as sold_revenue_cents
  from public.v_prospect_outcomes o
  left join public.prospecting_campaigns co on co.id = o.campaign_id
  where o.campaign_id is not null
  group by o.campaign_id, co.name, o.county
  order by co.name;
$$;

grant execute on function public.campaign_funnel(timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. batch_funnel(p_campaign, p_from, p_to) — per-mail-batch subtotals (§20)
-- ---------------------------------------------------------------------------
drop function if exists public.batch_funnel(uuid, timestamptz, timestamptz);
create function public.batch_funnel(p_campaign uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (
  mail_batch_id uuid, batch_name text, mailed bigint, responded bigint,
  appointments bigint, sold bigint, sold_with_revenue bigint, sold_revenue_cents bigint
)
language sql stable security invoker as $$
  select
    o.mail_batch_id,
    b.name as batch_name,
    count(*) filter (where in_range(o.mailed_at, p_from, p_to))                             as mailed,
    count(*) filter (where in_range(o.mailed_at, p_from, p_to) and o.responded)             as responded,
    count(*) filter (where in_range(o.mailed_at, p_from, p_to) and o.reached_appointment)   as appointments,
    count(*) filter (where in_range(o.mailed_at, p_from, p_to) and o.is_sold)               as sold,
    count(*) filter (where in_range(o.mailed_at, p_from, p_to) and o.is_sold and o.sold_revenue_cents is not null) as sold_with_revenue,
    coalesce(sum(o.sold_revenue_cents) filter (where in_range(o.mailed_at, p_from, p_to) and o.is_sold), 0)        as sold_revenue_cents
  from public.v_prospect_outcomes o
  left join public.mail_batches b on b.id = o.mail_batch_id
  where o.is_mailed and o.mail_batch_id is not null
    and (p_campaign is null or o.campaign_id = p_campaign)
  group by o.mail_batch_id, b.name
  order by b.name;
$$;

grant execute on function public.batch_funnel(uuid, timestamptz, timestamptz) to authenticated, service_role;

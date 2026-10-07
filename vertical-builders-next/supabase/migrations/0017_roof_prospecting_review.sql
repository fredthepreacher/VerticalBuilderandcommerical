-- ============================================================================
-- Vertical Ops — Migration 0017: Roof Prospecting review + conversion (Phase 3A)
-- ----------------------------------------------------------------------------
-- Additive only. Adds the review-audit fields the console needs, an explicit
-- campaign → price-book item mapping so an automated estimate never guesses a
-- price, and widens two CHECKs (never narrows) for new review outcomes.
--
-- Deliberately small: the prospect↔lead and prospect↔estimate links, screening
-- decision/reason, and measurement links all already exist (0015/0016). This
-- only adds who-reviewed-it, a concurrency version, a note, the price-book
-- mapping, and three new statuses + one new screening decision.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. roof_prospects — review audit + optimistic-concurrency version
-- ---------------------------------------------------------------------------
alter table public.roof_prospects add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.roof_prospects add column if not exists reviewed_at timestamptz;
alter table public.roof_prospects add column if not exists review_note text;
-- Bumped on every human review write. The console sends the version it read and
-- a write is rejected if it changed meanwhile, so two reviewers cannot silently
-- overwrite each other.
alter table public.roof_prospects add column if not exists review_version integer not null default 0;

create index if not exists idx_roof_prospects_reviewed on public.roof_prospects (reviewed_at desc) where reviewed_at is not null;

-- Widen status: reviewed follow-up, "not a roofing opportunity", and the
-- pricing-blocked state that stops a misleading $0 estimate.
do $$
begin
  alter table public.roof_prospects drop constraint if exists roof_prospects_status_check;
  alter table public.roof_prospects add constraint roof_prospects_status_check check (status in (
    'imported','normalizing','duplicate','enrichment_pending','enriched',
    'review_required','follow_up','qualified',
    'disqualified_new_roof','disqualified_wrong_roof_type','disqualified_bad_address',
    'disqualified_not_opportunity',
    'manual_measurement_required','pricing_configuration_required',
    'crm_created','estimate_ready','document_ready',
    'printed','mailed','responded','appointment','sold','no_response','error'
  ));
end $$;

-- Widen screening_decision to add "not a roofing opportunity".
do $$
begin
  alter table public.roof_prospects drop constraint if exists roof_prospects_screening_decision_check;
  alter table public.roof_prospects add constraint roof_prospects_screening_decision_check
    check (screening_decision is null or screening_decision in (
      'qualify','reject_new_roof','reject_wrong_roof_type','reject_bad_address',
      'reject_duplicate','reject_not_opportunity','needs_follow_up','manual_measurement'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Campaign → Price Book item mapping (§17)
-- ---------------------------------------------------------------------------
-- The explicit roofing-squares price item an automated estimate uses. NULL means
-- "not configured" — the pipeline then routes to pricing_configuration_required
-- rather than inventing a price. on delete set null so retiring the row's target
-- never breaks the campaign silently; the pipeline re-validates at estimate time.
alter table public.prospecting_campaigns add column if not exists pricebook_item_id uuid
  references public.pricebook_items(id) on delete set null;

-- No new tables → no new RLS/grants; roof_prospects and prospecting_campaigns
-- already have RLS forced and grants from 0015.

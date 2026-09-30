-- ============================================================================
-- Vertical Ops — Migration 0018: Roof Prospecting mail-batch production (Phase 3B)
-- ----------------------------------------------------------------------------
-- Additive only. Adds two tables so a run of reviewed, priced, estimate-ready
-- prospects can be turned into a controlled outbound mail batch — without
-- duplicating any existing truth:
--
--   · The proposal PDF itself is the existing branded ESTIMATE document
--     (lib/ops/estimating/pdf.ts) stored in the existing private `documents`
--     vault (entity_type='estimate', document_type='estimate', versioned).
--     0018 adds NO new document type and NO second PDF store.
--   · The prospect↔lead↔estimate links, the campaign→price-book item and
--     campaign→proposal_template_id mapping, the waste rule and final squares,
--     and the prospect lifecycle statuses (…, document_ready, printed, mailed,
--     responded, sold) ALL already exist (0014/0015/0016/0017). This migration
--     only records WHICH records went into WHICH mail batch, with a point-in-time
--     manifest snapshot and per-item generation state, so a batch is reproducible
--     and auditable even after the underlying prospect later changes.
--
-- Response / conversion state (responded, appointment, sold) is NOT copied here;
-- it stays on roof_prospects and is read back through the item's prospect link.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. mail_batches — one controlled outbound run (§5, §11)
-- ---------------------------------------------------------------------------
create table if not exists public.mail_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campaign_id uuid references public.prospecting_campaigns(id) on delete set null,
  -- The proposal wording template in force when the batch was created. A copy of
  -- intent for the audit trail; applying a template is already a copy into each
  -- estimate (see proposal-templates service), so this never reaches backwards.
  proposal_template_id uuid references public.estimate_proposal_templates(id) on delete set null,

  status text not null default 'draft' check (status in (
    'draft','generating','ready','partial','exported','printed','mailed','cancelled','error'
  )),

  -- The configurable cap used for THIS batch (defaults mirror campaign.default_batch_size
  -- / 60 at the app layer; the architecture never hard-codes 60).
  batch_size_limit integer check (batch_size_limit is null or batch_size_limit between 1 and 1000),
  record_count integer not null default 0 check (record_count >= 0),
  mail_tag text,
  notes text,

  -- Optimistic concurrency: two operators cannot silently drive one batch's
  -- lifecycle out from under each other. Bumped on every status transition.
  batch_version integer not null default 0,

  -- Lifecycle stamps. Marking printed/mailed is an explicit human act and is
  -- never inferred from PDFs being generated (§16).
  exported_at timestamptz,
  printed_at  timestamptz,
  printed_by  uuid references public.profiles(id) on delete set null,
  mailed_at   timestamptz,
  mailed_by   uuid references public.profiles(id) on delete set null,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  alter table public.mail_batches drop constraint if exists mail_batches_name_check;
  alter table public.mail_batches add constraint mail_batches_name_check
    check (length(trim(name)) between 1 and 140);
end $$;

create index if not exists idx_mail_batches_status   on public.mail_batches (status, created_at desc);
create index if not exists idx_mail_batches_campaign on public.mail_batches (campaign_id, created_at desc);

drop trigger if exists set_updated_at on public.mail_batches;
create trigger set_updated_at before update on public.mail_batches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. mail_batch_items — the manifest: one row per record in a batch (§10)
-- ---------------------------------------------------------------------------
create table if not exists public.mail_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.mail_batches(id) on delete cascade,

  -- Provenance links (never overwrite the source rows; these only reference them).
  roof_prospect_id uuid references public.roof_prospects(id) on delete set null,
  lead_id          uuid references public.leads(id)          on delete set null,
  estimate_id      uuid references public.estimates(id)      on delete set null,
  -- The generated proposal PDF in the existing documents vault. Null until
  -- generation succeeds for this item.
  document_id      uuid references public.documents(id)      on delete set null,

  -- Per-item generation lifecycle. 'blocked' carries an eligibility reason;
  -- 'failed' carries a render/storage error. One failed item never sinks a batch.
  generation_status text not null default 'pending' check (generation_status in (
    'pending','generating','generated','blocked','failed'
  )),
  -- One of the eligibility codes when blocked: PRICING_CONFIGURATION_REQUIRED,
  -- MEASUREMENT_REQUIRED, ESTIMATE_REQUIRED, TEMPLATE_REQUIRED, ALREADY_BATCHED,
  -- BAD_ADDRESS, ERROR. Free text kept for forward-safety.
  block_reason text,
  error_message text,

  -- Point-in-time manifest snapshot. Captured at add/generate time so the mail
  -- run is reproducible even if the prospect/estimate is edited afterwards.
  recipient_name   text,
  property_address text,          -- job / opportunity location
  mailing_address  text,          -- recipient delivery address actually used
  -- True when mailing_address was empty and the property address was used as the
  -- documented fallback (§8). Distinguishes a real mailing address from a fallback.
  mailing_fallback boolean not null default false,
  final_squares       numeric  check (final_squares is null or final_squares >= 0),
  estimate_total_cents integer check (estimate_total_cents is null or estimate_total_cents >= 0),
  estimate_number   text,

  -- Per-item mail stamps (a batch may be printed/mailed in parts → 'partial').
  printed_at timestamptz,
  mailed_at  timestamptz,

  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A prospect appears at most once per batch → adding it twice / a bulk retry is
  -- idempotent. (Cross-batch "already in an active batch" is the ALREADY_BATCHED
  -- eligibility rule, enforced in the service since it depends on batch.status.)
  constraint mail_batch_items_unique_prospect unique (batch_id, roof_prospect_id)
);

create index if not exists idx_mail_batch_items_batch     on public.mail_batch_items (batch_id, sort_order);
create index if not exists idx_mail_batch_items_genstatus on public.mail_batch_items (batch_id, generation_status);
create index if not exists idx_mail_batch_items_prospect  on public.mail_batch_items (roof_prospect_id) where roof_prospect_id is not null;
create index if not exists idx_mail_batch_items_estimate  on public.mail_batch_items (estimate_id) where estimate_id is not null;

drop trigger if exists set_updated_at on public.mail_batch_items;
create trigger set_updated_at before update on public.mail_batch_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — mirrors 0015. Coarse read/write at the row level;
--    fine-grained per-action permissions (create batch, generate, export, mark
--    printed, mark mailed) are enforced in the app layer via CAPABILITIES.
-- ---------------------------------------------------------------------------
alter table public.mail_batches      enable row level security;
alter table public.mail_batches      force  row level security;
alter table public.mail_batch_items  enable row level security;
alter table public.mail_batch_items  force  row level security;

drop policy if exists mail_batches_select on public.mail_batches;
create policy mail_batches_select on public.mail_batches
  for select using (public.can_read());
drop policy if exists mail_batches_write on public.mail_batches;
create policy mail_batches_write on public.mail_batches
  for all using (public.can_write()) with check (public.can_write());

drop policy if exists mail_batch_items_select on public.mail_batch_items;
create policy mail_batch_items_select on public.mail_batch_items
  for select using (public.can_read());
drop policy if exists mail_batch_items_write on public.mail_batch_items;
create policy mail_batch_items_write on public.mail_batch_items
  for all using (public.can_write()) with check (public.can_write());

-- ---------------------------------------------------------------------------
-- 4. Grants (mirrors 0015 / migration 0010 posture; anon has no access)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on public.mail_batches, public.mail_batch_items
  to authenticated, service_role;
revoke all
  on public.mail_batches, public.mail_batch_items
  from anon;

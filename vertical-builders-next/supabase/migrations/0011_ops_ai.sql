-- ============================================================================
-- Vertical Ops — Migration 0011: AI layer (Phase 3)
-- ----------------------------------------------------------------------------
-- Two new tables and three settings columns. Additive only: no existing table,
-- column, policy or function is changed.
--
-- PRIVACY POSITION, decided here rather than left to each caller:
--   `ai_runs` records WHO invoked AI, WHICH feature, WHICH record, whether it
--   worked, and which model/prompt version produced it. It deliberately does
--   NOT store prompts, document text, model replies or API keys. Enough to
--   answer "who ran AI against this vendor and when", not enough to become a
--   second copy of the customer's insurance paperwork sitting in a log table.
--
--   `ai_extraction_drafts` is the exception, and it has to be: reviewing a COI
--   extraction means seeing what was extracted. It holds the structured fields
--   only — never the document bytes, never the raw model response.
--
-- Data API grants come from migration 0010's ALTER DEFAULT PRIVILEGES, so these
-- tables are reachable by `authenticated` the moment they are created and
-- closed to `anon`. That is exactly the bug 0010 exists to prevent; the
-- verification pass confirms it against a fresh database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ai_runs — telemetry and accountability
-- ---------------------------------------------------------------------------
create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  feature text not null check (feature in (
    'copilot', 'lead_structure', 'lead_enrichment', 'lead_message',
    'coi_extraction', 'audit_brief', 'dashboard_brief',
    -- Deterministic Smart Ops. Recorded so usage is visible, but see `mode`:
    -- these rows cost nothing with the AI provider and must not be counted as
    -- paid AI usage.
    'smart_ops', 'smart_brief', 'smart_audit_brief', 'smart_lead_parse'
  )),
  -- Which half of the assistant produced this run.
  --   smart_ops    — deterministic, no external provider was contacted
  --   ai_enhanced  — a request was made to the configured AI provider
  -- Billing questions are answered by filtering on this column.
  mode text not null default 'ai_enhanced' check (mode in ('smart_ops', 'ai_enhanced')),
  status text not null default 'succeeded' check (status in ('succeeded', 'failed', 'refused')),
  model text,
  prompt_version text,
  entity_type text,
  entity_id uuid,
  -- References only: ids, counts, tool names. Never prompt or document text.
  input_refs jsonb not null default '{}'::jsonb,
  -- Shape of what came back: counts, field names, confidence. Never the prose.
  output_summary jsonb not null default '{}'::jsonb,
  token_usage jsonb,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_runs_user    on public.ai_runs (user_id, created_at desc);
create index if not exists idx_ai_runs_feature on public.ai_runs (feature, created_at desc);
create index if not exists idx_ai_runs_entity  on public.ai_runs (entity_type, entity_id);
create index if not exists idx_ai_runs_created on public.ai_runs (created_at desc);
create index if not exists idx_ai_runs_mode    on public.ai_runs (mode, created_at desc);

-- Upgrade path for a database where an earlier revision of this migration was
-- already applied. Both statements are no-ops on a fresh install.
alter table public.ai_runs add column if not exists mode text not null default 'ai_enhanced';
do $$
begin
  alter table public.ai_runs drop constraint if exists ai_runs_feature_check;
  alter table public.ai_runs add constraint ai_runs_feature_check check (feature in (
    'copilot', 'lead_structure', 'lead_enrichment', 'lead_message',
    'coi_extraction', 'audit_brief', 'dashboard_brief',
    'smart_ops', 'smart_brief', 'smart_audit_brief', 'smart_lead_parse'
  ));
  alter table public.ai_runs drop constraint if exists ai_runs_mode_check;
  alter table public.ai_runs add constraint ai_runs_mode_check check (mode in ('smart_ops', 'ai_enhanced'));
end $$;

-- ---------------------------------------------------------------------------
-- ai_extraction_drafts — the COI review buffer
-- ---------------------------------------------------------------------------
create table if not exists public.ai_extraction_drafts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  extracted_data jsonb not null default '{}'::jsonb,
  confidence_data jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  model text,
  prompt_version text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  applied_at timestamptz,
  -- Set when Apply creates a certificate, so the trail from draft to record is
  -- traversable in both directions.
  applied_certificate_id uuid references public.insurance_certificates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_extraction_document on public.ai_extraction_drafts (document_id);
create index if not exists idx_extraction_vendor   on public.ai_extraction_drafts (vendor_id, created_at desc);
create index if not exists idx_extraction_status   on public.ai_extraction_drafts (status);

drop trigger if exists set_updated_at on public.ai_extraction_drafts;
create trigger set_updated_at before update on public.ai_extraction_drafts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- App settings — additive, nullable-safe defaults
-- ---------------------------------------------------------------------------
alter table public.app_settings add column if not exists ai_copilot_enabled   boolean not null default true;
alter table public.app_settings add column if not exists ai_coi_extraction_enabled boolean not null default true;
alter table public.app_settings add column if not exists ai_dashboard_brief_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.ai_runs               enable row level security;
alter table public.ai_runs               force  row level security;
alter table public.ai_extraction_drafts  enable row level security;
alter table public.ai_extraction_drafts  force  row level security;

-- ai_runs -------------------------------------------------------------------
-- Admin and office see everything (same operational visibility they have over
-- activity_log). Everyone else sees only their own runs — a project manager has
-- no business reading what the owner asked the assistant.
drop policy if exists ai_runs_select on public.ai_runs;
create policy ai_runs_select on public.ai_runs
  for select using (
    public.current_role() in ('admin', 'office')
    or user_id = auth.uid()
  );

-- Written by the server on behalf of the acting user; the row must be theirs.
drop policy if exists ai_runs_insert on public.ai_runs;
create policy ai_runs_insert on public.ai_runs
  for insert with check (public.can_read() and user_id = auth.uid());

-- No UPDATE and no DELETE policy, matching activity_log and the other history
-- tables: an AI audit trail that can be edited afterwards is not an audit trail.

-- ai_extraction_drafts ------------------------------------------------------
drop policy if exists ai_drafts_select on public.ai_extraction_drafts;
create policy ai_drafts_select on public.ai_extraction_drafts
  for select using (public.can_read());

-- Creating and reviewing an extraction is staff work. read_only is excluded by
-- can_write(), so an auditor can read a draft but never produce or apply one.
drop policy if exists ai_drafts_insert on public.ai_extraction_drafts;
create policy ai_drafts_insert on public.ai_extraction_drafts
  for insert with check (public.can_write());

drop policy if exists ai_drafts_update on public.ai_extraction_drafts;
create policy ai_drafts_update on public.ai_extraction_drafts
  for update using (public.can_write()) with check (public.can_write());

-- No DELETE policy. Extraction history is part of how a reviewed COI came to be
-- recorded, and the project's convention is that such history is never removed.

-- ---------------------------------------------------------------------------
-- Grants for these two tables specifically
-- ---------------------------------------------------------------------------
-- 0010's default privileges should already cover anything created afterwards.
-- Restating them costs nothing and makes this migration correct even if it is
-- ever applied to a database where 0010 was skipped.
grant select, insert, update, delete on public.ai_runs, public.ai_extraction_drafts
  to authenticated, service_role;
revoke all on public.ai_runs, public.ai_extraction_drafts from anon;

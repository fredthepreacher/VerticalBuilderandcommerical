-- ============================================================================
-- Vertical Ops — Migration 0014: reusable proposal templates
-- ----------------------------------------------------------------------------
-- The client writes the same four or five proposals over and over — tile roof,
-- shingle roof, roof cleaning, repair — and wants to keep the WORDING, not the
-- pricing. He measures each job and enters whatever rate applies that week.
--
-- That is why this is a separate pair of tables rather than more rows in
-- `pricebook_items`. The two answer different questions:
--
--   pricebook_items   what does one square of tile cost us
--   proposal template what does a tile roof proposal SAY, and in what order
--
-- Overloading the pricebook would have meant every reusable paragraph competing
-- with real priced line items in every dropdown in the product.
--
-- PRICING IS OPTIONAL HERE, deliberately. A perfectly good template is:
--     description "Tile roof replacement", unit "SQ", quantity null, rate null
-- Forcing a saved price would defeat the point.
--
-- Additive and non-destructive: no existing table, column, policy or function
-- is changed except the estimate line `source` CHECK, which is only widened.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The template itself
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_proposal_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  service_type text,
  -- Reusable proposal prose. Copied onto an estimate when applied; never
  -- customer-specific, because a template is reused across customers.
  scope_summary text,
  customer_notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.estimate_proposal_templates is
  'Reusable proposal STRUCTURE and wording. Holds no customer PII by design — see '
  'the check constraints below, which refuse the obvious mistakes rather than trusting '
  'the application to remember.';

-- A template is reused across customers, so a name that is itself an email
-- address or a phone number is a sign somebody saved a specific job by mistake.
-- Cheap to check here, and the database is the last place it can be caught.
do $$
begin
  alter table public.estimate_proposal_templates drop constraint if exists proposal_templates_name_check;
  alter table public.estimate_proposal_templates add constraint proposal_templates_name_check
    check (
      length(trim(name)) between 1 and 120
      and name !~* '[[:alnum:]._%%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
    );
end $$;

create index if not exists idx_proposal_templates_active
  on public.estimate_proposal_templates (archived_at, name);
create index if not exists idx_proposal_templates_service
  on public.estimate_proposal_templates (service_type) where service_type is not null;

-- ---------------------------------------------------------------------------
-- 2. Its lines
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_proposal_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.estimate_proposal_templates(id) on delete cascade,
  sort_order integer not null default 0,
  category text,
  description text not null,
  unit text not null default 'EA',
  -- Both nullable, and that is the feature. "Measure the job, then price it."
  default_quantity numeric check (default_quantity is null or default_quantity >= 0),
  default_unit_price_cents bigint check (default_unit_price_cents is null or default_unit_price_cents >= 0),
  -- Optional convenience link. A template line does NOT require one, and the
  -- pricebook item can be deleted without taking the template with it.
  pricebook_item_id uuid references public.pricebook_items(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.estimate_proposal_template_lines.default_quantity is
  'Nullable on purpose. The client measures each roof and types the number; a saved '
  'quantity would be wrong more often than right.';
comment on column public.estimate_proposal_template_lines.default_unit_price_cents is
  'Nullable on purpose. Rates move; the template holds the wording, not the price.';

create index if not exists idx_proposal_template_lines_template
  on public.estimate_proposal_template_lines (template_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. updated_at triggers, matching the rest of the schema
-- ---------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.estimate_proposal_templates;
create trigger set_updated_at before update on public.estimate_proposal_templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.estimate_proposal_template_lines;
create trigger set_updated_at before update on public.estimate_proposal_template_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security — same shape as the pricebook it sits beside
-- ---------------------------------------------------------------------------
-- Read: anyone signed in, including the auditor. A proposal template holds no
--       customer data and no company margin.
-- Write: admin/office only, matching `pricebookManage`. A template is shared
--        company wording; a project manager editing it changes what every
--        future proposal says.
do $$
declare t text;
begin
  foreach t in array array['estimate_proposal_templates', 'estimate_proposal_template_lines']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read())',
      t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_staff()) with check (public.is_staff())',
      t || '_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- 0010's ALTER DEFAULT PRIVILEGES should already cover these. Restating costs
-- nothing and keeps the migration correct if 0010 were ever skipped.
grant select, insert, update, delete
  on public.estimate_proposal_templates, public.estimate_proposal_template_lines
  to authenticated, service_role;
revoke all
  on public.estimate_proposal_templates, public.estimate_proposal_template_lines
  from anon;

-- ---------------------------------------------------------------------------
-- 6. Estimate lines may now record that they came from a template
-- ---------------------------------------------------------------------------
-- Widening a CHECK, not narrowing one: every value that was accepted before is
-- still accepted. Provenance matters here — "did this wording come from a
-- template" is a question the office will ask, and storing template lines as
-- 'manual' would make it unanswerable.
do $$
begin
  alter table public.estimate_line_items drop constraint if exists estimate_line_items_source_check;
  alter table public.estimate_line_items add constraint estimate_line_items_source_check
    check (source in ('manual', 'pricebook', 'ai', 'measurement', 'import', 'template'));
end $$;

-- No existing estimate is rewritten. A line that was 'manual' stays 'manual'.

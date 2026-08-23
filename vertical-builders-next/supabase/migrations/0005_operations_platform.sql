-- ============================================================================
-- Vertical Ops — Migration 0005: Phase 2 operations platform
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. This migration creates new tables and adds new columns.
-- It does not drop, rename, or alter the type of anything from Phase 1, and it
-- does not touch the COI / compliance / audit tables at all beyond adding new
-- foreign keys that point AT them.
--
-- Safe to run against a production database with live data.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Additive columns on existing tables
-- ---------------------------------------------------------------------------

-- Scheduling. The Gantt reads scheduled_* first and falls back to the Phase 1
-- start_date / estimated_completion_date, so existing projects appear on the
-- timeline immediately without a backfill.
alter table public.projects add column if not exists scheduled_start_date date;
alter table public.projects add column if not exists scheduled_end_date date;
alter table public.projects add column if not exists schedule_locked boolean not null default false;
alter table public.projects add column if not exists schedule_notes text;
alter table public.projects add column if not exists source_estimate_id uuid;

-- Estimate, scheduling and payment settings live on the existing single row.
alter table public.app_settings add column if not exists estimate_number_prefix text not null default 'EST';
alter table public.app_settings add column if not exists estimate_valid_days integer not null default 30;
alter table public.app_settings add column if not exists estimate_default_notes text;
alter table public.app_settings add column if not exists estimate_tax_enabled boolean not null default false;
alter table public.app_settings add column if not exists estimate_default_tax_percent numeric not null default 0;
alter table public.app_settings add column if not exists invoice_number_prefix text not null default 'INV';
alter table public.app_settings add column if not exists invoice_due_days integer not null default 14;
alter table public.app_settings add column if not exists roof_measurement_provider text not null default 'manual';
alter table public.app_settings add column if not exists online_payments_enabled boolean not null default false;
alter table public.app_settings add column if not exists allowed_payment_methods text[] not null default '{card,ach,check}';
alter table public.app_settings add column if not exists schedule_work_days integer[] not null default '{1,2,3,4,5}';
alter table public.app_settings add column if not exists costs_visible_to_pm boolean not null default true;
alter table public.app_settings add column if not exists profit_visible_to_pm boolean not null default false;

-- Document types used by the new modules. The Phase 1 CHECK constraint is
-- replaced with a superset — no existing value is removed.
alter table public.documents drop constraint if exists documents_document_type_check;
alter table public.documents add constraint documents_document_type_check check (document_type in (
  'coi','insurance_endorsement','workers_comp_exemption','w9','contractor_license',
  'business_license','subcontractor_agreement','contract','permit','inspection',
  'estimate','change_order','invoice','warranty','photo','audit_package','other',
  -- Phase 2 additions
  'receipt','measurement_report','signed_estimate','lead_import','project_photo'));

-- Entity types the vault can attach to.
alter table public.documents drop constraint if exists documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('vendor','project','contact','lead','audit','estimate','invoice'));

-- ---------------------------------------------------------------------------
-- Pricebook — so AI estimating cannot invent company pricing
-- ---------------------------------------------------------------------------
create table if not exists public.pricebook_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  service_type text,
  description text,
  unit text not null default 'EA'
    check (unit in ('EA','SQ','SF','LF','HR','DAY','LS','CU YD','GAL','TON','ROLL','BDL','OTHER')),
  default_unit_price_cents bigint not null default 0,
  default_material_cost_cents bigint,
  default_labor_cost_cents bigint,
  active boolean not null default true,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Estimates
-- ---------------------------------------------------------------------------
create sequence if not exists public.estimate_number_seq start 1001;

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number text not null unique
    default ('EST-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.estimate_number_seq')::text, 4, '0')),
  lead_id uuid references public.leads(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  property_address text,
  city text,
  state text default 'FL',
  zip text,
  service_type text,
  title text not null,
  scope_summary text,
  status text not null default 'draft' check (status in (
    'draft','ai_draft','measuring','ready_for_review','sent','viewed',
    'approved','declined','expired','converted')),
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  tax_percent numeric not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  valid_until date,
  customer_notes text,
  internal_notes text,
  decline_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  viewed_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  converted_project_id uuid references public.projects(id) on delete set null,
  -- provider, model, prompt version, warnings, assumptions. Never hidden reasoning.
  ai_metadata_json jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects drop constraint if exists projects_source_estimate_id_fkey;
alter table public.projects add constraint projects_source_estimate_id_fkey
  foreign key (source_estimate_id) references public.estimates(id) on delete set null;

create table if not exists public.estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  sort_order integer not null default 0,
  category text,
  description text not null,
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default 'EA',
  unit_price_cents bigint not null default 0,
  labor_cost_cents bigint,
  material_cost_cents bigint,
  markup_percent numeric,
  line_total_cents bigint not null default 0,
  pricebook_item_id uuid references public.pricebook_items(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','pricebook','ai','measurement','import')),
  ai_generated boolean not null default false,
  -- AI proposed a line with no pricebook backing: allowed, but flagged.
  needs_review boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Photos are documents; this is the join plus presentation metadata.
create table if not exists public.estimate_photos (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  caption text,
  photo_type text not null default 'other'
    check (photo_type in ('inspection','roof','interior','exterior','damage','measurement','other')),
  customer_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (estimate_id, document_id)
);

-- ---------------------------------------------------------------------------
-- Roof measurements
-- ---------------------------------------------------------------------------
create table if not exists public.roof_measurements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  address text not null,
  latitude numeric,
  longitude numeric,
  provider text not null default 'manual'
    check (provider in ('manual','uploaded_report','eagleview','nearmap','other')),
  external_request_id text,
  external_report_id text,
  status text not null default 'complete'
    check (status in ('requested','processing','complete','failed','cancelled')),
  failure_reason text,
  roof_area_sqft numeric,
  roof_area_squares numeric,
  primary_pitch text,
  facet_count integer,
  ridge_lf numeric,
  hip_lf numeric,
  valley_lf numeric,
  eave_lf numeric,
  rake_lf numeric,
  waste_factor_percent numeric,
  notes text,
  source_document_id uuid references public.documents(id) on delete set null,
  -- Stored only where the provider's terms permit it. See docs/MEASUREMENTS.md.
  raw_provider_payload_json jsonb not null default '{}'::jsonb,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bulk lead import
-- ---------------------------------------------------------------------------
create table if not exists public.lead_import_jobs (
  id uuid primary key default gen_random_uuid(),
  original_filename text not null,
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  imported_rows integer not null default 0,
  updated_rows integer not null default 0,
  skipped_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending','validating','importing','completed','completed_with_errors','failed','cancelled')),
  mapping_json jsonb not null default '{}'::jsonb,
  duplicate_strategy text not null default 'skip'
    check (duplicate_strategy in ('skip','update','import_anyway')),
  import_tag text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.lead_import_errors (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.lead_import_jobs(id) on delete cascade,
  row_number integer not null,
  raw_row_json jsonb not null default '{}'::jsonb,
  error_code text not null,
  error_message text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Subcontractor agreements
-- ----------------------------------------------------------------------------
-- Deliberately a SEPARATE table from insurance. An agreement and a certificate
-- are both compliance artifacts, but conflating them would let a signed
-- contract mask missing coverage. The two statuses are always shown apart.
-- ---------------------------------------------------------------------------
create table if not exists public.subcontractor_agreements (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  status text not null default 'missing'
    check (status in ('missing','sent','signed','expired','superseded')),
  effective_date date,
  expiration_date date,
  signed_date date,
  document_id uuid references public.documents(id) on delete set null,
  version integer not null default 1,
  supersedes_id uuid references public.subcontractor_agreements(id) on delete set null,
  notes text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Project photos (before / during / after)
-- ---------------------------------------------------------------------------
create table if not exists public.project_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  phase text not null default 'progress' check (phase in (
    'before','during','after','inspection','damage','progress','completion','other')),
  caption text,
  taken_at date,
  uploaded_by uuid references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  customer_visible boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, document_id)
);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create sequence if not exists public.invoice_number_seq start 1001;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique
    default ('INV-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0')),
  project_id uuid not null references public.projects(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  invoice_type text not null default 'standard'
    check (invoice_type in ('standard','deposit','progress','final')),
  status text not null default 'draft'
    check (status in ('draft','sent','partially_paid','paid','overdue','void')),
  issue_date date not null default current_date,
  due_date date,
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  tax_percent numeric not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  amount_paid_cents bigint not null default 0,
  balance_due_cents bigint not null default 0,
  notes text,
  customer_message text,
  created_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sort_order integer not null default 0,
  description text not null,
  quantity numeric not null default 1 check (quantity >= 0),
  unit text,
  unit_price_cents bigint not null default 0,
  line_total_cents bigint not null default 0,
  estimate_line_item_id uuid references public.estimate_line_items(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('card','ach','check','cash','other')),
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','refunded','void')),
  provider text,
  provider_payment_id text,
  provider_session_id text,
  check_number text,
  reference_number text,
  received_date date,
  recorded_by uuid references public.profiles(id) on delete set null,
  refunded_amount_cents bigint not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhook idempotency ledger. A provider will resend the same event; the unique
-- constraint is what makes replaying one harmless.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payment_id uuid references public.payments(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  status text not null default 'processed' check (status in ('processed','ignored','failed')),
  error_message text,
  payload_summary_json jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- ---------------------------------------------------------------------------
-- Job costs
-- ---------------------------------------------------------------------------
create table if not exists public.job_costs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null check (category in (
    'labor','materials','subcontractor','equipment','permit_fees','disposal','delivery','other')),
  vendor_id uuid references public.vendors(id) on delete set null,
  description text not null,
  amount_cents bigint not null,
  cost_date date not null default current_date,
  document_id uuid references public.documents(id) on delete set null,
  entered_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_pricebook_active       on public.pricebook_items (active, category);
create index if not exists idx_pricebook_service      on public.pricebook_items (service_type) where active;
create index if not exists idx_pricebook_name         on public.pricebook_items (lower(name));

create index if not exists idx_estimates_status       on public.estimates (status, created_at desc);
create index if not exists idx_estimates_contact      on public.estimates (contact_id);
create index if not exists idx_estimates_project      on public.estimates (project_id);
create index if not exists idx_estimates_lead         on public.estimates (lead_id);
create index if not exists idx_estimates_assigned     on public.estimates (assigned_to, status);
create index if not exists idx_estimates_valid_until  on public.estimates (valid_until) where valid_until is not null;
create index if not exists idx_estimates_number       on public.estimates (estimate_number);
create index if not exists idx_estimate_lines         on public.estimate_line_items (estimate_id, sort_order);
create index if not exists idx_estimate_photos        on public.estimate_photos (estimate_id, sort_order);

create index if not exists idx_measure_project        on public.roof_measurements (project_id);
create index if not exists idx_measure_estimate       on public.roof_measurements (estimate_id);
create index if not exists idx_measure_address        on public.roof_measurements (lower(address));
create index if not exists idx_measure_status         on public.roof_measurements (status, created_at desc);

create index if not exists idx_import_jobs_status     on public.lead_import_jobs (status, created_at desc);
create index if not exists idx_import_errors_job      on public.lead_import_errors (import_job_id, row_number);

create index if not exists idx_agreements_vendor      on public.subcontractor_agreements (vendor_id, created_at desc);
create index if not exists idx_agreements_status      on public.subcontractor_agreements (status);
create index if not exists idx_agreements_expiration  on public.subcontractor_agreements (expiration_date)
  where expiration_date is not null;

create index if not exists idx_project_photos         on public.project_photos (project_id, phase, sort_order);

create index if not exists idx_projects_schedule      on public.projects (scheduled_start_date, scheduled_end_date);
create index if not exists idx_projects_sched_status  on public.projects (status, scheduled_start_date);

create index if not exists idx_invoices_project       on public.invoices (project_id, issue_date desc);
create index if not exists idx_invoices_status        on public.invoices (status, due_date);
create index if not exists idx_invoices_contact       on public.invoices (contact_id);
create index if not exists idx_invoices_due           on public.invoices (due_date) where status in ('sent','partially_paid');
create index if not exists idx_invoice_items          on public.invoice_items (invoice_id, sort_order);

create index if not exists idx_payments_invoice       on public.payments (invoice_id, created_at desc);
create index if not exists idx_payments_project       on public.payments (project_id);
create index if not exists idx_payments_status        on public.payments (status, received_date desc);
create index if not exists idx_payments_provider      on public.payments (provider, provider_payment_id);
create index if not exists idx_payment_events_lookup  on public.payment_events (provider, provider_event_id);

create index if not exists idx_job_costs_project      on public.job_costs (project_id, cost_date desc);
create index if not exists idx_job_costs_category     on public.job_costs (project_id, category);
create index if not exists idx_job_costs_vendor       on public.job_costs (vendor_id) where vendor_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuses the Phase 1 helper)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'pricebook_items','estimates','estimate_line_items','roof_measurements',
    'subcontractor_agreements','invoices','payments','job_costs'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Invoice balance is derived, never hand-maintained.
-- ----------------------------------------------------------------------------
-- Recomputing from the payments table (rather than incrementing a counter)
-- means a refund, a voided payment or a corrected amount can never leave the
-- balance wrong. Overpayment is preserved as a negative balance so the office
-- can see it and issue a refund, rather than being silently clamped to zero.
-- ---------------------------------------------------------------------------
create or replace function public.recalculate_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid bigint;
  v_total bigint;
  v_status text;
  v_due date;
begin
  select coalesce(sum(amount_cents - refunded_amount_cents), 0)
    into v_paid
    from public.payments
   where invoice_id = p_invoice_id and status = 'succeeded';

  select total_cents, status, due_date into v_total, v_status, v_due
    from public.invoices where id = p_invoice_id;

  if v_status = 'void' or v_status = 'draft' then
    update public.invoices
       set amount_paid_cents = v_paid,
           balance_due_cents = v_total - v_paid
     where id = p_invoice_id;
    return;
  end if;

  update public.invoices
     set amount_paid_cents = v_paid,
         balance_due_cents = v_total - v_paid,
         paid_at = case when v_paid >= v_total and v_total > 0 then coalesce(paid_at, now()) else null end,
         status = case
           when v_total > 0 and v_paid >= v_total then 'paid'
           when v_paid > 0 then 'partially_paid'
           when v_due is not null and v_due < current_date then 'overdue'
           else 'sent'
         end
   where id = p_invoice_id;
end;
$$;

create or replace function public.payments_recalculate_invoice()
returns trigger
language plpgsql
as $$
begin
  perform public.recalculate_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists payments_touch_invoice on public.payments;
create trigger payments_touch_invoice
  after insert or update or delete on public.payments
  for each row execute function public.payments_recalculate_invoice();

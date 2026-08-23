-- ============================================================================
-- Vertical Ops — CRM + Compliance Center
-- Migration 0001: core schema
-- ----------------------------------------------------------------------------
-- Conventions
--   * uuid primary keys (gen_random_uuid)
--   * timestamptz created_at / updated_at with a shared trigger
--   * money is stored as *_cents bigint (never floating point)
--   * status columns are text + CHECK constraints (easier to extend than enums)
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'office'
    check (role in ('admin','office','project_manager','read_only')),
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a Supabase auth user is created.
-- The first user to sign up becomes admin; everyone after that defaults to office.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count integer;
begin
  select count(*) into existing_count from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when existing_count = 0 then 'admin' else 'office' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- app_settings  (single-row configuration)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id text primary key default 'default',
  warning_window_days integer not null default 30,
  reminder_thresholds integer[] not null default '{60,30,7,0}',
  company_name text not null default 'Vertical Builders & Commercial',
  company_email text not null default 'Office@verticalbc.com',
  company_phone text not null default '941-877-2009',
  max_upload_mb integer not null default 10,
  upload_token_ttl_days integer not null default 14,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values ('default') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'website',
  source_page text,
  source_metadata jsonb not null default '{}'::jsonb,   -- utm_*, referrer, landing page
  first_name text not null,
  last_name text,
  company_name text,
  email text,
  phone text,
  preferred_contact_method text,
  customer_type text check (customer_type in ('residential','commercial') or customer_type is null),
  service_type text,
  property_address text,
  city text,
  state text default 'FL',
  zip text,
  project_description text,
  financing_interest boolean default false,
  timeline text,
  estimated_budget_cents bigint,
  assigned_to uuid references public.profiles(id) on delete set null,
  pipeline_stage text not null default 'new'
    check (pipeline_stage in (
      'new','contact_attempted','contacted','consultation_scheduled','inspection_complete',
      'estimate_in_progress','estimate_sent','follow_up','won','lost')),
  lead_score integer,
  notes_summary text,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  lost_reason text,
  converted_contact_id uuid,
  converted_project_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- contacts / customers
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  contact_type text not null default 'homeowner'
    check (contact_type in ('homeowner','business','property_manager','other')),
  first_name text,
  last_name text,
  company_name text,
  email text,
  phone text,
  secondary_phone text,
  preferred_contact_method text,
  billing_address text,
  city text,
  state text default 'FL',
  zip text,
  tags text[] not null default '{}',
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create sequence if not exists public.project_number_seq start 1001;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_number text unique not null
    default ('VBC-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.project_number_seq')::text, 4, '0')),
  project_name text not null,
  customer_id uuid references public.contacts(id) on delete set null,
  jobsite_address text,
  city text,
  state text default 'FL',
  zip text,
  customer_type text check (customer_type in ('residential','commercial') or customer_type is null),
  service_category text,
  description text,
  status text not null default 'prospect'
    check (status in ('prospect','estimate','preconstruction','permitting','scheduled',
                      'in_progress','on_hold','final_walkthrough','complete','cancelled')),
  estimator_id uuid references public.profiles(id) on delete set null,
  project_manager_id uuid references public.profiles(id) on delete set null,
  start_date date,
  estimated_completion_date date,
  actual_completion_date date,
  estimate_amount_cents bigint,
  contract_amount_cents bigint,
  permit_number text,
  permit_status text,
  insurance_claim_related boolean not null default false,
  insurance_carrier text,
  insurance_claim_number text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vendors / subcontractors
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  dba text,
  vendor_type text not null default 'subcontractor'
    check (vendor_type in ('subcontractor','supplier','consultant','other')),
  primary_trade text,
  trades text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','active','inactive','blocked')),
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  secondary_contact text,
  address text,
  city text,
  state text default 'FL',
  zip text,
  ein_last4 text check (ein_last4 is null or ein_last4 ~ '^[0-9]{4}$'),
  license_number text,
  license_type text,
  license_expiration_date date,
  w9_status text not null default 'missing'
    check (w9_status in ('missing','on_file','expired')),
  default_requirement_template_id uuid,
  notes text,
  -- denormalised compliance cache (authoritative value is always recomputed by
  -- the evaluator; these columns exist only so lists can sort/filter fast)
  compliance_status text not null default 'missing'
    check (compliance_status in ('compliant','expiring_soon','needs_review','missing','non_compliant','waived')),
  compliance_checked_at timestamptz,
  earliest_expiration_date date,
  last_reviewed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- project <-> vendor assignment
-- ---------------------------------------------------------------------------
create table if not exists public.project_vendors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  scope_of_work text,
  start_date date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (project_id, vendor_id)
);

-- ---------------------------------------------------------------------------
-- documents (private vault)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('vendor','project','contact','lead','audit')),
  entity_id uuid not null,
  document_type text not null check (document_type in (
    'coi','insurance_endorsement','workers_comp_exemption','w9','contractor_license',
    'business_license','subcontractor_agreement','contract','permit','inspection',
    'estimate','change_order','invoice','warranty','photo','audit_package','other')),
  original_filename text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  document_date date,
  expiration_date date,
  version integer not null default 1,
  tags text[] not null default '{}',
  description text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ---------------------------------------------------------------------------
-- insurance certificates  (never deleted — renewals create new versions)
-- ---------------------------------------------------------------------------
create table if not exists public.insurance_certificates (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  document_id uuid references public.documents(id) on delete set null,
  received_at timestamptz not null default now(),
  issue_date date,
  broker_name text,
  broker_contact_name text,
  broker_email text,
  broker_phone text,
  named_insured text,
  certificate_holder text default 'Vertical Builders & Commercial',
  source text not null default 'admin_upload'
    check (source in ('admin_upload','vendor_portal','email_manual')),
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review','approved','rejected','replaced','archived')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_notes text,
  replaced_certificate_id uuid references public.insurance_certificates(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.certificate_projects (
  certificate_id uuid not null references public.insurance_certificates(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  primary key (certificate_id, project_id)
);

-- ---------------------------------------------------------------------------
-- insurance policy lines  (one COI => many coverage lines)
-- ---------------------------------------------------------------------------
create table if not exists public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.insurance_certificates(id) on delete cascade,
  coverage_type text not null check (coverage_type in (
    'general_liability','workers_compensation','commercial_auto','umbrella',
    'professional_liability','pollution_liability','other')),
  carrier text,
  naic text,
  policy_number text,
  effective_date date,
  expiration_date date,
  limits_json jsonb not null default '{}'::jsonb,   -- whole dollars, integers only
  additional_insured boolean,
  waiver_of_subrogation boolean,
  primary_noncontributory boolean,
  claims_made boolean,
  occurrence_form boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- insurance requirements  (global / trade / project scoped templates)
-- ---------------------------------------------------------------------------
create table if not exists public.insurance_requirement_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope text not null default 'global' check (scope in ('global','trade','project')),
  trade text,
  project_id uuid references public.projects(id) on delete cascade,
  active boolean not null default true,
  disclaimer text default 'Verify these requirements with Vertical Builders & Commercial''s insurance professional before relying on them.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_scope_shape check (
    (scope = 'global'  and trade is null and project_id is null) or
    (scope = 'trade'   and trade is not null and project_id is null) or
    (scope = 'project' and project_id is not null)
  )
);

create table if not exists public.insurance_requirements (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.insurance_requirement_templates(id) on delete cascade,
  coverage_type text not null check (coverage_type in (
    'general_liability','workers_compensation','commercial_auto','umbrella',
    'professional_liability','pollution_liability','other')),
  required boolean not null default true,
  min_limit_each_occurrence bigint,
  min_limit_aggregate bigint,
  min_combined_single_limit bigint,
  min_workers_comp_el bigint,
  additional_insured_required boolean not null default false,
  waiver_of_subrogation_required boolean not null default false,
  primary_noncontributory_required boolean not null default false,
  endorsement_required boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (template_id, coverage_type)
);

alter table public.vendors
  drop constraint if exists vendors_default_requirement_template_id_fkey;
alter table public.vendors
  add constraint vendors_default_requirement_template_id_fkey
  foreign key (default_requirement_template_id)
  references public.insurance_requirement_templates(id) on delete set null;

-- ---------------------------------------------------------------------------
-- compliance reviews & waivers
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  status text not null check (status in
    ('compliant','expiring_soon','needs_review','missing','non_compliant','waived')),
  results_json jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  notes text
);

create table if not exists public.compliance_waivers (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  coverage_type text,
  requirement_id uuid references public.insurance_requirements(id) on delete set null,
  reason text not null,
  approved_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tasks / notes
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_date timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  related_entity_type text,
  related_entity_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit center
-- ---------------------------------------------------------------------------
create table if not exists public.audit_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  audit_period_start date not null,
  audit_period_end date not null,
  due_date date,
  status text not null default 'draft'
    check (status in ('draft','preparing','ready','submitted','closed')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  constraint audit_period_valid check (audit_period_end >= audit_period_start)
);

create table if not exists public.audit_exports (
  id uuid primary key default gen_random_uuid(),
  audit_cycle_id uuid references public.audit_cycles(id) on delete cascade,
  filters_json jsonb not null default '{}'::jsonb,
  snapshot_json jsonb not null default '{}'::jsonb,
  storage_path text,
  filename text,
  size_bytes bigint,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vendor self-service upload tokens (hashed — plaintext is never stored)
-- ---------------------------------------------------------------------------
create table if not exists public.upload_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  requested_document_type text not null default 'coi',
  message text,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notification + activity logs
-- ---------------------------------------------------------------------------
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references public.vendors(id) on delete set null,
  policy_id uuid references public.insurance_policies(id) on delete set null,
  notification_type text not null,
  threshold_days integer,
  recipient text,
  status text not null check (status in ('sent','skipped','failed','logged')),
  error_message text,
  sent_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_label text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_leads_stage_created      on public.leads (pipeline_stage, created_at desc);
create index if not exists idx_leads_created            on public.leads (created_at desc);
create index if not exists idx_leads_follow_up          on public.leads (next_follow_up_at) where next_follow_up_at is not null;
create index if not exists idx_leads_email              on public.leads (lower(email));
create index if not exists idx_contacts_name            on public.contacts (lower(last_name), lower(first_name));
create index if not exists idx_contacts_company         on public.contacts (lower(company_name));
create index if not exists idx_projects_status          on public.projects (status, created_at desc);
create index if not exists idx_projects_customer        on public.projects (customer_id);
create index if not exists idx_projects_number          on public.projects (project_number);
create index if not exists idx_vendors_name             on public.vendors (lower(legal_name));
create index if not exists idx_vendors_status           on public.vendors (status);
create index if not exists idx_vendors_trade            on public.vendors (primary_trade);
create index if not exists idx_vendors_compliance       on public.vendors (compliance_status);
create index if not exists idx_project_vendors_project  on public.project_vendors (project_id);
create index if not exists idx_project_vendors_vendor   on public.project_vendors (vendor_id);
create index if not exists idx_project_vendors_dates    on public.project_vendors (start_date, end_date);
create index if not exists idx_certificates_vendor      on public.insurance_certificates (vendor_id, received_at desc);
create index if not exists idx_certificates_review      on public.insurance_certificates (review_status);
create index if not exists idx_policies_certificate     on public.insurance_policies (certificate_id);
create index if not exists idx_policies_expiration      on public.insurance_policies (expiration_date);
create index if not exists idx_policies_coverage        on public.insurance_policies (coverage_type);
create index if not exists idx_policies_period          on public.insurance_policies (effective_date, expiration_date);
create index if not exists idx_documents_entity         on public.documents (entity_type, entity_id);
create index if not exists idx_documents_type           on public.documents (document_type);
create index if not exists idx_documents_expiration     on public.documents (expiration_date) where expiration_date is not null;
create index if not exists idx_tasks_assigned           on public.tasks (assigned_to, status, due_date);
create index if not exists idx_tasks_related            on public.tasks (related_entity_type, related_entity_id);
create index if not exists idx_notes_entity             on public.notes (entity_type, entity_id, created_at desc);
create index if not exists idx_audit_period             on public.audit_cycles (audit_period_start, audit_period_end);
create index if not exists idx_audit_exports_cycle      on public.audit_exports (audit_cycle_id, generated_at desc);
create index if not exists idx_activity_entity          on public.activity_log (entity_type, entity_id, created_at desc);
create index if not exists idx_activity_created         on public.activity_log (created_at desc);
create index if not exists idx_notification_dedupe      on public.notification_log (policy_id, threshold_days, notification_type);
create index if not exists idx_upload_tokens_vendor     on public.upload_tokens (vendor_id, created_at desc);
create index if not exists idx_requirements_template    on public.insurance_requirements (template_id);
create index if not exists idx_templates_scope          on public.insurance_requirement_templates (scope, trade, project_id) where active;
create index if not exists idx_waivers_vendor           on public.compliance_waivers (vendor_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','leads','contacts','projects','vendors','insurance_certificates',
    'insurance_policies','insurance_requirement_templates','tasks','notes','app_settings'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ============================================================================
-- Vertical Ops — Migration 0002: Row Level Security
-- ----------------------------------------------------------------------------
-- Roles are ALWAYS read from public.profiles using auth.uid(). A client can
-- never assert its own role. Public (anon) traffic gets zero table access:
-- the lead intake and vendor COI upload flows run through server route handlers
-- that use a tightly scoped service-role client.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- role helpers (security definer so they can read profiles under RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.current_role() = 'admin' $$;

create or replace function public.is_staff() returns boolean
language sql stable as $$ select public.current_role() in ('admin','office') $$;

-- can create/update operational (non-compliance-rule) records
create or replace function public.can_write() returns boolean
language sql stable as $$ select public.current_role() in ('admin','office','project_manager') $$;

-- any active signed-in user (includes read_only / auditor)
create or replace function public.can_read() returns boolean
language sql stable as $$
  select public.current_role() in ('admin','office','project_manager','read_only')
$$;

-- ---------------------------------------------------------------------------
-- enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','app_settings','leads','contacts','projects','vendors','project_vendors',
    'documents','insurance_certificates','certificate_projects','insurance_policies',
    'insurance_requirement_templates','insurance_requirements','compliance_reviews',
    'compliance_waivers','tasks','notes','audit_cycles','audit_exports','upload_tokens',
    'notification_log','activity_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_read());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role());  -- cannot self-promote

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- app_settings — everyone reads, admin/office writes
-- ---------------------------------------------------------------------------
drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings
  for select to authenticated using (public.can_read());

drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Operational records: read = any active user, write = admin/office/PM
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'leads','contacts','projects','vendors','project_vendors','documents',
    'insurance_certificates','certificate_projects','insurance_policies',
    'compliance_reviews','tasks','notes','audit_cycles','audit_exports'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read())',
      t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_write())',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.can_write()) with check (public.can_write())',
      t || '_update', t);

    -- hard DELETE is admin-only everywhere; the app prefers archive/soft-delete
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin())',
      t || '_delete', t);
  end loop;
end $$;

-- Compliance history must never be destroyed, not even by an admin, through the
-- API. Replace the delete policies on the audit-critical tables with "false".
drop policy if exists insurance_certificates_delete on public.insurance_certificates;
drop policy if exists insurance_policies_delete    on public.insurance_policies;
drop policy if exists compliance_reviews_delete    on public.compliance_reviews;
drop policy if exists audit_exports_delete         on public.audit_exports;

-- ---------------------------------------------------------------------------
-- Insurance requirement rules: admin + office only may change them
-- (project managers explicitly cannot per spec §7)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['insurance_requirement_templates','insurance_requirements']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_read())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (public.is_staff()) with check (public.is_staff())', t || '_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Waivers: admin/office create; nobody deletes (revoke instead)
-- ---------------------------------------------------------------------------
drop policy if exists waivers_read on public.compliance_waivers;
create policy waivers_read on public.compliance_waivers
  for select to authenticated using (public.can_read());

drop policy if exists waivers_insert on public.compliance_waivers;
create policy waivers_insert on public.compliance_waivers
  for insert to authenticated with check (public.is_staff() and approved_by = auth.uid());

drop policy if exists waivers_update on public.compliance_waivers;
create policy waivers_update on public.compliance_waivers
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Logs: readable by all active users, insert-only, never mutated or deleted
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['activity_log','notification_log']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_read())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_read())', t || '_insert', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Upload tokens: staff may create/revoke and see metadata. The public upload
-- page never queries this table directly — validation happens server-side with
-- the service role, which bypasses RLS by design.
-- ---------------------------------------------------------------------------
drop policy if exists upload_tokens_read on public.upload_tokens;
create policy upload_tokens_read on public.upload_tokens
  for select to authenticated using (public.can_read());

drop policy if exists upload_tokens_write on public.upload_tokens;
create policy upload_tokens_write on public.upload_tokens
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Belt and braces: the anon role gets nothing.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

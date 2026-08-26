-- ============================================================================
-- Vertical Ops — Migration 0006: RLS for the Phase 2 tables
-- ----------------------------------------------------------------------------
-- Same model as Phase 1: roles are read from public.profiles via auth.uid(),
-- never asserted by the client. The helper functions current_role(), is_admin(),
-- is_staff(), can_write() and can_read() were created in 0002 and are reused.
--
-- Two new ideas in this migration:
--   1. Financial visibility is configurable. Whether a project manager can see
--      job costs and profitability is a company decision, so it lives in
--      app_settings and is enforced in SQL, not only in the UI.
--   2. Payments are insert/update only. A payment record is financial history;
--      corrections are made by voiding or refunding, never by deleting.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Financial visibility helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_view_costs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() in ('admin','office') then true
    when public.current_role() = 'project_manager'
      then coalesce((select costs_visible_to_pm from public.app_settings where id = 'default'), true)
    -- read_only is the auditor role: compliance visibility, no financial
    -- visibility. See migration 0009 for the full reasoning.
    when public.current_role() = 'read_only' then false
    else false
  end
$$;

create or replace function public.can_edit_costs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin','office','project_manager')
$$;

-- Profitability is a separate decision from cost entry: a PM may be trusted to
-- enter a material receipt without being shown the company's margin.
create or replace function public.can_view_profit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() in ('admin','office') then true
    when public.current_role() = 'project_manager'
      then coalesce((select profit_visible_to_pm from public.app_settings where id = 'default'), false)
    -- read_only is the auditor role: compliance visibility, no financial
    -- visibility. See migration 0009 for the full reasoning.
    when public.current_role() = 'read_only' then false
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every new table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'pricebook_items','estimates','estimate_line_items','estimate_photos',
    'roof_measurements','lead_import_jobs','lead_import_errors',
    'subcontractor_agreements','project_photos','invoices','invoice_items',
    'payments','payment_events','job_costs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Operational tables: read = any active user, write = admin/office/PM
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'estimates','estimate_line_items','estimate_photos','roof_measurements',
    'subcontractor_agreements','project_photos','lead_import_jobs','lead_import_errors'
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

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_staff())',
      t || '_delete', t);
  end loop;
end $$;

-- An estimate that has been sent, approved or converted is a record of what the
-- customer was told. It can be voided by status, never deleted.
drop policy if exists estimates_delete on public.estimates;
create policy estimates_delete on public.estimates
  for delete to authenticated
  using (public.is_staff() and status in ('draft','ai_draft','measuring'));

-- ---------------------------------------------------------------------------
-- Pricebook: everyone reads, admin/office maintains
-- ---------------------------------------------------------------------------
drop policy if exists pricebook_read on public.pricebook_items;
create policy pricebook_read on public.pricebook_items
  for select to authenticated using (public.can_read());

drop policy if exists pricebook_write on public.pricebook_items;
create policy pricebook_write on public.pricebook_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Invoices and invoice items
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_items']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read())',
      t || '_read', t);

    -- Only admin and office may create or change money owed.
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_staff())',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_staff()) with check (public.is_staff())',
      t || '_update', t);
  end loop;
end $$;

-- A draft invoice was never shown to a customer, so it may be discarded.
-- Anything beyond draft is a financial record: void it instead.
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete to authenticated
  using (public.is_admin() and status = 'draft');

drop policy if exists invoice_items_delete on public.invoice_items;
create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using (public.is_staff() and exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id and i.status = 'draft'));

-- ---------------------------------------------------------------------------
-- Payments: insert and update only. No delete policy exists at all.
-- ---------------------------------------------------------------------------
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select to authenticated using (public.can_read());

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated with check (public.is_staff());

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- Webhook ledger is written by the service role only; staff may read it for
-- troubleshooting a payment that did not land.
drop policy if exists payment_events_read on public.payment_events;
create policy payment_events_read on public.payment_events
  for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Job costs: visibility follows the configurable company setting
-- ---------------------------------------------------------------------------
drop policy if exists job_costs_read on public.job_costs;
create policy job_costs_read on public.job_costs
  for select to authenticated using (public.can_view_costs());

drop policy if exists job_costs_insert on public.job_costs;
create policy job_costs_insert on public.job_costs
  for insert to authenticated with check (public.can_edit_costs());

drop policy if exists job_costs_update on public.job_costs;
create policy job_costs_update on public.job_costs
  for update to authenticated using (public.can_edit_costs()) with check (public.can_edit_costs());

drop policy if exists job_costs_delete on public.job_costs;
create policy job_costs_delete on public.job_costs
  for delete to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- The anon role gets nothing here either.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

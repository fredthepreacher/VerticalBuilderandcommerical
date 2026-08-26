-- ============================================================================
-- Vertical Ops — Migration 0009: auditor role loses financial visibility
-- ----------------------------------------------------------------------------
-- The `read_only` role is the Auditor. It exists so an insurance auditor or an
-- outside reviewer can verify certificates, policy lines and six-month audit
-- history without being handed the company's job margins at the same time.
--
-- As originally written, `can_view_costs()` and `can_view_profit()` both
-- returned true for `read_only`. That was consistent between the SQL and the
-- TypeScript permission map, so it was deliberate rather than a bug — but it is
-- the wrong default for the role's actual purpose, and Vertical Builders has
-- asked for it closed.
--
-- After this migration `read_only` cannot read:
--   * job_costs rows (the RLS SELECT policy on job_costs calls can_view_costs())
--   * any cost total derived from them
--   * gross profit, gross margin, or profitability reporting
--
-- It keeps everything it needs to do its job: contacts, projects, vendors,
-- certificates, policy lines, compliance reviews, documents, audit cycles and
-- audit exports.
--
-- Admin and office are unaffected — always true.
-- Project manager is unaffected — still driven by the two configurable settings
-- `costs_visible_to_pm` and `profit_visible_to_pm`.
--
-- This migration exists separately from 0006 (which has been corrected for
-- fresh installs) so that a database where 0006 was already applied is fixed
-- too. Both use `create or replace`, so applying either order is safe and the
-- final state is identical. Idempotent; no table, column or policy is changed.
-- ============================================================================

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
    -- Auditor: compliance visibility, no financial visibility.
    when public.current_role() = 'read_only' then false
    else false
  end
$$;

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
    -- Auditor: compliance visibility, no financial visibility.
    when public.current_role() = 'read_only' then false
    else false
  end
$$;

-- can_edit_costs() already excluded read_only. Restated here only so the whole
-- financial-permission surface is visible in one place.
create or replace function public.can_edit_costs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin','office','project_manager')
$$;

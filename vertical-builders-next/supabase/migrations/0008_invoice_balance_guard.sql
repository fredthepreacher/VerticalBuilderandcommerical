-- ============================================================================
-- Vertical Ops — Migration 0008: invoice balance guard
-- ----------------------------------------------------------------------------
-- Fixes a real drift found during production-readiness verification.
--
-- `balance_due_cents` is read in eight places — the dashboard "Outstanding"
-- figure, the invoice list total, the job Financials tab, the Pay-now action,
-- and validatePaymentAmount(). Until now it was only recomputed by the trigger
-- on `payments`. Two paths left it stale:
--
--   1. A newly inserted invoice that did not explicitly set it showed a $0
--      balance until the first payment arrived — so an issued, unpaid invoice
--      read as nothing outstanding.
--   2. Editing a draft invoice's line items changed `total_cents` but left
--      `balance_due_cents` at the old amount.
--
-- The invariant is simply `balance_due_cents = total_cents - amount_paid_cents`.
-- Enforcing it in the database rather than in one more call site means no
-- future writer — a server action, a SQL fix-up, a support script — can get it
-- wrong. The payments trigger already sets both columns together, and this
-- runs BEFORE the row is written, so the two agree by construction.
--
-- Additive and idempotent. No column, table or policy is changed.
-- ============================================================================

create or replace function public.invoices_sync_balance()
returns trigger
language plpgsql
as $$
begin
  new.balance_due_cents := coalesce(new.total_cents, 0) - coalesce(new.amount_paid_cents, 0);
  return new;
end;
$$;

drop trigger if exists invoices_sync_balance on public.invoices;
create trigger invoices_sync_balance
  before insert or update on public.invoices
  for each row execute function public.invoices_sync_balance();

-- Repair any rows already written with a stale balance.
update public.invoices
   set balance_due_cents = coalesce(total_cents, 0) - coalesce(amount_paid_cents, 0)
 where balance_due_cents is distinct from (coalesce(total_cents, 0) - coalesce(amount_paid_cents, 0));

# Invoicing, payments and job costing

## Tables

```
invoices        one per bill, numbered INV-YY-NNNN, linked to a project
  └── invoice_items
  └── payments          one row per money movement
payment_events          raw provider events, for idempotency and audit
job_costs               what the job actually cost
```

## The balance rule

**An invoice balance is always recomputed from its payments. It is never
incremented.**

That rule lives in two places that must agree:

- `recalculate_invoice_totals()` in migration `0005`, fired by a trigger on
  every insert, update and delete on `payments`. The database is authoritative.
- `applyPayments()` in `lib/ops/finance/calc.ts` — the same arithmetic as a pure
  function, so the UI and the tests can use it without a round trip.

Recomputing rather than incrementing means a refund, a voided payment or a
corrected amount can never leave a balance quietly wrong.

Only payments with status `succeeded` count, and `refunded_amount_cents` is
subtracted from each. Status follows from the numbers:

| Condition | Status |
| --- | --- |
| total > 0 and paid ≥ total | `paid` |
| paid > 0 but < total | `partially_paid` |
| nothing paid and past the due date | `overdue` |
| otherwise | `sent` |

A `draft` or `void` invoice keeps its status regardless of payment activity.

**Overpayment is surfaced, never clamped.** The balance goes negative,
`overpaidCents` is set, and the invoice screen says so — because the office
needs to see it to issue a refund. Recording an overpayment manually requires
ticking an acknowledgement, so it cannot happen by a slipped decimal point.

## Online payments

Stripe **hosted checkout**. Card and bank details are entered on Stripe's page,
never in Vertical Ops — the application never sees, transmits or stores a card
number or a bank account.

The flow:

1. Office sends the invoice. Customer clicks Pay.
2. `stripeProvider.createPaymentSession` creates a Checkout Session with an
   idempotency key of `inv_<id>_<amount>`, a 24-hour expiry, and the invoice id
   in metadata.
3. Customer pays on Stripe.
4. **Stripe calls `POST /api/webhooks/stripe`.** The raw body is read with
   `request.text()` and the signature is verified with `constructEvent`, which
   checks the HMAC *and* the timestamp tolerance — that is what stops an
   attacker replaying a genuine old event.
5. The verified event is written to `payment_events`, a `payments` row is
   created or updated, and the trigger recomputes the invoice.

**The browser redirect back from Stripe is never treated as proof of payment.**
It only shows a "we're confirming this" screen. Only the signed webhook moves
money in the CRM.

**Idempotency**: `payment_events` has a unique index on
`(provider, provider_event_id)`. A replayed delivery hits `23505` and returns
`{ received: true, duplicate: true }` — one event, one payment, no double
credit.

A webhook that fails while being processed still returns 200, with the failure
recorded as `status: 'failed'` in `payment_events`. Returning 500 would make
Stripe retry the same broken event indefinitely; the record is the thing that
needs looking at.

Handled events: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
Anything else is logged and ignored.

Without Stripe keys, invoices and payment recording work normally — the office
records the check. Settings → Payments reports exactly which environment
variables are missing rather than leaving someone to wonder why the Pay button
is absent. It also reports whether the keys are **live or test**, so nobody
discovers after a month that no real money moved.

## Voids and refunds

- An invoice can only be **edited** while it is a draft.
- An invoice can only be **deleted** while it is a draft (enforced in RLS).
- **Voiding refuses** if any payment is attached — void is for a bill that was
  wrong, not for one that was paid.
- A Stripe payment **cannot be voided in Vertical Ops**. Refund it in Stripe;
  the `charge.refunded` webhook brings the refund back and the balance
  recomputes. Voiding it locally would make the two systems disagree.
- `payments` has insert and update policies but **no delete policy**. Money
  movements are history.

## Job costing and profit

`job_costs`: category (labor, materials, subcontractor, equipment, permit fees,
disposal, delivery, other), description, amount, date, optional vendor, optional
receipt document.

```
Gross profit = contract amount − total job cost
Gross margin = gross profit ÷ contract amount × 100
```

**When there is no contract amount, both come back `null` with a stated
reason** — not 0%. A fake 0% reads as "this job loses money" and is worse than
an honest em dash. Costs are still reported, because they are known even when
the margin is not.

A negative margin is reported as a negative margin. The disclaimer travels with
the number:

> Gross profit is the contract amount less costs entered in Vertical Ops. It
> does not include company overhead, tax, financing, or accounting adjustments,
> and it is not a substitute for your accountant's figures.

## Who can see money

Two separate permissions, both configurable in Settings → Financial access:

| Role | Costs | Profit |
| --- | --- | --- |
| Owner / admin | always | always |
| Office | always | always |
| Project manager | `costs_visible_to_pm` (default **on**) | `profit_visible_to_pm` (default **off**) |
| Read-only / auditor | **never** | **never** |

The switches are read by the RLS helpers `can_view_costs()` and
`can_view_profit()` as well as by the UI, so turning one off removes the rows
from the query rather than only hiding a panel.

### The auditor role is blind to money

`read_only` is the Auditor. It exists so an insurance auditor or an outside
reviewer can verify certificates, policy lines and six-month audit history
**without being handed the company's job margins at the same time**. It cannot
see job costs, individual cost records, gross profit, gross margin, or any
profitability figure.

This is enforced in two independent places, and both must agree:

| Layer | Where | What it does |
| --- | --- | --- |
| Database | `can_view_costs()` / `can_view_profit()` — migration `0009` | The RLS SELECT policy on `job_costs` calls `can_view_costs()`, so the rows are **filtered out of the query**. An auditor querying the table directly gets zero rows. |
| Application | `costsView` / `profitabilityView` in `lib/ops/auth/permissions.ts` | Decides what renders, and stops the server action fetching costs at all. |

The database is the real boundary; the TypeScript map only decides what is
drawn. Verified against PostgreSQL 16: an auditor sees **0** of 3 cost rows,
cannot insert, and cannot update or delete.

Where costs are hidden, the UI says **Hidden**, never `$0.00`. A hidden cost
total and a genuinely zero-cost job would otherwise look identical, and the
reader would have no way to tell which one they were looking at.

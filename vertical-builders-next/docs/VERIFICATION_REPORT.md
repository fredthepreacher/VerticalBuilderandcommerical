# Production readiness verification — 2026-08-23

An end-to-end verification pass over the Phase 2 build. No features were added
and nothing was redesigned. Four defects were found and fixed; three
discrepancies were found and are reported below for the client to decide on.

**The single most important finding: the Vertical Ops CRM is not deployed
anywhere.** See §1.

---

## 1. Deployment status — NOT DEPLOYED

| Question | Answer |
| --- | --- |
| Is there a live Vertical Ops CRM? | **No.** |
| Vercel project | `vertical-builderandcommerical` (team `wavysites-projects`, Hobby plan) |
| Linked repo | `github.com/fredthepreacher/VerticalBuilderandcommerical` |
| Live production deployment | `dpl_7t2LKcbGBxjkvW9hYCjw74UB1X9V`, state READY |
| Live commit | `4237d4c4c66299abc4249949a0c8277d4996dc59` — *"Update Google Analytics measurement ID"* |
| What that commit contains | The **marketing site only**, from before Phase 1 |
| Phase 1 CRM in that repo? | No |
| Phase 2 CRM in that repo? | No |

Phase 1 and Phase 2 were both delivered as ZIP archives into
`Claude\Projects\Vertical General contractors`. Neither was committed or
pushed. There is no git repository in the delivered project folder, so **there
is no commit hash for the CRM and no deployment URL for it.**

Everything verified below was verified against the delivered source and a real
PostgreSQL 16 database stood up locally for the purpose — not against a live
system, because no live system exists yet.

---

## 2. Defects found and fixed

### 2.1 Migration 0007 double-seeded the pricebook — FIXED

`0007_starter_pricebook.sql` ended with `on conflict do nothing`, but there was
no unique constraint for it to conflict on — the only unique column was the
primary key, which is a fresh `gen_random_uuid()` on every run. Running the
migration twice produced **52 pricebook items instead of 26**, every one of
them an unpriced duplicate in the estimate picker.

This was not hypothetical: `docs/DEPLOYMENT.md` tells the operator to paste
migrations into the Supabase SQL editor one at a time, which is exactly the
situation where one gets run twice.

**Fix:** `0007` now dedupes by name, creates `pricebook_items_name_key`, and
uses `on conflict (name) do nothing`. Verified: two full passes over a clean
database produce 26 rows both times.

### 2.2 Invoice `balance_due_cents` drifted from the total — FIXED

`balance_due_cents` is read in eight places, including the dashboard
*Outstanding* figure, the invoice list total, the job Financials tab, the
Pay-now action and `validatePaymentAmount()`. It was only ever recomputed by
the trigger on `payments`. Two paths left it wrong:

1. An invoice inserted without explicitly setting it showed a **$0 balance
   until the first payment arrived** — so an issued, unpaid invoice read as
   nothing outstanding.
2. Editing a draft invoice's line items changed `total_cents` but left
   `balance_due_cents` at the old amount. Reproduced: total edited from
   $1,000 to $5,000, balance stayed at $1,000.

**Fix:** new migration `0008_invoice_balance_guard.sql` adds a BEFORE INSERT OR
UPDATE trigger enforcing `balance_due_cents = total_cents − amount_paid_cents`,
and repairs any row already stale. The `saveInvoice` update path in
`lib/ops/services/invoices.ts` now sets it too. Verified against both the new
trigger and the existing payments trigger — the two agree.

### 2.3 Documentation described a "Field" role that does not exist — FIXED

`docs/FINANCIALS.md` and the Settings → Financial access screen both described
a **Field** role. The schema allows only four roles —
`admin`, `office`, `project_manager`, `read_only` — and inserting `field` fails
the `profiles_role_check` constraint. Corrected in both places.

### 2.4 Three environment variables were undocumented — FIXED

`EAGLEVIEW_API_BASE`, `EAGLEVIEW_REPORT_TYPE` and `NEARMAP_API_BASE` are read
by `lib/ops/measurements/provider.ts` but appeared in no documentation.
`EAGLEVIEW_REPORT_TYPE` decides **which paid report gets ordered**, so leaving
it undiscoverable was the worst of the three. All are now in `.env.example`
with their defaults and a cost warning. Every other variable the code reads is
documented; nothing documented is unread.

---

## 3. Discrepancies for the client to decide

### 3.1 The Auditor role can see job costs and gross margin — RESOLVED 2026-08-23

As found, `read_only` — labelled *Auditor* — **could read costs and profit**.
Both the SQL helpers and the TypeScript permission map agreed on it, so it was
deliberate rather than a bug, but it was the wrong default for a role also used
by outside insurance auditors.

**Resolved.** Vertical Builders asked for this closed. Migration
`0009_auditor_financial_lockdown.sql` sets both helpers to `false` for
`read_only`, and `costsView` / `profitabilityView` no longer include it.
Verified against PostgreSQL 16: the auditor now sees **0** of 3 cost rows and
cannot insert, update or delete them, while admin, office and the configurable
project-manager switches are unchanged.

### 3.1b Data API grants were missing entirely — FIXED 2026-08-24

Found when the first real Supabase project was connected: the dashboard
rendered **completely blank** after a successful sign-in.

Migrations 0001–0009 create tables, enable RLS and write policies, but never
`GRANT` anything to `authenticated`. Supabase normally covers that with its
*Automatically expose new tables* project setting; that setting was off, so the
role had row-level policies permitting access and no table-level privileges to
exercise them. Every PostgREST query failed and every screen came back empty.

**Fix:** migration `0010_data_api_grants.sql` issues the grants in the schema
itself — tables, sequences and functions, for `authenticated` and
`service_role` — plus `ALTER DEFAULT PRIVILEGES` so the next migration that adds
a table cannot reintroduce the same bug. `anon` is revoked, as in 0002 and 0006.

Verified against PostgreSQL 16 that the grants change **no** row boundary:

| Check | Result |
| --- | --- |
| `authenticated` SELECT/INSERT on all tables | 36 / 36 |
| `anon` grants | **0** |
| USAGE on the three numbering sequences | authenticated yes, anon no |
| RLS enabled and forced | still 36 / 36 |
| Auditor reading `job_costs` (has SELECT granted) | **0 rows** — RLS still filters |
| Auditor inserting a cost (has INSERT granted) | **blocked by policy** |
| Admin deleting payments / policies / activity (has DELETE granted) | **0 rows** — no policy exists |
| anon reading `job_costs` / `contacts` | **permission denied** |
| A brand-new table created afterwards | authenticated yes, anon no |

Grants and RLS are independent gates and a query must pass both. Granting the
privilege only allows the statement to be attempted; the policies still decide
which rows it touches.

### 3.2 Expiry reasons interpolate the raw date value

`evaluator.ts` builds reason strings with `${policy.expiration_date}` directly.
Under supabase-js, `date` columns arrive as ISO strings and this renders
correctly. It only degrades if the data source ever returns `Date` objects.
Not a production defect today; left unchanged deliberately, since this pass was
not authorised to modify working product code.

### 3.3 Pricebook is entirely unpriced

All 26 items are $0 by design. Estimates cannot be sent while a line references
an unpriced item, so this blocks commercial use until Vertical Builders supplies
pricing. Full inventory in §7.

---

## 4. What was actually verified

Verified against a real PostgreSQL 16 instance with the Supabase-managed schemas
(`auth`, `storage`, the `anon`/`authenticated`/`service_role` roles) recreated
so the real migrations could be applied unmodified.

### Schema and migrations

| Check | Result |
| --- | --- |
| All 9 migrations apply in order on a clean database | **Pass** |
| All 9 re-run cleanly (idempotent) | **Pass** — identical schema, 26 pricebook rows both passes |
| Table count | 36 under `public` |
| RLS enabled on every public table | **Pass** — 0 tables without it |
| RLS **forced** on every public table | **Pass** — 0 tables without it |
| `insurance_certificates`, `insurance_policies`, `compliance_reviews`, `audit_exports`, `payments`, `payment_events`, `activity_log` DELETE policies | **0** on every one |
| Invoice DELETE policy | `is_admin() AND status = 'draft'` |
| Storage bucket `vertical-private-documents` | `public = false`, 10 MB limit |

### RLS enforcement, exercised as each real role

| Actor | Result |
| --- | --- |
| admin | sees 3 job costs, 3 invoices; `can_write` true; costs and profit true |
| project_manager (defaults) | `can_write` true, costs **true**, profit **false** |
| project_manager after `costs_visible_to_pm = false` | **0 job-cost rows returned** — the rows disappear from the query, not just the panel |
| read_only (after the §3.1 lockdown) | `can_write` **false**, costs **false**, profit **false**, **0 cost rows returned** |
| read_only attempting an insert | **blocked** — "new row violates row-level security policy" |
| anon reading `job_costs` / `documents` | **blocked at the grant level** |
| admin deleting a payment | **0 rows removed** — no DELETE policy exists |
| admin deleting an insurance policy line | **0 rows removed** |

### End-to-end workflow

Every step run against the real schema with real triggers and constraints.

| Step | Result |
| --- | --- |
| Signup trigger `handle_new_user()` | 3 profiles auto-created |
| Lead created and converted | contact + project created, lead marked won and linked |
| Second job from the same client | **1 contact, 2 jobs, 1 distinct customer** — no duplicate client |
| Estimate: 3 lines, 7% tax, $800 discount | subtotal 480000, discount 80000, tax 28000, **total 428000** — matches `calculateTotals` exactly |
| Unpriced line | flagged `needs_review` (1 of 3) |
| Manual roof measurement | attached to both estimate and job; 32.5 squares, 6/12 pitch |
| Estimate → job conversion | estimate↔job↔client all cross-linked, contract amount set |
| Schedule dates | persisted; `project.schedule_changed` written to the activity log |
| Photos | 3 photos across 3 distinct phases, all in the private store |
| Project document | contract document attached |
| Subcontractor COI | 2 policy lines tracked independently |
| Agreement vs COI | `coi_review_status = approved`, `agreement_status = signed` — **separate values, neither masking the other** |
| Invoice issued | $4,280 |
| Partial check payment $1,500 | **partially_paid**, paid 150000, balance 278000 |
| Second payment clearing it | **paid**, balance 0, `paid_at` set |
| Pending payment | **ignored** — paid total unchanged |
| Partial refund | recomputed to partially_paid, paid 289000, balance 139000 |
| Voiding a payment | recomputed to paid 139000, balance 289000 |
| Overpayment | balance **−25000** — surfaced, not clamped |
| Job costs (materials + subcontractor + permit) | total **1300000** |
| **Profitability: $20,000 contract − $13,000 costs** | **$7,000 gross profit, 35.0% margin** |

### COI / compliance regression

Real database rows fed through the unmodified Phase 1 evaluator:

```
overall status  : missing
earliest expiry : 2026-09-12
  general_liability      pass      ok
  workers_compensation   warning   Coverage expires in 20 days
  commercial_auto        missing   No Commercial Auto policy line is on file.
```

Six-month audit overlap (2026-06-01 → 2026-11-30): both policy lines correctly
identified as in force during the window.

Phase 2 did not break the compliance system: individual policy-line tracking,
the expiration warning window, missing-coverage detection, worst-case status
precedence and period-aware audit overlap all behave correctly against the
Phase 2 schema.

### Application runtime

Production build served locally; every route probed.

| Group | Result |
| --- | --- |
| 12 marketing routes | all **200** |
| 12 Phase 1 CRM routes | all **307 → /ops/login** |
| 11 Phase 2 CRM routes and settings tabs | all **307 → /ops/login** |
| `/ops/login` | 200 |
| Unexpected runtime errors in the server log | **none** |
| Stripe webhook, forged signature | **400** "Signature verification failed." |
| Stripe webhook, no signature header | **400** |
| Cron with wrong bearer token | **401** |
| Cron with no header | **401** |
| Cron with no `CRON_SECRET` configured | **503**, refuses to run |
| Public lead intake, malformed body | **400** with field errors, no 500 |
| Private document download, unauthenticated | **307 → /ops/login** |
| Vendor upload portal, bogus token | renders "not valid", no crash |

### Automated suite

`npx tsc --noEmit` 0 errors · `npx next lint` 0 warnings ·
`npx vitest run` **187/187 passing** across 7 files (65 Phase 1 unmodified) ·
`npx next build` clean, 73 static pages.

---

## 5. What was NOT verified, and why

Stated plainly so nothing here is mistaken for tested.

| Not verified | Reason |
| --- | --- |
| **Authenticated page rendering** | Supabase Auth is a hosted service. The auth *gate* was verified on every route; what an admin actually sees after signing in was not. |
| **Live Supabase behaviour** | No Supabase project credentials exist. RLS was verified against real PostgreSQL with the policies applied, which exercises the same SQL, but not Supabase's own auth/storage layers. |
| **File upload and signed URLs** | Requires Supabase Storage. |
| **Audit ZIP package generation** | Requires a Supabase client and real stored documents. The row-building and overlap logic underneath it were verified. |
| **AI estimate drafting against a live model** | No `OPENAI_API_KEY`. `sanitizeResult()` — the part that stops a wrong price reaching a customer — is fully unit-tested. |
| **EagleView / Nearmap** | No credentials. Adapters have still never run against a live account. |
| **Stripe payment completion** | No Stripe account. Signature rejection was genuinely verified using Stripe's own library; a successful payment round-trip was not. |
| **Webhook idempotency end-to-end** | The unique index exists and the unit test covers the duplicate path, but no duplicate delivery from Stripe was replayed. |
| **Email through Resend** | No API key. |
| **Import at real scale (1,000+ rows)** | Chunking is unit-tested at 1,000 rows; not run against a live database. |

---

## 6. Test data

All verification data was created in a **throwaway local PostgreSQL database**,
prefixed `ZZTEST`, and the entire database was dropped at the end of the pass.
No Supabase project was touched — none is configured. No production data exists
yet to protect. The verification scaffolding (`.verify/`, the live-database test
file, `.env.local`, and the `pg`/`tsx` dev dependencies) was removed from the
deliverable; the final build, lint, typecheck and test run were all performed
after that removal.

---

## 7. Pricebook — what the client must supply

All 26 items are **$0**. Estimates cannot be sent while any line references an
unpriced item, so this is the single biggest blocker to commercial use.

| Item | Category | Unit | Current price | Pricing needed? | Notes |
| --- | --- | --- | --- | --- | --- |
| Architectural shingle roof — tear-off and replace | Roofing | SQ | $0 | **Yes** | The main roofing line. Per 100 sf. |
| Roof underlayment — synthetic | Roofing | SQ | $0 | **Yes** | |
| Peel-and-stick secondary water barrier | Roofing | SQ | $0 | **Yes** | Florida code item |
| Ridge vent | Roofing | LF | $0 | **Yes** | |
| Drip edge | Roofing | LF | $0 | **Yes** | |
| Valley metal | Roofing | LF | $0 | **Yes** | |
| Pipe boot flashing | Roofing | EA | $0 | **Yes** | |
| Decking replacement — 4x8 sheet | Roofing | EA | $0 | **Yes** | Allowance item — confirm whether quoted or allowance |
| Roof repair — labor | Roofing | HR | $0 | **Yes** | Hourly rate |
| Emergency tarp / dry-in | Roofing | SQ | $0 | **Yes** | Storm work — confirm after-hours premium |
| Debris disposal / dumpster | Disposal | EA | $0 | **Yes** | Per pull or per job? |
| Impact window — installed | Windows / Doors | EA | $0 | **Yes** | Likely needs size tiers, not one price |
| Impact door — installed | Windows / Doors | EA | $0 | **Yes** | Likely needs size/type tiers |
| Pool cage rescreen | Screen / Lanai | SF | $0 | **Yes** | |
| Pool cage rebuild — aluminum frame | Screen / Lanai | SF | $0 | **Yes** | Engineering flagged |
| Paver deck installation | Pavers | SF | $0 | **Yes** | |
| Concrete slab pour | Concrete | SF | $0 | **Yes** | Confirm thickness assumption |
| Drywall hang and finish | Interior | SF | $0 | **Yes** | |
| Drywall ceiling repair | Interior | SF | $0 | **Yes** | |
| Interior painting | Interior | SF | $0 | **Yes** | |
| Insulation replacement — batt | Interior | SF | $0 | **Yes** | Confirm R-value assumption |
| Water damage mitigation — day rate | Interior | DAY | $0 | **Yes** | |
| Structural engineering | Engineering | LS | $0 | **Yes** | Usually pass-through cost |
| Permit fee — allowance | Permit / Fees | LS | $0 | **Yes** | Allowance — varies by jurisdiction |
| Mobilization / setup | Other | LS | $0 | **Yes** | |
| General labor | Labor | HR | $0 | **Yes** | Loaded hourly rate |

Also worth supplying, though optional: **material and labor cost** per item.
Without them the pricebook still quotes correctly, but job costing has to be
entered by hand from receipts rather than pre-populated.

Two structural questions the pricing exercise will raise:

1. **Impact windows and doors are one line each.** Real pricing varies by size
   and impact rating. Expect to split these into several catalogue items.
2. **Allowance items** (decking replacement, permit fee) need a decision on
   whether they appear as a fixed allowance on the customer's estimate or are
   quoted per job.

---

## 8. External integration status

| Integration | Configured | Tested | Status |
| --- | --- | --- | --- |
| Supabase | **Not configured** | Schema tested against real PostgreSQL | **Blocked** — no project exists. Nothing in the CRM runs without it. |
| Vercel | Configured (marketing site only) | Live site working | **Blocked for the CRM** — the CRM has never been pushed to the linked repo |
| AI provider (OpenAI) | Not configured | `sanitizeResult` unit-tested; no live call | Not tested — optional |
| EagleView | Not configured | Never run against a live account | Not tested — optional |
| Nearmap | Not configured | Never run against a live account | Not tested — optional |
| Google Maps / aerial | Not configured | Not tested | Not tested — optional, picture only |
| Stripe | Not configured | Signature rejection **verified**; no payment round-trip | Partially tested — optional |
| Resend (email) | Not configured | Not tested | Not tested — optional |
| Vercel Cron | Endpoint verified (401 / 503 behaviour correct) | No scheduled run | Not tested — needs `CRON_SECRET` and a cron entry |

---

## 9. Launch checklist

### Ready now — nothing more needed from anyone

- Every migration applies cleanly and is re-runnable
- RLS forced on all 36 tables; history tables cannot be deleted from, even by an admin
- Auth gate enforced on every CRM route
- Compliance evaluator, policy-line tracking, expiry warnings, audit overlap
- Estimate and invoice arithmetic, payment application, overpayment handling
- Job costing and gross profit / margin
- Lead import parsing, validation, deduplication and chunking
- Manual roof measurement entry and uploaded reports
- Gantt scheduling, project photos, subcontractor agreements
- Marketing site — untouched and still fully static

### Blocked on deployment (do these first)

1. Push the Phase 2 source to `fredthepreacher/VerticalBuilderandcommerical`
   (or a new repo) — **the CRM currently exists only as a ZIP**
2. Create a Supabase project; run migrations `0001`–`0008` in order
3. Set the four required Vercel environment variables
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`)
4. Sign up the first user — they become admin automatically
5. Walk `docs/DEPLOYMENT.md` §7

### Needs company data

- **Pricebook pricing** — all 26 items (§7). Blocks sending estimates.
- Insurance requirement minimums, if the starter template's values are not what
  Vertical Builders actually requires of subs
- Real subcontractor records and their current COIs
- Decide the auditor-role question in §3.1

### Needs an external account

- **Stripe** — for card and ACH. Check, cash and manual card entry work without it.
- **Resend** — for renewal-request emails. Links can be copied manually without it.
- **`CRON_SECRET` + a Vercel cron entry** — for daily expiry reminders. Nothing
  else depends on it.
- **EagleView or Nearmap** — only if remote measurement ordering is wanted.
  Manual entry and uploaded reports work without either. **Verify one report
  before trusting the numbers.**
- **OpenAI** — only for AI estimate drafting.

### Optional later

- AI COI extraction · customer-facing estimate approval · change orders ·
  crew assignment on the Gantt · batched compliance register query ·
  requirement-template creation in the UI

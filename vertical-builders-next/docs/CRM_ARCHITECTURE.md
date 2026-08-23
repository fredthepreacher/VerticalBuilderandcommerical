# Vertical Ops — Architecture

**Vertical Ops** is the internal CRM + Compliance Center for Vertical Builders &
Commercial. It lives inside the same Next.js application as the public marketing
site, under `/ops`.

---

## 1. Why one app instead of two

The existing website is a Next.js 14 App Router project with plain CSS (no
Tailwind), deployed as a single Vercel project. Three options were on the table:

| Option | Verdict |
|---|---|
| Separate app on `crm.verticalbuildersandcommercial.com` | Two deployments, two env var sets, CORS on lead intake, a shared-secret handshake. More moving parts for no benefit at this size. |
| Rewrite the site into a monorepo | Directly violates "preserve the public site". Rejected immediately. |
| **Same app, CRM namespaced under `/ops`** | **Chosen.** Lead intake is same-origin (no CORS, no secret). One deployment, one cron config, one env set. Zero risk to existing routes. |

The spec suggested `/crm`; `/ops` was used because the product is named Vertical
Ops and the URL should match what people call it. Nothing else about the
suggested structure changed.

### How the two halves stay separate

The root layout renders the marketing header, footer, sticky CTA and AI chat
widget. None of that belongs on a compliance table. Rather than restructure
every marketing page into a route group — which would have meant moving ~20
files that currently serve live SEO traffic — those four elements are passed as
slots into `components/SiteChrome.tsx`, a client component that returns bare
children on `/ops` and `/upload` routes.

`usePathname()` resolves during server rendering, so:

- statically prerendered marketing pages still ship their header in the initial HTML
- `/ops` pages never ship it at all — no flash, no hydration mismatch
- **every marketing route stayed statically generated.** Verified in the build output.

CRM styling is scoped under a single `.ops` class in `app/ops/ops.css`, imported
only by the CRM layouts. It cannot leak into the marketing site, and it can
safely override the global rules that site depends on (uppercase Oswald
headings) without touching `globals.css`.

---

## 2. Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 14.2 App Router | Already in the repo |
| Language | TypeScript, `strict: true` | `target` raised to es2022 |
| Data / Auth / Storage | Supabase (Postgres + Auth + Storage + RLS) | Per spec |
| Validation | Zod | Every mutation and every public endpoint |
| Email | Resend | Optional — everything degrades gracefully |
| Excel | **ExcelJS** | *Substitution:* the `xlsx` npm distribution is deprecated and carries a published advisory. ExcelJS produces the same `.xlsx`. |
| ZIP | JSZip | Per spec |
| PDF | pdf-lib | Stretch goal; failure never blocks the package |
| Icons | lucide-react | Per spec |
| Styling | Scoped CSS design system | *Substitution:* Tailwind's preflight would reset the live marketing site. shadcn/ui and TanStack Table were skipped for the same reason — smaller bundle, zero risk. |
| Forms | React `useFormState` + server actions | React Hook Form was unnecessary once mutations moved server-side |

---

## 3. Directory map

```
app/
├── (marketing routes — untouched)
├── layout.tsx                     # + SiteChrome slot wiring
├── ops/
│   ├── ops.css                    # scoped design system
│   ├── (auth)/login/              # unauthenticated
│   ├── (app)/                     # authenticated shell
│   │   ├── layout.tsx             # sidebar, topbar, requireUser()
│   │   ├── dashboard/  leads/  contacts/  projects/
│   │   ├── subcontractors/  compliance/  documents/
│   │   ├── tasks/  audits/  activity/  settings/
│   └── actions/                   # 'use server' mutations
│       ├── crm.ts  compliance.ts  audits.ts  settings.ts
├── upload/coi/[token]/            # public vendor portal
└── api/
    ├── public/leads/              # website → CRM
    ├── uploads/coi/               # vendor portal → CRM
    ├── documents/[id]/download/   # signed URL redirect
    ├── audits/[id]/export/        # signed URL redirect
    ├── compliance/evaluate|request-renewal/
    ├── cron/compliance-reminders/
    └── ops/search/

lib/ops/
├── types.ts                       # domain enums + row shapes
├── constants.ts                   # values shared with the public site
├── actions-shared.ts              # ActionState, safe error handling
├── compliance/evaluator.ts        # ← pure, unit-tested, the heart
├── supabase/{env,server,admin,client}.ts
├── auth/{require-user,permissions}.ts
├── validations/{lead,vendor,certificate,project,audit}.ts
├── services/{leads,certificates,compliance,vendors,documents,
│             audits,dashboard,search,notifications,activity,settings}.ts
└── utils/{dates,money,files,csv,tokens}.ts

components/ops/                    # CRM UI only
supabase/migrations/               # 0001 schema, 0002 RLS, 0003 storage, 0004 seed rules
supabase/seed_demo.sql             # dev/staging demo data, clearly marked
tests/                             # vitest
```

---

## 4. The three Supabase clients

| Client | Runs as | Used by |
|---|---|---|
| `supabase/server.ts` | the signed-in user | **default for everything** — RLS applies to every query |
| `supabase/admin.ts` | service role, **bypasses RLS** | exactly four flows, each with its own check first |
| `supabase/client.ts` | anon, browser | login form and sign-out only |

The four service-role flows:

1. `/api/public/leads` — inserts one validated lead row
2. `/api/uploads/coi` — accepts a vendor upload against a hashed token
3. `/api/cron/compliance-reminders` — gated by `CRON_SECRET`
4. Signed-URL minting and audit-package assembly — after `requireUser()`

`admin.ts` and every service module start with `import 'server-only'`, so
importing one into a client component is a **build error**, not a runtime leak.

---

## 5. Authorisation — three independent layers

1. **Middleware** (`middleware.ts`) redirects unauthenticated visitors away from
   `/ops`. Uses `getUser()`, not `getSession()`, so a revoked session cannot be
   replayed from a stale cookie. This is convenience, not security.
2. **Server-side checks.** Every page calls `requireUser()`; every mutation calls
   `requireCapability(...)` against the matrix in `lib/ops/auth/permissions.ts`.
3. **Row Level Security.** Postgres enforces the rules again. Roles are read from
   `profiles` via `auth.uid()` — a client can never assert its own role.

Browser-side routing is never trusted at any point.

---

## 6. Data model highlights

The full schema is in `supabase/migrations/0001_core_schema.sql`. Three decisions
matter more than the rest:

**A certificate is not one expiration date.** `insurance_certificates` holds the
document and its provenance; `insurance_policies` holds one row per coverage
line, each with its own carrier, policy number, effective date, expiration date
and limits. A single ACORD form routinely carries GL, WC and Auto with three
different carriers and three different dates. Modelling it as one date makes
renewal reminders and audit answers wrong.

**Renewals never overwrite.** A new certificate is a new row with an incremented
`version` and a `replaced_certificate_id` pointer; the previous one is marked
`replaced`, not deleted. Six-month audits ask *"what was on file in March?"* —
unanswerable if renewals destroy history. `insurance_certificates`,
`insurance_policies`, `compliance_reviews` and `audit_exports` have **no DELETE
policy at all**, not even for admins.

**Money and limits never float.** Project and lead amounts are `*_cents bigint`.
Insurance limits are whole-dollar integers inside `limits_json`, because
certificates are written in whole dollars and cents would be noise. The two units
are documented in `lib/ops/utils/money.ts` and never mixed.

---

## 7. Request flows

```
Website visitor
  → QuoteForm (client, captures UTM + referrer)
  → POST /api/public/leads   honeypot → origin allow-list → rate limit → Zod
  → service-role insert into leads
  → activity_log entry
  → Resend notification to the office  (failure is logged, never fatal)
  → lead visible in /ops/leads within seconds
```

```
Office clicks "Request updated COI"
  → 32 random bytes; only the SHA-256 hash is stored
  → /upload/coi/{token}   (no login, vendor id never in the URL)
  → vendor posts a file → server validates type, size, filename
  → path built from the TOKEN's vendor id, never from the request
  → certificate created as NEEDS_REVIEW  (an upload alone can never clear anyone)
  → office notified
```

```
Vercel Cron, daily 12:00 UTC
  → Bearer CRON_SECRET, else 401
  → find policy lines inside the widest configured threshold
  → for each, pick the tightest threshold reached
  → skip if (policy, threshold) already in notification_log   ← the dedupe
  → email the office, log the outcome
  → recalculate every vendor's cached status
```

---

## 8. Performance

Targets from spec §39: 5,000 leads, 1,000 vendors, 10,000 documents, 20,000
policy rows.

- 30+ indexes covering every filter and sort the UI offers
- Server-side filtering and pagination; no list loads more than 30 rows
- Signed URLs are minted per click, never in bulk
- `vendors.compliance_status` / `earliest_expiration_date` are a **cache** so
  lists can sort in Postgres. Detail screens always re-run the evaluator, so a
  stale cache can never produce a wrong answer on a screen someone is reading.
- The audit package caps at 400 documents / 180 MB with a clear warning, which
  keeps it inside serverless memory limits.

**Known limit:** `buildComplianceRegister` evaluates vendors in a loop, roughly
three queries each. Fine at 1,000 vendors; see `docs/NEXT_PHASE.md` for the fix.

---

## 9. Deliberate omissions

Deferred per spec §44, with clean extension points left behind: AI COI parsing,
SMS, QuickBooks, customer portal, carrier API verification, e-signatures, OCR,
CSV vendor import.

*Estimating, invoicing, scheduling/Gantt and lead import were on this list at
the end of Phase 1 and were delivered in Phase 2 — see §10.*

---

## 10. Phase 2 — the operations platform

Phase 2 was a change order against the finished CRM, not a rebuild. Everything
in §1–§8 still holds; this section covers what was added on top. The
requirement-by-requirement inspection is in `docs/PHASE_2_GAP_ANALYSIS.md`.

### Modules

| Module | Docs | Core files |
| --- | --- | --- |
| Estimating + AI drafting | `docs/ESTIMATING.md` | `lib/ops/estimating/{ai,pdf}.ts`, `lib/ops/services/estimates.ts` |
| Roof measurements | `docs/MEASUREMENTS.md` | `lib/ops/measurements/provider.ts` |
| Bulk lead import | `docs/LEAD_IMPORT.md` | `lib/ops/imports/leads.ts`, `app/api/leads/import/*` |
| Scheduling / Gantt | this file, below | `lib/ops/services/schedule.ts` |
| Project photos | this file, below | `components/ops/ProjectPhotos.tsx` |
| Subcontractor agreements | `docs/COI_COMPLIANCE_RULES.md` | `app/ops/actions/operations.ts` |
| Invoicing + payments | `docs/FINANCIALS.md` | `lib/ops/finance/{calc,payment-provider}.ts` |
| Job costing + profit | `docs/FINANCIALS.md` | `lib/ops/finance/calc.ts` |

### Schema additions — all additive

`0005_operations_platform.sql` creates 14 tables (`pricebook_items`,
`estimates`, `estimate_line_items`, `estimate_photos`, `roof_measurements`,
`lead_import_jobs`, `lead_import_errors`, `subcontractor_agreements`,
`project_photos`, `invoices`, `invoice_items`, `payments`, `payment_events`,
`job_costs`), adds five nullable columns to `projects` and thirteen settings
columns to `app_settings`, and widens the `documents` type constraints to a
**superset** — no existing value was removed.

`0006_phase2_rls.sql` extends the policy set. `0007_starter_pricebook.sql`
installs 26 catalogue items, all at $0 and tagged `needs-price`.

No Phase 1 table was dropped, no column removed, no policy loosened, and the
history tables (`insurance_certificates`, `insurance_policies`,
`compliance_reviews`, `audit_exports`) still have no DELETE policy.

### The second pure core

Phase 1 had one pure, unit-testable domain core: the compliance evaluator.
Phase 2 adds a second: `lib/ops/finance/calc.ts`. No database, no clock, no
request. Everything a customer sees on an estimate or an invoice, and every
profit figure the owner makes decisions on, comes out of that file.

Money is integer cents throughout. Quantities may be decimal, and the product is
rounded **exactly once, at the line level** — which is what makes the printed
line totals add up to the printed subtotal.

### Scheduling

`projects` gained `scheduled_start_date` / `scheduled_end_date` rather than
overloading the existing `start_date` / `estimated_completion_date`, which mean
"when it actually started" and "when we told the customer". `resolveDates`
falls back through scheduled → actual → `created_at` + 14 days and flags the
result `isEstimated`, so a bar on the chart never silently claims to be a
commitment.

Editing is a **form beside the chart, not drag-and-drop**. Drag-to-reschedule on
a touch screen with no undo is how a job silently moves two weeks.

### Photos

`project_photos` and `estimate_photos` join a phase or a caption to an existing
row in `documents`. They do not introduce a second storage path — everything is
still in the one private bucket, still fetched through short-lived signed URLs,
still with no public URL anywhere.

### Permissions

~20 capabilities were added to `lib/ops/auth/permissions.ts`. Three are worth
calling out:

- `estimatesSend` — admin and office only. A field user cannot put a price in
  front of a customer.
- `measurementsOrder` — admin and office only, because ordering a report costs
  money.
- `paymentsRefund` — admin only.

Two more are **settings-driven** rather than fixed: `canViewCosts` and
`canViewProfit` read `app_settings.costs_visible_to_pm` and
`profit_visible_to_pm`, and the matching SQL helpers `can_view_costs()` /
`can_view_profit()` read the same row — so turning one off removes the data from
the query, not just the panel from the screen.

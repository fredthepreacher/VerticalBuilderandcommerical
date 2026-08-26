# QA Report — Vertical Ops

Phase 1 (CRM + Compliance) build date: 2026-08-21
Phase 2 (operations platform) build date: 2026-08-21
Next.js 14.2.21 · Node 22 · TypeScript strict

---

## 1. Automated

| Check | Command | Result |
|---|---|---|
| Type check (strict) | `npm run typecheck` | **Pass** — 0 errors |
| Lint | `npm run lint` | **Pass** — 0 warnings, 0 errors |
| Unit tests | `npm test` | **Pass** — 173/173 across 6 files (65 Phase 1, unmodified, still green + 108 Phase 2) |
| Production build | `npm run build` | **Pass** — 73 static pages generated |

### Test coverage by spec requirement (§40)

**Compliance evaluator — 26 tests**

| Required case | Test | Result |
|---|---|---|
| All pass | returns compliant when everything is present, current, sufficient and reviewed | ✅ |
| Missing GL/WC | reports MISSING when a required coverage has no policy line at all | ✅ |
| Expired WC | reports NON_COMPLIANT for expired workers compensation | ✅ |
| Low GL limit | reports NON_COMPLIANT when a GL limit is below the requirement | ✅ |
| Expiring in window | reports EXPIRING_SOON inside the warning window but not outside it | ✅ |
| Missing AI requirement | reports NON_COMPLIANT when a required additional-insured flag is absent | ✅ |
| Waiver | masks a failure with a waiver but preserves the underlying finding | ✅ |
| Not reviewed | reports NEEDS_REVIEW when the certificate has not been approved by a person | ✅ |

Plus: rejected certificate treated as a hard failure · revoked and expired
waivers ignored · status priority ordering · optional requirements skipped ·
no-requirements returns needs_review not compliant · missing expiration date ·
not-yet-effective policy · policy selection (in-force preferred, latest expired
fallback) · limit key mapping for auto CSL and workers-comp EL · unrecorded
limits fail rather than pass · requirement resolution across all four scopes
including inactive and wrong-project templates.

**Date overlap — 7 tests**

| Required case | Result |
|---|---|
| Policy fully inside the audit window | ✅ |
| Policy spans the window | ✅ |
| Policy ends before the window | ✅ (excluded) |
| Policy starts after the window | ✅ (excluded) |
| Expires exactly on day 1 (inclusive boundary) | ✅ |
| Effective exactly on the last day (inclusive boundary) | ✅ |
| Unrecorded dates → included, not silently dropped | ✅ |

Plus a DST-boundary regression test: `daysBetween` across 8 March 2026 returns
31, which a naive local-time implementation gets wrong.

**Lead validation — 9 tests** · required fields, malformed email, short phone,
phone formats humans actually type, blank optionals normalised to `undefined`,
oversized message rejected, honeypot preserved, name splitting including
multi-part surnames.

**Upload token expiry — 8 tests** · 32-byte randomness, hash-only storage,
uniqueness, constant-time compare with length mismatch, not-found / expired /
revoked rejection, live token accepted, already-used token still accepted (a
vendor often needs to send a second page).

**Additional — 15 tests** · money parsing (`1M`, `500k`, `$1,000,000`), integer
cents with no float drift, path traversal (`../../etc/passwd` → `passwd`),
non-UUID entity id rejected, upload MIME and size enforcement.

---

## 2. Manual verification

### Public site preserved — the top priority

| Check | Result |
|---|---|
| Baseline build before any change | 50 routes, all marketing pages static |
| Build after the CRM was added | 60 routes — **every original marketing route still statically prerendered** |
| Build after Phase 2 | 73 static pages — **every original marketing route still statically prerendered.** Phase 2 added only `ƒ (Dynamic)` `/ops` routes and API handlers |
| Marketing routes changed | None. No page file was moved, renamed or deleted. |
| `globals.css` | Untouched |
| Header / Footer / StickyCta / AiAssistantWidget | Unchanged; now passed as slots into `SiteChrome` |
| `app/layout.tsx` | One change — chrome wrapped in `SiteChrome` |
| `components/QuoteForm.tsx` | Posts to `/api/public/leads`; adds Residential/Commercial + UTM capture. Markup, classes and GA4 event unchanged. |
| `/api/quote` | Kept as a forwarding shim so any cached page or external integration keeps working |
| `sitemap.ts` | Untouched — `/ops` was never in it |
| `robots.ts` | `/ops` and `/upload/` added to disallow |
| SEO metadata, JSON-LD, GA4 | Unchanged |

### CRM build output

All 22 `/ops` routes and `/upload/coi/[token]` render as `ƒ (Dynamic)` —
correct, since every one is per-user session data. Middleware 84.8 kB.

### Security review

| Requirement (§38) | Implementation |
|---|---|
| Auth on all CRM routes | Middleware + `requireUser()` on every page + RLS |
| Server-side authorisation | `requireCapability()` on every mutation |
| RLS enabled | All 22 tables, `FORCE`d; anon revoked from everything |
| Private bucket | `public = false`; no anon select policy |
| Signed download links | 5 min documents, 10 min audit packages, minted per click |
| Max upload size | 10 MB, configurable, enforced server-side |
| Allowed MIME types | PDF, JPEG, PNG, WebP — enforced server-side and at the bucket |
| Filename sanitisation | Control chars, traversal, unicode; tested |
| Zod validation | Every mutation and every public endpoint |
| Rate limiting | 5/min leads, 6/min uploads, per IP |
| No secrets in browser | `import 'server-only'` makes a leak a build error |
| No service key in client bundle | Verified — `admin.ts` is server-only |
| No raw stack traces | `handleUnexpected()` logs server-side, returns a safe message |
| Audit logs | Every compliance-critical change; secrets filtered from metadata |
| Session-safe logout | `signOut()` + full reload |
| No vendor ID enumeration | 32-byte random token; vendor id never in the URL |
| Hashed tokens | SHA-256 only; plaintext never stored |
| Expired/revoked enforcement | Server-side on both page render and POST |

### Accessibility

Semantic landmarks (`nav`, `main`, `aside`, `table` with `th`/`scope`) · every
input has a `<label>` · `aria-invalid` + `aria-describedby` on errors ·
`role="alert"` / `role="status"` on feedback · visible `:focus-visible` rings ·
status never encoded by colour alone (dot + word on every badge) · Escape closes
the mobile drawer and dialogs · `aria-current="page"` on active navigation.

### Responsive

Tables become labelled cards below 860 px (`data-label` per cell) · sidebar
becomes a drawer with a scrim · KPI grid reflows · the vendor upload portal is
built mobile-first with a 48 px submit target, since subcontractors open it on a
phone in a truck.

### States

Loading (`TableSkeleton`, `useFormStatus` pending labels), empty (specific
message + a next action, never "No data"), error (`role="alert"`, plain
language, a phone number where relevant), success (`role="status"`), and
confirmation dialogs on convert-lead and every destructive action.

---

## 2b. Phase 2 test coverage

108 new tests across four files. The 65 Phase 1 tests were **not modified** and
still pass.

**`tests/finance-calc.test.ts` — 27 tests**

Line rounding (whole and fractional quantities, half-away-from-zero on credits,
non-finite inputs) · line totals summing exactly to the subtotal · discount
before tax · discount clamped at the subtotal rather than going negative ·
negative discount ignored · tax off with a rate still set · empty estimate
returns zeroes, not NaN.

Payment application: only `succeeded` payments count · refunds subtracted ·
paid / partially paid / overdue transitions · **overpayment surfaced, not
clamped** · full recomputation, so removing a payment restores the balance ·
void and draft invoices never change status · a zero-total invoice is not marked
paid on no payments.

Payment guards: zero, negative and non-finite rejected · exact payment accepted
· a slipped decimal point refused unless overpayment is acknowledged, with the
excess named in the message.

Profitability: gross profit and margin to one decimal · costs grouped by
category with uncategorised filed under *other* · **nulls plus a stated reason
when there is no contract amount**, never a misleading 0% · a losing job reports
a negative margin honestly · the disclaimer names overhead and the accountant.

**`tests/lead-import.test.ts` — 29 tests**

RFC 4180 parsing: quoted commas · embedded newlines · escaped quotes · UTF-8 BOM
· CRLF · an empty file returning nothing rather than one blank row.

Mapping: common header spellings from other CRMs · unknown columns left unmapped
rather than guessed.

Normalisation: email lowercased and validated · phone reduced to ten digits from
every punctuation style, US country code stripped, non-ten-digit rejected.

Validation and dedupe: a row needs a name **and** one reachable channel · one
bad channel is a warning when the other works · **email matched before phone** ·
**never matched on name alone** · within-file duplicates caught · over-long
state truncated with a warning · an invalid row is never treated as a duplicate.

Chunking: 1,000 rows → 400/400/200 with nothing lost · exact multiples · empty
and short lists · error CSV contains only the rows needing a fix.

**`tests/payments-webhook.test.ts` — 17 tests**

Every handled event type maps to an outcome · unhandled events return null and
are ignored rather than guessed at · invoice id read from metadata, never from
the URL · expanded and string `payment_intent` both handled · missing metadata
leaves the id null · refunded amount captured separately from the charge amount.

Signature verification: **refused with no webhook secret** · **refused with no
signature header** · **forged signature refused**. Configuration reporting never
reveals a secret value, will not report online payments live while the webhook
secret is missing, and distinguishes "switched off" from "not configured".

**`tests/estimating-and-schedule.test.ts` — 35 tests**

AI sanitisation — the price safety boundary: the pricebook price wins over
whatever the model produced · a line with no pricebook backing gets **no price**
and is flagged · an unpriced pricebook item is flagged · an invented pricebook
id is dropped with a warning · the unit comes from the pricebook · an unusable
quantity defaults to 1 and says so · blank descriptions dropped · lines capped
at 60 · a roofing estimate with no measurement warns · nothing usable is said
plainly · provenance recorded on every draft · malformed responses never throw.

Measurements: sqft → squares to one decimal · explicit squares preferred · waste
factor from the report or the default · ridge+hip and eave+rake derived ·
**nulls rather than zeros when geometry is unknown** · EagleView and Nearmap key
shapes read · numeric strings coerced but absent values left null · nothing
invented from an empty payload · raw payload retained · unknown provider falls
back to manual · an unconfigured provider reports itself and offers manual entry
rather than blocking.

Scheduling: scheduled dates preferred and not marked estimated · fallback to
project dates, then `created_at` + 14 days, both marked estimated · backwards
dates render a one-day bar rather than nothing · null when there is no date at
all · the timeline spans every bar · an empty schedule still renders an axis ·
bars stay inside 0–100% · a single-day job gets a visible bar.

### Phase 2 regression checks

| Check | Result |
|---|---|
| All 65 Phase 1 tests, unmodified | **Pass** |
| Compliance evaluator source | Untouched |
| Marketing routes | Unchanged; all still static |
| Tables dropped / columns removed | **None** |
| RLS policies loosened | **None** |
| DELETE policy added to a history table | **None** |
| `documents` / `activity_log` CHECK constraints | Widened to supersets; no value removed |
| Duplicate Contact/Client or Project/Job models | **None** — Phase 2 reuses `contacts` and `projects` |

---

## 2c. Production readiness pass (2026-08-23)

A separate end-to-end verification pass was run after Phase 2 was reported
complete: migrations applied to a real PostgreSQL 16 instance, RLS exercised as
each role, the whole lead→profit workflow run against real triggers, and every
route probed on a running production build.

It found and fixed four defects (pricebook double-seeding, invoice balance
drift, a documented role that does not exist, three undocumented environment
variables) and surfaced three items for the client to decide on. It also
established that **the CRM is not deployed anywhere** — the live Vercel
deployment is the pre-CRM marketing site.

Full results, including what was *not* tested: `docs/VERIFICATION_REPORT.md`.

---

## 3. Not verified in this environment

The container has no Supabase instance and no network egress to one, so the
following are **written and type-checked but not executed end-to-end**. They are
the checklist in `docs/DEPLOYMENT.md` §7 and should be walked once before the
office relies on the system:

- Live authentication and session refresh
- Lead intake writing an actual row
- File upload to Supabase Storage
- Signed URL generation and expiry
- Audit package ZIP assembly against real documents
- Cron email delivery through Resend
- RLS policy behaviour under each of the four roles

Phase 2 adds to that list:

- **Stripe end to end.** Checkout session creation, the live webhook, and the
  duplicate-delivery path are unit-tested against constructed events but have
  not been run against a Stripe account. Signature verification is genuinely
  exercised (a forged signature is rejected by Stripe's own library).
- **EagleView and Nearmap.** Both adapters are written against the documented
  APIs and **have not been exercised against a live account.** Verify the mapped
  field names against your first real report before trusting the quantities —
  the procedure is in `docs/MEASUREMENTS.md`.
- **AI drafting against a live model.** `sanitizeResult` — the part that matters,
  because it is what stops a wrong price reaching a customer — is fully tested
  with constructed responses.
- Import at real scale (thousands of rows) against a live database.
- The invoice recalculation **trigger** in Postgres. Its logic is mirrored by the
  pure `applyPayments`, which is tested; the trigger itself needs one live run.

Every one has a deterministic unit-tested core; what is unverified is the
integration, not the logic.

---

## 4. Known limitations

1. **`buildComplianceRegister` is O(n) queries.** Fine at 1,000 vendors, slow at
   10,000. Fix documented in `NEXT_PHASE.md`.
2. **Rate limiting is per serverless instance,** not global. Adequate for spam;
   not a defence against a distributed attack.
3. **Audit package capped** at 400 documents / 180 MB, with a clear warning.
4. **No CSV vendor import** — spec §37 stretch goal, deferred.
5. **No AI COI parsing** — spec §35 stretch goal, deliberately deferred.
6. **Requirement templates are edited, not created, in the UI.** New trade or
   project templates are inserted via SQL for now.
7. **Light theme only.** No dark mode.
8. **The starter pricebook is unpriced.** All 26 items are $0, tagged
   `needs-price`, deliberately — see `docs/ESTIMATING.md`. Estimates cannot be
   sent while a line references an unpriced item.
9. **Scheduling is form-based, not drag-and-drop.** Reasoning in
   `docs/CRM_ARCHITECTURE.md` §10.
10. **Batch estimate export caps at 40** estimates per ZIP; per-estimate
    failures are collected into `EXPORT_ERRORS.txt` rather than failing the
    download.
11. **A Stripe payment cannot be voided inside Vertical Ops.** Refund it in
    Stripe and the `charge.refunded` webhook brings it back — voiding locally
    would make the two systems disagree.
12. **No accounting integration.** Job costing is a job-level margin tool, not a
    general ledger, and says so wherever a number is shown.

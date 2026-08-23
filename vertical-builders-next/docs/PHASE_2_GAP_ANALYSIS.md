# Phase 2 — Gap analysis

This is the inspection step the change order asked for: what the Phase 1 build
already did, what the eight new client requirements asked for, and what was
therefore actually missing. It is written before the work, kept as the record of
why each piece was added, and updated with the outcome.

**Nothing in Phase 1 was rebuilt.** No table was dropped, no column removed, no
compliance rule weakened. Every migration in this phase is additive: new tables,
new nullable columns, and CHECK constraints widened to supersets of what they
already allowed.

---

## 1. What Phase 1 already had

| Area | State at the end of Phase 1 |
| --- | --- |
| Public marketing site | 50 routes, all statically prerendered, untouched by the CRM |
| Auth + roles | Supabase Auth, `profiles.role`, six roles, capability map in `lib/ops/auth/permissions.ts` |
| RLS | Forced on every table; history tables have no DELETE policy at all |
| Leads | Website intake → `/api/public/leads` → CRM, UTM capture, pipeline stages, one-click convert to Customer + Project |
| Contacts / Projects | Full CRUD, notes, tasks, documents, activity log |
| Subcontractors | Vendor records, trades, status, project assignment |
| COI compliance | Certificate → many policy lines; per-line carrier, dates, limits, endorsements; requirement templates resolved project → vendor → trade → global; waivers that mask without erasing the underlying status |
| Documents | Private Supabase Storage bucket, signed URLs only, hashed single-purpose vendor upload tokens |
| Reminders | Daily cron, configurable thresholds, renewal-request emails |
| Audit Center | Six-month cycles, period-aware overlap, ZIP export with PDF + XLSX + CSVs + per-vendor folders |
| Tests | 65 unit tests over the compliance evaluator, date maths and token handling |

## 2. Requirement-by-requirement gap

### Group 1 — Estimates, AI drafting, remote measurements, photos, batch PDF

| Asked for | Already there | Gap |
| --- | --- | --- |
| Estimates with line items | ✗ | Whole module missing — no `estimates` table |
| AI-assisted drafting | ✗ | Missing, and needed a hard price boundary before it could exist safely |
| Roof measurements from aerial imagery | ✗ | Missing. Also required an honest answer: imagery alone does not contain geometry (see §4) |
| Photos attached to an estimate | Partial — `documents` existed | No estimate-scoped photo model |
| Batch PDF export | ✗ | Missing; the audit ZIP builder gave a reusable pattern |

### Group 2 — Bulk import, full client records, one-click client → job

| Asked for | Already there | Gap |
| --- | --- | --- |
| Import thousands of leads | ✗ | Missing entirely. Needed chunking — one request cannot hold thousands of inserts |
| Complete client records | ✓ `contacts` | None |
| One-click client → job | Partial — lead → job existed | Client → job did not. Added `createJobFromContact`, reusing the same contact rather than creating a second one |

### Group 3 — Subcontractor directory, COI storage, alerts, signed agreements

| Asked for | Already there | Gap |
| --- | --- | --- |
| Subcontractor directory | ✓ | None |
| COI storage | ✓ | None |
| COI expiration alerts | ✓ | None |
| Signed agreement storage | ✗ | Missing. Deliberately modelled *separately* from insurance so a signed contract cannot mask a missing COI |

### Group 4 — Gantt scheduling

| Asked for | Already there | Gap |
| --- | --- | --- |
| Timeline of all active jobs | ✗ | Missing. `projects` had `start_date` / `estimated_completion_date` but no scheduling intent, so two new nullable columns were added rather than overloading the existing ones |

### Group 5 — Before / during / after photos, all docs in one place

| Asked for | Already there | Gap |
| --- | --- | --- |
| Project document library | ✓ | None |
| Phase-tagged photos | ✗ | Missing. `project_photos` joins a phase to an existing `documents` row rather than introducing a second storage path |

### Group 6 — Employee logins with permission levels

| Asked for | Already there | Gap |
| --- | --- | --- |
| Logins and roles | ✓ | Roles existed; ~20 new capabilities were added for the new modules, plus two settings-driven ones (see §3) |

### Group 7 — Job-linked invoicing, card / ACH / check, payment status

| Asked for | Already there | Gap |
| --- | --- | --- |
| Invoices linked to jobs | ✗ | Missing |
| Card / ACH | ✗ | Missing. Implemented as Stripe hosted checkout — no card or bank details are ever entered in Vertical Ops |
| Check | ✗ | Missing — manual payment recording |
| Payment status | ✗ | Missing. Balances are *recomputed* from payments by a DB trigger, never incremented |

### Group 8 — Job costing with gross profit in $ and %

| Asked for | Already there | Gap |
| --- | --- | --- |
| Cost entry | ✗ | Missing |
| Gross profit $ and % | ✗ | Missing. Returns `null` plus a stated reason when there is no contract amount, rather than a misleading 0% |

---

## 3. Decisions taken during the phase, and why

**Costs and profit are two separate permissions, and both are configurable.**
A project manager can usually be trusted to log a receipt without being shown
the company's margin. `costs_visible_to_pm` and `profit_visible_to_pm` live in
`app_settings` and are read by both the RLS helpers (`can_view_costs()`,
`can_view_profit()`) and the UI, so turning one off actually removes the data
rather than just hiding the panel.

**Invoice balances are recomputed, never incremented.** A refund, a voided
payment or a corrected amount can then never leave a balance wrong. The rule
lives in `recalculate_invoice_totals()` in migration 0005 and is mirrored by the
pure `applyPayments()` in `lib/ops/finance/calc.ts`, so the same arithmetic is
testable without a database.

**Overpayment is surfaced, not clamped.** Customers round up, pay two invoices
with one check, or leave a deposit. The balance goes negative and the UI says
so, because the office needs to see it to issue a refund.

**The starter pricebook ships at $0.** All 26 items are tagged `needs-price`. A
plausible-looking wrong price is worse than a blank one, and estimate lines
built from an unpriced item are flagged and cannot be sent.

**Money is integer cents everywhere.** Quantities may be decimal — 2.5 squares
of roof is a real thing — so `quantity × unitPriceCents` is rounded exactly
once, at the line level. That is what keeps the printed line totals adding up to
the printed subtotal.

**Scheduling is form-based, not drag-and-drop.** The Gantt chart renders and the
dates are edited in a form beside it. Drag-to-reschedule on a touch screen with
no undo is how a job silently moves two weeks; a form makes the change explicit
and reversible.

## 4. What was refused, and what was built instead

The requirement said "AI/remote roof measurements from aerial imagery". Aerial
imagery on its own does not contain roof geometry — pitch, facet count and
ridge lengths come from photogrammetry, not from a picture. Inferring them from
a Google Earth screenshot would produce numbers that look authoritative and are
not, on documents that go to customers.

So the module supports four honest sources and no fifth:

1. **Manual entry** — someone measured it, and their name is on the record.
2. **Uploaded report** — a real EagleView/Nearmap PDF attached and keyed in.
3. **EagleView API** — adapter written against the documented API.
4. **Nearmap API** — adapter written against the documented API.

"No measurement" is a supported, clearly-labelled outcome. Google Maps imagery
is used only as a static picture on the estimate screen, never as a source of
numbers. **Neither the EagleView nor the Nearmap adapter has been exercised
against a live account** — that is stated in the code, in `.env.example`, and in
`docs/MEASUREMENTS.md`, and must be verified against a first real report before
the quantities are trusted.

## 5. Preservation checklist — verified after the work

- [x] All 65 Phase 1 tests still pass, unmodified.
- [x] All 50 marketing routes still statically prerendered.
- [x] No table dropped, no column removed, no RLS policy loosened.
- [x] `documents` and `activity_log` CHECK constraints widened to supersets; no existing value removed.
- [x] No DELETE policy added to `insurance_certificates`, `insurance_policies`, `compliance_reviews` or `audit_exports`.
- [x] No duplicate Contact/Client or Project/Job models — Phase 2 reuses `contacts` and `projects`.
- [x] Compliance evaluator untouched.

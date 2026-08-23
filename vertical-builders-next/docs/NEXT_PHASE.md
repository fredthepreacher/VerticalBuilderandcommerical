# Next Phase

Ordered by value to Vertical Builders & Commercial, not by engineering interest.
Five items, per spec §49.

---

## 1. Vendor requirement-template management in the UI

**Why:** Requirement templates can be *edited* in Settings, but creating a new
trade or project template still needs SQL. The moment the office wants "roofers
need $2M GL" or "the Gulfview Plaza contract requires umbrella coverage", they
will need a developer — and that is exactly the dependency this system was built
to remove.

**Work:** A create/duplicate/deactivate flow on `/ops/settings?tab=requirements`,
plus a project-level override tab on the project page. The resolution engine
(`resolveRequirements`) already handles all four scopes and is fully tested —
this is UI only, roughly half a day.

---

## 2. Batched compliance register query

**Why:** `buildComplianceRegister()` loops vendors and runs ~3 queries each. At
today's scale (tens of vendors) it is imperceptible. At 1,000 it is a few
seconds on the dashboard and the compliance page. It will be noticed before it
is a crisis, which is the right time to fix it.

**Work:** Replace the loop with three bulk queries (all vendors, all live
certificates with policies, all active waivers) and run the pure evaluator
in-process per vendor. The evaluator needs no change — it already takes plain
data. Expect ~50× fewer round trips.

---

## 3. AI-assisted COI extraction (as a draft, never as an answer)

**Why:** Manual entry works and is honest, but a three-coverage certificate is
about three minutes of typing. At 40 renewals a quarter that is real time.

**Work:** Behind `OPENAI_API_KEY`, add an **Extract certificate data** button on
the upload form that pre-fills the coverage lines and shows the source document
side by side. Hard rules, non-negotiable: output is a *draft*, the save button
stays disabled until a person has looked at each field, extraction confidence is
stored, and **a ticked ACORD checkbox is never treated as proof an endorsement
exists.** `createCertificate()` already accepts a fully formed payload from any
source, so the extension point exists.

---

## 4. Vendor CSV import

**Why:** Onboarding the existing subcontractor list one form at a time is the
single biggest barrier to the system actually being adopted. If it takes an
afternoon of typing to get started, it will not get started.

**Work:** Upload → parse → preview table with per-row validation → dedupe by
legal name / email / license → import. Columns per spec §37. The vendor Zod
schema already validates every field; this is parsing plus a preview UI.

---

## 5. Weekly compliance digest

**Why:** The daily cron emails one message per expiring policy. That is right for
urgency and wrong for planning. A Monday-morning summary — what expires this
month, who is missing paperwork, who is waiting on review, which live projects
have a blocked subcontractor — is the email the owner will actually read.

**Work:** A second cron on a weekly schedule reusing `loadDashboard()` and
`buildComplianceRegister()`, rendered as a simple HTML email. The dedupe pattern
in `notification_log` already prevents double-sending.

---

### Deliberately still deferred

SMS · QuickBooks · full estimating · invoicing · payroll · Gantt scheduling ·
customer portal · native mobile app · carrier API verification · e-signatures ·
OCR pipeline · advanced BI · Procore integration.

Each is a real product in its own right. Adding any of them before the core COI
and audit workflow is genuinely embedded in the company's daily habits would
trade a system that works for a system that impresses.

---

# Next phase — after Phase 2

The five items above still stand. Phase 2 adds these, again ordered by value to
the business rather than by engineering interest.

## 6. Verify the measurement adapters against a live account

**Why:** EagleView and Nearmap are written and wired but have never talked to a
real account. Until one report has been ordered and its raw payload compared
field by field with the provider's own PDF, the quantities they produce should
be treated as unverified — and they feed straight into a contract price.

**Work:** Order one report. Open the stored `raw` payload. Correct the key list
in `mapReport` if anything differs. Half a day, and it must happen before anyone
quotes from an API-sourced measurement. Procedure is in `docs/MEASUREMENTS.md`.

## 7. Price the pricebook

**Why:** All 26 starter items are $0 on purpose. Until they are priced, every AI
draft and every quick-add line is flagged for review, which is correct but slow.

**Work:** Office task, not an engineering one. Settings → Pricebook shows the
unpriced count until it is done.

## 8. Change orders on an approved estimate

**Why:** A signed estimate that grows is the most common source of billing
disputes in this trade. Today the estimate is superseded by a new version, which
is honest but loses the "what changed and who approved it" story.

**Work:** A `change_orders` table hanging off `estimates`, each with its own
approval and its own delta to the contract amount. The profitability calculation
takes the contract amount as an input, so it needs no change.

## 9. Customer-facing estimate approval

**Why:** Estimates are emailed as PDFs and approved by reply. A tokenised
accept/decline page would timestamp the approval and remove the ambiguity.

**Work:** Reuse the hashed single-purpose token pattern from the vendor COI
portal — same table shape, same expiry semantics, same "id never in the URL"
rule. The estimate already has a `sent`/`approved`/`declined` state machine.

## 10. Scheduled crew assignment on the Gantt

**Why:** The timeline shows when a job runs, not who is on it. The next question
the office asks after "when" is always "who".

**Work:** A join table between `projects` and `profiles` with a date range, and
a swimlane view on `/ops/schedule`. The bar geometry helpers are already pure
and reusable.

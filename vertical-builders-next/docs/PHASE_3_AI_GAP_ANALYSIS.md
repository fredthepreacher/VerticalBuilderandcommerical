# Phase 3 — AI gap analysis

The inspection pass the change order requires, done before any code was
written. Everything below was read out of the repository at
`a45c5da` (the merge of PR #1 into `main`), not assumed from the spec.

---

## 1. Git and deployment starting position

The change order states Phase 2 "has already been merged to `main`". **Verified
true**, which was worth checking — as recently as the previous session `main`
was still `4237d4c`, the pre-CRM marketing site.

| Fact | Value |
| --- | --- |
| `main` at start of Phase 3 | `a45c5dad17eb64839db7ed3a6f3401a638b4aac9` |
| How it got there | `Merge pull request #1 from fredthepreacher/vertical-ops-phase-2` |
| Contains the CRM | Yes — `app/ops`, `lib/ops`, migrations `0001`–`0010` |
| Phase 3 branch | `vertical-ops-phase-3-ai`, branched from `a45c5da` |
| App root | `vertical-builders-next/` (the repo root holds only this folder) |

---

## 2. Existing AI code

There is exactly one AI feature today: estimate drafting.

**`lib/ops/estimating/ai.ts`**

- `isAiConfigured()` — a bare `Boolean(process.env.OPENAI_API_KEY)`.
- `AiUnavailableError` — thrown for no-key, transport failure, non-2xx,
  empty response and unparseable JSON. Callers catch it and leave the
  estimate untouched.
- `generateEstimateDraft()` — a direct `fetch` to
  `https://api.openai.com/v1/chat/completions` with
  `response_format: { type: 'json_object' }`, `temperature: 0.2`, model from
  `OPENAI_ESTIMATE_MODEL` defaulting to `gpt-4o-mini`.
- `sanitizeResult()` — **the safety boundary.** Unit price comes from the
  pricebook by id or is not set at all; unit comes from the pricebook; unbacked
  or unpriced lines get `needsReview: true`; invented pricebook ids are dropped;
  line list capped at 60; provenance recorded.
- `PROMPT_VERSION = 'vbc-estimate-v1'`.

**What Phase 3 does with it: nothing.** The change order forbids weakening it,
and the cheapest way to guarantee that is not to touch the file at all. The new
provider module is written alongside it rather than refactored out of it. That
duplicates perhaps thirty lines of fetch/error handling, which is a price worth
paying to keep 35 passing estimate tests untouched and the price boundary
provably unchanged.

There is also `app/api/chat/route.ts` — the **public marketing site** chat
widget. Out of scope, unauthenticated, and deliberately left alone.

---

## 3. Auth and RLS patterns to reuse

**`lib/ops/auth/require-user.ts`**

- `requireUser()` — resolves the session through the user-scoped Supabase
  client, loads `profiles`, redirects on missing/inactive. Returns
  `{ id, email, profile, role, can(capability) }`.
- `requireCapability(cap)` — same plus `assertCan`.
- `getOptionalUser()` — non-redirecting variant.

**`lib/ops/supabase/server.ts`** — `createSupabaseServerClient()`. Runs as the
signed-in user; RLS applies. The file comment already says "this is the client
the app should use by default".

**`lib/ops/supabase/admin.ts`** — service role, RLS bypassed. Its own header
comment enumerates the only three permitted callers: public lead intake, the
vendor COI upload token endpoint, and the cron job.

> **Phase 3 rule, and it matches what the codebase already says about itself:
> the Copilot uses `createSupabaseServerClient()` only.** The admin client is
> never imported anywhere under `lib/ops/ai/`. That single import restriction
> is what makes "AI cannot become an RLS bypass" a structural property rather
> than a promise.

**Financial permissions** — `canViewCosts(role, settings)` /
`canViewProfit(role, settings)` in `lib/ops/auth/permissions.ts`, mirrored in
SQL by `can_view_costs()` / `can_view_profit()` (migration `0009`). `read_only`
is `false` in both layers. AI financial tools must call the same functions, and
RLS filters the rows regardless.

Roles: `admin`, `office`, `project_manager`, `read_only`. There is no `field`
role — the `profiles_role_check` constraint rejects it.

---

## 4. Lead creation flow

- Public intake: `POST /api/public/leads` → Zod `publicLeadSchema` → **admin
  client** (unauthenticated caller, so service role is correct there).
- CRM intake: `app/ops/actions/crm.ts` → `saveLead(leadId, prev, form)` →
  `leadUpdateSchema` → user-scoped client → `logActivity`.
- Conversion: `convertLead()` in `lib/ops/services/leads.ts` — finds or creates
  the contact, creates the project, links both, never duplicates the contact.

`leadUpdateSchema` fields Phase 3 can populate: `first_name`, `last_name`,
`company_name`, `email`, `phone`, `preferred_contact_method`, `customer_type`,
`service_type`, `property_address`, `city`, `state`, `zip`,
`project_description`, `timeline`, `pipeline_stage`, `assigned_to`.

**AI extraction targets exactly these fields and nothing else.** The proposal is
rendered into the existing form; the existing `saveLead` action does the write.

---

## 5. Document / storage flow

`lib/ops/services/documents.ts`: `uploadDocument`, `uploadGeneratedFile`,
`createSignedUrl` (5 min), `downloadToBuffer`, `archiveDocument`,
`listDocuments`. Private bucket `vertical-private-documents`, `public = false`.

`downloadToBuffer` is what COI extraction needs — it already exists, so Phase 3
adds no new storage path. The document row is read through the **user's** client
first (so RLS decides whether they may see it at all); only the byte fetch from
Storage uses the admin client, which is the same split the existing
`/api/documents/[id]/download` route uses.

---

## 6. Compliance flow

`lib/ops/compliance/evaluator.ts` — pure, 26 tests. `evaluateCompliance`,
`resolveRequirements`, `selectPolicyForCoverage`, `checkLimits`.
`lib/ops/services/compliance.ts` — `loadVendorComplianceContext`,
`evaluateVendorContext`, `buildComplianceRegister`, `refreshAllVendors`.

**Phase 3 never computes a compliance verdict.** COI extraction produces a
draft; a human applies it through the existing `createCertificate` path; the
existing evaluator then runs. The audit brief is handed *already-computed*
statuses and only writes prose around them.

---

## 7. Audit Center flow

`lib/ops/services/audits.ts` — `buildAuditRows`, `buildAuditPackage` (ZIP with
PDF + XLSX + CSVs, capped 400 docs / 180 MB). Period overlap is
`effective_date <= period_end AND expiration_date >= period_start`.

Phase 3 reuses `buildAuditRows` as the fact source for the brief and does not
touch the ZIP builder.

---

## 8. Activity logging

`lib/ops/services/activity.ts` — a string-union `ActivityAction` type, a
`logActivity(supabase, input)` that swallows its own errors ("a broken audit
trail is bad; a broken save because of a broken audit trail is worse"), and
`sanitizeMetadata()` which strips secrets. The header comment already forbids
storing file bytes or full document contents.

Phase 3 adds `ai.*` members to the union and logs through the same function.
`ai_runs` is a separate, richer table for AI-specific telemetry.

---

## 9. Settings architecture

`app_settings` is a single row, id `default`. `getSettings()` merges it over
`DEFAULT_SETTINGS` so a missing column never breaks a page. Settings screens
live in `app/ops/(app)/settings/page.tsx` as a tab list, with forms in
`components/ops/SettingsForms.tsx` and `OperationsSettingsForms.tsx`, each
saved by a server action in `app/ops/actions/settings.ts` gated on
`manageSettings`.

Phase 3 follows this exactly: three new boolean columns, a new `AI` tab, one new
server action.

---

## 10. Shell / UI patterns

`components/ops/Shell.tsx` is a client component. The top bar holds
`GlobalSearch`, a spacer, an expiring-compliance chip, `QuickAdd` and
`UserMenu`. The `Ask Vertical AI` button goes between `QuickAdd` and
`UserMenu`.

Styling is the scoped `.ops` design system in `app/ops/ops.css` — no Tailwind.
New Copilot styles are added there using the existing tokens.

---

## 11. Files this phase will touch

**New:**

```
lib/ops/ai/provider.ts        server-only OpenAI wrapper, timeout, JSON mode
lib/ops/ai/schemas.ts         Zod schemas for every model response
lib/ops/ai/guardrails.ts      clamping, limits, injection preamble, redaction
lib/ops/ai/tools.ts           allowlisted permission-safe read tools
lib/ops/ai/copilot.ts         orchestration, tool loop, proposals
lib/ops/ai/coi.ts             COI extraction + apply
lib/ops/ai/briefs.ts          audit brief + dashboard brief
lib/ops/services/ai-runs.ts   ai_runs logging
app/api/ops/ai/copilot/route.ts
app/ops/actions/ai.ts         server actions for the non-chat AI features
components/ops/CopilotDrawer.tsx
components/ops/LeadAiAssist.tsx
components/ops/CoiExtraction.tsx
components/ops/AiBriefCard.tsx
components/ops/AiSettingsForm.tsx
supabase/migrations/0011_ops_ai.sql
docs/PHASE_3_AI.md
docs/AI_SECURITY.md
tests/ai-*.test.ts
```

**Modified (minimally):**

```
components/ops/Shell.tsx                 add the Ask button + drawer mount
app/ops/(app)/layout.tsx                 pass the AI-enabled flag through
app/ops/(app)/dashboard/page.tsx         mount the brief card
app/ops/(app)/settings/page.tsx          add the AI tab
app/ops/(app)/leads/[id]/page.tsx        mount AI Assist
app/ops/(app)/leads/new/page.tsx         mount Structure-with-AI
app/ops/(app)/subcontractors/[id]/page.tsx  mount COI extraction
app/ops/(app)/audits/page.tsx            mount the audit brief
lib/ops/services/activity.ts             add ai.* action names
lib/ops/services/settings.ts             add the three AI toggles
lib/ops/types.ts                         AppSettings additions
app/ops/ops.css                          Copilot + AI panel styles
.env.example                             OPENAI_OPS_MODEL
```

**Deliberately NOT touched:** `lib/ops/estimating/ai.ts`,
`lib/ops/compliance/evaluator.ts`, `lib/ops/services/audits.ts` (ZIP),
`lib/ops/finance/*`, `app/api/chat/route.ts`, every marketing route,
`app/layout.tsx`, `components/SiteChrome.tsx`.

---

## 12. Risks identified up front

| Risk | Mitigation |
| --- | --- |
| AI becomes an RLS bypass | `lib/ops/ai/**` never imports the admin client; a test asserts this |
| Auditor gets financial data via chat | Financial tools call `canViewCosts`/`canViewProfit` **and** RLS filters rows; tested both ways |
| Model output trusted | Every response parsed by Zod, clamped, unknown keys stripped |
| Prompt injection from a COI or a note | Read tools are a fixed allowlist; no SQL, no URLs, no model-chosen table names. Authorization is resolved before the model is called and cannot be changed by anything the model emits |
| Silent write | No tool mutates. Proposals are data; the existing server actions do writes after a human clicks |
| Estimate safety regressed by refactor | The estimate module is not refactored |
| Cost blowout | No AI call on page load; caps on message length, turns, tool calls, rows, output tokens; same-day brief cache |

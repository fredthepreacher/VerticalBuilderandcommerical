# Vertical Ops AI (Phase 3)

Vertical Ops AI is a context-aware assistant layered on top of the existing CRM.
It reads; it drafts; it explains. It does not decide, and it does not write.

Everything in Phase 3 is additive. Delete the `OPENAI_API_KEY` and Vertical Ops
is the Phase 2 product exactly as it was — leads typed in, COIs keyed by hand,
estimates built from the pricebook, compliance decided by the evaluator. That is
not a fallback bolted on afterwards; it is the design, and it is what the tests
in `tests/ai-ui.test.tsx` assert.

---

## 1. What shipped

| Feature | Where | What it does |
| --- | --- | --- |
| **Ask Vertical AI** | Global — the header button on every `/ops` screen | Answers questions about the records *your account can already see*, cites what it used, and proposes (never performs) writes |
| **AI lead assistant** | `/ops/leads/new`, `/ops/leads/[id]` | "Structure with AI" turns pasted call notes into form fields; enrichment suggests next steps; message drafting writes an email or text for you to send yourself |
| **COI extraction** | `/ops/subcontractors/[id]` | Reads an uploaded certificate and produces a **draft for review**. Nothing is recorded until a person presses Apply |
| **AI Audit Brief** | `/ops/audits` | Plain-language summary of what would block the next audit, built on the real evaluator's output |
| **Daily dashboard brief** | `/ops/dashboard` | A prioritised "here is your day" summary, generated on demand and reused for the rest of the day |
| **Settings → AI** | `/ops/settings` | Configuration state and three feature switches. Never displays a key |

---

## 2. Architecture

```
                    ┌──────────────────────────────────────────┐
  browser  ────────▶│  /api/ops/ai/copilot   (route handler)   │
                    │  · strict Zod body: message, pageContext,│
                    │    history — nothing else                │
                    │  · role resolved SERVER-SIDE from the    │
                    │    session, never read from the body     │
                    └───────────────────┬──────────────────────┘
                                        │  user-scoped Supabase client
                                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │  lib/ops/ai/copilot.ts     two-call architecture          │
        │                                                           │
        │   PLAN   ── model chooses from the tools it was OFFERED   │
        │              ↓                                            │
        │   TOOLS  ── lib/ops/ai/tools.ts  · 16 hard-coded reads    │
        │              · allowlist checked AGAIN at execution       │
        │              · runs as the signed-in user, under RLS      │
        │              ↓                                            │
        │   ANSWER ── model phrases the result                      │
        │              ↓                                            │
        │   Zod    ── lib/ops/ai/schemas.ts, every field clamped    │
        │              ↓                                            │
        │   proposal stripped entirely for read_only accounts       │
        └───────────────────────────────────────────────────────────┘
```

### Module map

| File | Responsibility |
| --- | --- |
| `lib/ops/ai/provider.ts` | The only place Phase 3 talks to OpenAI. Server-only. Every failure becomes a typed `AiUnavailableError` |
| `lib/ops/ai/guardrails.ts` | Pure limits and clamping. No database, no network |
| `lib/ops/ai/schemas.ts` | Every model response shape, all `.strict()`. `parseModelOutput` returns a result rather than throwing |
| `lib/ops/ai/tools.ts` | The 16 read tools. Never imports the admin client |
| `lib/ops/ai/copilot.ts` | Plan → execute → answer |
| `lib/ops/ai/suggestions.ts` | Prompt chips. Client-safe on purpose, so the drawer can import it |
| `lib/ops/ai/leads.ts` | Structuring, enrichment, message drafting — all return drafts |
| `lib/ops/ai/coi.ts` | Certificate extraction and low-confidence detection |
| `lib/ops/ai/briefs.ts` | Fact collection (app code) + phrasing (model) for both briefs |
| `lib/ops/services/ai-runs.ts` | Telemetry. Swallows its own errors so a broken log never breaks a feature |
| `app/ops/actions/ai.ts` | Every server action. The apply path re-validates and calls the existing `createCertificate` |

`lib/ops/estimating/ai.ts` is **untouched**. It carries the estimate price-safety
boundary and its own tests; nothing in Phase 3 imports it, and a test asserts
that stays true.

---

## 3. Permission model

There is one rule, and everything else follows from it:

> **AI sees exactly what the signed-in user sees. Never more.**

Three independent mechanisms enforce it, and all three have to be got past:

1. **The tool list is built from the role.** `availableTools(ctx)` never offers
   a financial tool to an account that lacks the permission, so the model is not
   even told it exists.
2. **The executor checks again.** If the model produces a tool name it was never
   shown — hallucination, or a prompt injection in a note telling it to —
   `executeTool` refuses on permission grounds and returns no data.
3. **RLS is underneath all of it.** Every tool runs on the user's own Supabase
   client. Even if both checks above were somehow bypassed, Postgres returns
   zero rows.

| Role | Records | Job costs | Gross profit | Compliance | Write proposals |
| --- | --- | --- | --- | --- | --- |
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `office` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project_manager` | ✅ | per Settings | per Settings | ✅ | ✅ |
| `read_only` (Auditor) | ✅ | ❌ | ❌ | ✅ | ❌ — stripped in code |

The auditor's exclusion is not a hidden button. `get_job_cost_summary`,
`get_profit_summary` and `get_unpaid_invoices` are all refused, and any
`proposal` the model returns is discarded before the response leaves the server.

**The service-role client is never used for AI reads.** No file under
`lib/ops/ai/` may import it, and a test reads every file in that directory to
prove it.

---

## 4. The write-confirmation model

The model never executes a write. There is no code path from a model response to
an `insert`, and a structural test reads every AI module to keep it that way.

What happens instead:

| The model wants to | What actually happens |
| --- | --- |
| Create a lead | Renders a **review card**. The button opens `/ops/leads/new` with the fields prefilled. Nothing is saved until the operator saves it, through the normal form, the normal validation and the normal server action |
| Send a message | Renders the draft with **"nothing has been sent"** and a Copy button. Vertical Ops does not send it |
| Create a task | Opens the task screen prefilled. Same story |
| Record a certificate | Produces an `ai_extraction_drafts` row. A person edits it, presses Apply, and the reviewed values go through `certificateSchema` and `createCertificate` — the same path as typing it in by hand |

Deliberately absent from the lead proposal schema: `pipeline_stage` and
`assigned_to`. The model cannot mark a lead Won and cannot assign work to a
person.

---

## 5. Safety boundaries

**Compliance verdicts stay deterministic.** AI may extract a policy line,
summarise a register, and explain why something failed. It may not decide.
Compliance status is set by the existing evaluator running over the recorded
data, after a human has applied it. `app/ops/actions/ai.ts` never sets
`compliance_status`, and a test asserts that.

**Estimate pricing stays deterministic.** Unit prices come from the pricebook by
id. `sanitizeResult()` in `lib/ops/estimating/ai.ts` remains the enforcement,
unchanged and still tested.

**Payments are untouched.** No AI path can create, void, refund or record a
payment. A payment is still only recorded from a verified Stripe webhook.

**No text-to-SQL.** There is no tool that accepts SQL, no `.rpc()` call in the AI
layer, and no string-built query. Retrieval is 16 hard-coded functions. A test
greps every AI module for SQL construction.

**Model output is untrusted input.** Every response is parsed by a `.strict()`
Zod schema with clamped lengths, array caps, date validation and enum
restriction. A model cannot introduce a field, and an unparseable date becomes
`null` rather than a guess.

---

## 6. The COI flow in full

```
 1. Someone uploads a certificate         → documents (existing flow, unchanged)
 2. "Analyze with AI"                     → analyzeCoiAction
 3. Model reads the document              → coiExtractionSchema (strict, clamped)
 4. Low-confidence fields identified      → findLowConfidence()
 5. Draft stored                          → ai_extraction_drafts (status: pending)
 6. REVIEW SCREEN — every field editable, marked "AI extracted — not yet verified"
 7. Person corrects and presses Apply     → applyCoiExtractionAction
 8. Reviewed values re-validated          → certificateSchema.safeParse
 9. Recorded through the ordinary path    → createCertificate()
10. Compliance recalculated               → the existing deterministic evaluator
```

Steps 6 and 7 cannot be skipped. A draft can only be applied once; a second
attempt is refused.

Confidence below **0.75** is flagged. So is a missing expiration date, policy
number or carrier, at *any* confidence — a certificate with no expiry is a
compliance problem whatever the model thought of itself.

Supported: PDF, JPEG, PNG, WebP. Anything else is refused rather than attempted.
COI extraction requires a vision-capable model; with a text-only model set in
`OPENAI_OPS_MODEL`, extraction fails cleanly and manual entry stays available.

---

## 7. The brief flow

Both briefs work the same way, and the split matters:

- **Application code computes every number.** `collectAuditFacts` and
  `collectDashboardFacts` run the real evaluator and the real queries.
- **The model orders and phrases.** It does not count, and it does not decide
  whether an audit is passed.

Financial facts are not fetched *at all* when the viewer cannot see them — not
fetched and then filtered, not fetched and then hidden in the prompt. The query
does not run.

Neither brief generates on page load. Both are a button, and once generated the
result is reused for the rest of the day unless someone asks for a refresh.

---

## 8. Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | For any AI | — | Server-only. Never sent to the browser, never stored, never displayed |
| `OPENAI_OPS_MODEL` | No | `gpt-4o-mini` | The operations AI. Needs vision for COI extraction |
| `OPENAI_ESTIMATE_MODEL` | No | `gpt-4o` | Unchanged from Phase 2, tuned separately |

Plus three switches in **Settings → AI**, stored on `app_settings`:
`ai_copilot_enabled`, `ai_coi_extraction_enabled`, `ai_dashboard_brief_enabled`.

### Setup

1. Set `OPENAI_API_KEY` in the hosting environment. Do not commit it.
2. Optionally set `OPENAI_OPS_MODEL`.
3. Apply migration `0011_ops_ai.sql`.
4. Open Settings → AI and confirm it reports **Configured**.
5. Turn on the features you want. All three default on; nothing runs without a key.

---

## 9. Cost controls

Bounded per request, in `lib/ops/ai/guardrails.ts`:

| Limit | Value |
| --- | --- |
| User message | 4,000 characters |
| Conversation turns re-sent | 12 |
| Tool calls per question | 5 |
| Rows per tool | 25 |
| Search window | 365 days |
| Output tokens | 1,500 (hard ceiling 2,000 in the provider) |
| Document size | 10 MB |

Plus: nothing runs on page load, briefs are cached for the day, and the default
model is the inexpensive one. Set a monthly cap in the OpenAI dashboard as well
— per-user daily limits are not implemented (see §11).

---

## 10. Failure behaviour

Every failure is an `AiUnavailableError` with a reason, and every one leaves the
CRM exactly as it was.

| Reason | What the user sees |
| --- | --- |
| `not_configured` | The button is disabled and says a key is needed |
| `disabled` | "Switched off in Settings → AI" |
| `timeout` | "Took too long. Nothing has been changed." |
| `transport` | "Could not reach the AI service. Nothing has been changed." |
| `rate_limited` | "Rate limiting requests. Try again shortly." |
| `provider_error` | "Returned an error. Nothing has been changed." |
| `unparseable` / `invalid_shape` | "Returned something unusable" — the CRM data is untouched |

An AI outage cannot block operational work, because no operational path depends
on AI. The failures are logged to `ai_runs` with a reason code so an
administrator can see a pattern.

---

## 11. Known limitations

- **The auditor can still open `/ops/invoices` directly.** Receivables are
  closed *through the assistant*, but the invoices screen itself is governed by
  the Phase 2 permission model, where `read_only` holds `invoicesView`. Whether
  an auditor should see receivables at all is a product decision, not a bug, and
  it is flagged in a comment in `lib/ops/ai/tools.ts`.
- **No per-user spend cap.** Cost is bounded per request and by the feature
  switches, not per person per day.
- **COI extraction has been tested against the schema and the apply path, not
  against a live OpenAI vision call.** The extraction contract, the clamping,
  the review flow and the certificate write are all covered by tests; the
  quality of what a real model reads off a real ACORD 25 has not been measured
  here and should be spot-checked against a handful of the company's own
  certificates before it is trusted at volume.
- **The assistant answers from tool results only.** It has no full-text search
  over notes and documents, so "did anyone mention drainage on the Miller job"
  is not a question it can answer well.
- **English only.** No prompt or schema has been exercised in another language.
- **No streaming.** A question takes as long as it takes, with a "Looking
  through your records…" state.

---

## 12. Phase 3B roadmap — documented, not built

Recorded here so the shape is agreed before anyone starts. **None of this
exists.**

1. **Per-user daily spend caps** (`OPENAI_OPS_DAILY_USER_LIMIT`), enforced by
   counting `ai_runs` rows and refusing past the limit.
2. **Semantic search over notes and documents** — pgvector, embeddings on notes
   and extracted document text, as a 17th read tool. The permission story needs
   working out first: embeddings must not become a way around RLS.
3. **Confirmed writes.** A genuine "yes, do it" flow, where a proposal is
   executed by the existing server action after an explicit confirmation, with
   the proposal, the confirmer and the result all recorded. This is the piece
   most likely to be asked for, and the one where the boundary must not slip:
   the executor must remain the existing deterministic action.
4. **Scheduled briefs** — the daily brief emailed at 7am via the existing cron.
5. **COI extraction accuracy measurement** — a labelled set of the company's own
   certificates, scored per field, so "how good is it" has a number.
6. **Streaming responses**, once the answer shape is stable.
7. **Voice notes to structured leads**, reusing the lead structuring schema.

---

*See also:* `docs/AI_SECURITY.md` (threat model and data handling),
`docs/PHASE_3_AI_GAP_ANALYSIS.md` (what existed before this phase),
`docs/COI_COMPLIANCE_RULES.md` (the deterministic rules AI never overrides).

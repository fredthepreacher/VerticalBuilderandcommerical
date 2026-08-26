# Vertical Smart Ops

The deterministic half of the Vertical Assistant. It answers a defined set of
operational questions from live CRM data, using the same business rules the rest
of the product runs on.

**It is not generative AI, and it is never described as one.** No language
model is involved and no external AI provider is contacted, which is what makes
it free to run and impossible to hallucinate with.

---

## 1. Two layers, one assistant

| | **Smart Ops** | **AI Enhanced** |
| --- | --- | --- |
| Badge | `Smart Ops` / `Built-in` | `AI Enhanced` |
| Needs an API key | No | Yes — `OPENAI_API_KEY` |
| Cost per question | Nothing | Billed by the AI provider |
| Handles | A defined command set | Anything, in free-form English |
| Can be wrong by | Not recognising your phrasing | Misreading, or fabricating |
| Available | Always | Only once activated |

Both read the CRM through the **same user-scoped Supabase client under RLS**, so
neither can see a row you could not open yourself.

The naming rule the UI enforces: a Smart Ops answer is labelled
**"Built-in · from your CRM data"**, an AI answer is labelled
**"AI-generated"** and carries the check-before-acting warning. Blurring the two
would be the easiest way to lose a compliance client's trust, so the code keeps
them visually distinct — slate versus purple, different icon, different label.

---

## 2. Supported commands

Anything below works with no API key. Phrasing is flexible within each family;
the parser matches keywords, not exact strings.

| Ask | Intent | Notes |
| --- | --- | --- |
| "What needs my attention today?" · "what's urgent" · "brief me" | `attention_summary` | Prioritised across compliance, leads, jobs and (if permitted) receivables |
| "Show insurance expiring in 45 days" · "COIs expiring soon" | `expiring_policies` | Window extracted from the phrase; days, weeks or months; clamped to 365 |
| "Who is missing paperwork?" · "incomplete subcontractors" | `missing_vendor_documents` | From the compliance register |
| "What is my audit readiness?" · "what will block my audit" | `audit_readiness` | Counts from the deterministic evaluator |
| "Which leads need follow-up?" · "who should I call" | `leads_follow_up` | Open leads overdue a call, oldest first |
| "What jobs are active this week?" · "what's scheduled" | `active_jobs` | Active jobs plus a start/finish window |
| "Show open estimates" | `open_estimates` | Not yet approved or declined |
| "Show unpaid invoices" · "outstanding receivables" | `unpaid_invoices` | **Permission-gated** |
| "Job cost for the Miller residence" | `job_cost` | **Permission-gated** |
| "Profit on the Miller residence" | `job_profit` | **Permission-gated** |
| "What is 15% of 2500?" | `calculation` | See §3 |
| "Give me a COI renewal template" | `template` | See §4 |
| "help" · "what can you do" | `help` | Lists exactly the commands *your* account can run |

### What it will not pretend to understand

An unrecognised question returns **nothing**, on purpose:

- With no key → the built-in help card, listing what is supported.
- With a key → the question goes to the generative Copilot.

The parser is deliberately narrow. "Why did the Henderson job go over budget"
does **not** match the jobs command, even though it contains the word "job" —
returning a list of active jobs to that question would be a confidently wrong
answer, and a confidently wrong answer about insurance or money is worse than
"I don't handle that one".

---

## 3. Calculations

There is **no `eval`, no `new Function`, and no expression parser.** The router
recognises a fixed set of shapes and hands the calculator two numbers and a
kind. Every result shows its formula.

| Ask | Formula shown |
| --- | --- |
| "15% of 2500" | `2500 × 0.15` → **$375.00** |
| "add 20% to 1800" | `1800 × (1 + 0.2)` → **$2,160.00** |
| "subtract 10% from 5000" | `5000 × (1 − 0.1)` → **$4,500.00** |
| "20% markup on 1800" | `sell price = cost × (1 + markup%)` → **$2,160.00** |
| "profit on 4000 revenue and 3000 cost" | `profit = revenue − cost` → **$1,000.00** |
| "margin on 4000 revenue and 3000 cost" | `margin = (revenue − cost) ÷ revenue × 100` → **25%** |
| "markup percentage if cost is 3000 and price is 4000" | `markup = (price − cost) ÷ cost × 100` → **33.33%** |
| "1200 + 340" | one operator only → **1,540** |

**Markup and margin are shown together** wherever one is asked for, because they
are the two numbers most often confused and getting them the wrong way round on
a bid costs real money. A 20% markup is a 16.67% margin, and the answer says so.

Handled cleanly rather than crashing: division by zero, margin on zero revenue,
markup on zero cost, and magnitudes above one trillion. No result is ever `NaN`
or `Infinity` — a test asserts that across every kind and every degenerate input.

**Honest limitation:** one operator. `(1800 * 1.2) - 150` is declined, not
guessed at. An earlier draft matched it as "1.2 - 150" and returned −148.8 with
complete confidence; the parser now requires the whole phrase to be a single
operation.

CRM financial calculations (job cost, profitability) still go through the normal
permission checks. The standalone calculator is just arithmetic and is attached
to no record — the answer says so.

---

## 4. Communication templates

Six templates, filled from CRM fields where available:

`lead_first_response` · `lead_follow_up` · `inspection_confirmation` ·
`unable_to_reach` · `coi_renewal` · `missing_document`

Any value that is missing renders as a visible `[bracket]` and is listed under
"Fill in before sending". You never get "Hi , about your " — a half-filled
message that goes out is worse than an obviously unfinished one.

**Nothing is sent.** The output is text with a Copy button; you send it from your
own email or phone. With AI Enhanced activated, the AI message drafting on a lead
record remains available for something more tailored.

---

## 5. Built-in lead extraction

`Structure with Smart Ops` reads:

- **Labelled lines** — `Name:`, `Company:`, `Phone:`, `Email:`, `Address:`,
  `City:`, `State:`, `Zip:`, `Service:`, `Timeline:`, `Notes:`
- **Unambiguous patterns anywhere in the text** — a valid email address, a US
  phone number, a five-digit ZIP, a two-letter state, and a service type from
  the fixed taxonomy

Everything it cannot read stays in the description, so nothing is lost. Output is
labelled **"Built-in extraction — review before saving"**, and the fields go into
the ordinary new-lead form, which the operator still saves themselves.

**What it deliberately does not do is guess.** "Spoke to dave about the roof at
his mothers place" yields a service type and nothing else, and the panel says
why: a wrong first name or address on a customer record is worse than a blank
one. Messy prose is what AI Enhanced is for, and the panel says that too.

Validation is real, not cosmetic: `State: ZZ` is rejected because it is not a
state; `Phone: he will call us` is rejected because it is not a number; and a
sixteen-digit string is not mistaken for a phone number.

---

## 6. Briefs

**Smart Brief** (dashboard) generates on arrival — it is a handful of counts and
costs nothing. Ordered by what costs money or creates risk if ignored: expired
coverage, then expiring, then blocked subcontractors, then overdue invoices,
then leads. Zeros are skipped. When there is nothing, it says so in one line.

**Smart Audit Brief** (Audit Center) runs the compliance evaluator across every
subcontractor and reports blockers, expiring coverage, lapsed coverage, files
needing review, and recommended actions — naming specific subcontractors, not
"some vendors have issues".

Readiness is always phrased as **system status, never a verdict**: *"The system
currently shows 3 subcontractors blocking readiness"*, never *"you are ready"*.
The system does not certify an audit outcome.

With AI Enhanced activated, each brief gains an **Enhance with AI** button. That
is a rewording only — it never fires on its own, the deterministic version stays
on screen, and where the two differ the built-in one is the one to trust.

Both modes call the *same* fact collectors in `lib/ops/smart/facts.ts`, so the
two briefs cannot report different numbers.

---

## 7. Permissions

Identical to the AI Copilot's, because Smart Ops is a second door into the same
data and a second door without the same lock is not a door, it is a hole.

| Role | Records | Job costs | Gross profit | Receivables | Compliance |
| --- | --- | --- | --- | --- | --- |
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `office` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project_manager` | ✅ | per Settings | per Settings | ✅ | ✅ |
| `read_only` (Auditor) | ✅ | ❌ | ❌ | ❌ | ✅ |

Three things happen for a refused financial question, and the order matters:

1. The command is **not advertised** in the help card for that account.
2. The permission gate runs **before any lookup**, so an auditor's profit
   question never becomes a query against `job_costs` at all — a test asserts
   the table is never touched.
3. RLS is underneath regardless.

Receivables are also excluded from the auditor's *attention summary* — not
fetched and filtered, **not fetched**.

### What Smart Ops cannot do

Asserted structurally over every file in `lib/ops/smart/`:

- No `insert`, `update`, `upsert` or `delete` anywhere
- No import of the service-role client, no reading of the service key
- No SQL construction, no `.rpc()`
- No `fetch`, no email library — it cannot send anything or reach any URL
- Never sets `compliance_status`, a `pipeline_stage`, or a payment amount
- Every link comes from a fixed route map in the router; the parser never
  supplies an `href`, and every suggested follow-up command is itself a command
  the parser understands

---

## 8. The zero-provider guarantee

> The client can use Smart Ops indefinitely with **no OpenAI API key** and no AI
> bill.

Proven two ways, because either alone is weak:

**Behaviourally** — every Smart Ops path runs in a test with `OPENAI_API_KEY`
deleted and `fetch` stubbed to throw on any call. If a provider request existed,
those tests fail and name the URL.

**Structurally** — a test walks the *transitive* import graph of every file under
`lib/ops/smart/` (and `app/ops/actions/smart.ts`) and asserts the AI provider
module never appears in it. This is what stops a future refactor quietly
reintroducing a call: importing anything that imports the provider fails the
build's test run, not a code review.

This is what forced `collectAuditFacts` and `collectDashboardFacts` out of
`lib/ops/ai/briefs.ts` and into `lib/ops/smart/facts.ts`. Both modes still share
one definition of the truth; Smart Ops just no longer has to import a module
that touches OpenAI to get at it.

*The guarantee covers AI-provider usage. Hosting and database costs are a
separate matter and are unchanged.*

---

## 9. Routing

```
POST /api/ops/assistant
  │
  ├─ 1. Authenticate. Role from the session, never from the body.
  │
  ├─ 2. parseIntent(message)
  │        ├─ matched  → run it deterministically → return {mode:'smart_ops'}
  │        │              log ai_runs with mode='smart_ops' (no provider, no tokens)
  │        └─ no match ↓
  │
  ├─ 3. AI Enhanced activated?
  │        ├─ yes → runCopilot → return {mode:'ai_enhanced'}
  │        └─ no  → return the built-in help card
  │
  └─ 4. Provider failed?
           └─ fall back to Smart Ops for anything it can answer,
              with a notice saying why
```

"Ask AI instead" sets `preferAi`, which skips step 2 for that one question. If
the provider then fails, step 4 retries deterministically rather than reporting
an outage for a question the CRM could answer itself.

Ordering it this way is not only about cost, though it does mean nobody pays a
token for "what expires in 30 days". It is also about correctness: a count that
comes from a SQL aggregate cannot be hallucinated.

---

## 10. Cost accounting

`ai_runs.mode` is `'smart_ops'` or `'ai_enhanced'`. A `smart_ops` row contacted
no provider and consumed no tokens.

```sql
-- What is the AI actually costing?
select feature, count(*), sum((token_usage->>'totalTokens')::int)
  from ai_runs
 where mode = 'ai_enhanced'
   and created_at >= date_trunc('month', now())
 group by feature;

-- How much is Smart Ops absorbing for free?
select count(*) from ai_runs where mode = 'smart_ops';
```

Counting the two together would misrepresent the bill in the direction that
loses the client's trust, so `modeForFeature()` derives the mode from the feature
and a caller cannot mislabel a deterministic run as paid usage.

---

## 11. Module map

| File | What it is |
| --- | --- |
| `lib/ops/smart/types.ts` | Response and calculation shapes |
| `lib/ops/smart/intents.ts` | The parser. Pure, no I/O |
| `lib/ops/smart/calculations.ts` | The calculator. Pure, no `eval` |
| `lib/ops/smart/templates.ts` | Six templates. Pure |
| `lib/ops/smart/lead-parser.ts` | Labelled-field extraction. Pure |
| `lib/ops/smart/facts.ts` | Deterministic fact collectors, shared with the AI briefs |
| `lib/ops/smart/briefs.ts` | Brief builders. Pure functions over facts |
| `lib/ops/smart/router.ts` | Executes an intent against the CRM |
| `app/ops/actions/smart.ts` | Server actions for the briefs and the lead parser |
| `app/api/ops/assistant/route.ts` | The one assistant endpoint |

Five of the nine are pure functions with no database, no network and no clock —
which is why the test suite for them runs in milliseconds and needs no mocking.

---

## 12. Known limitations

- **The parser is keyword-based.** Unusual phrasing will miss. That is by design;
  the alternative is a wrong answer. `help` lists what it knows.
- **One arithmetic operator.** No nested expressions.
- **Templated writing.** The briefs and templates read like status reports,
  because that is what they are. AI Enhanced is what produces prose.
- **The lead parser needs structure.** Labelled lines or unmistakable patterns.
  It will not read a paragraph.
- **No COI extraction.** Reading a scanned certificate genuinely needs a vision
  model. Rather than fake OCR, the Analyze button stays visible and says
  *"AI Enhanced — requires activation"*; manual coverage-line entry is unchanged
  and has always been the supported workflow.
- **Job matching is by name or number.** An ambiguous match lists the candidates
  rather than picking one.
- **English only.**

---

*See also:* `docs/PHASE_3_AI.md` (the AI Enhanced layer),
`docs/AI_SECURITY.md` (threat model and data handling),
`docs/COI_COMPLIANCE_RULES.md` (the deterministic rules neither mode overrides).

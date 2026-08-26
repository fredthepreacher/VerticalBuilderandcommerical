# COI & Compliance Rules

> **This system organizes insurance documentation and the requirements
> configured in Settings. Final coverage and contract interpretation should be
> reviewed by Vertical Builders & Commercial's insurance/risk professional.**
>
> Vertical Ops does not invent coverage requirements and does not give legal or
> insurance advice. It checks documents against numbers *you* entered.

---

## 1. The core idea

A Certificate of Insurance is **not one expiration date.** One ACORD form
routinely carries:

| Coverage | Carrier | Policy # | Effective | Expires | Limits |
|---|---|---|---|---|---|
| General Liability | Southern Owners | GL-4471902 | 2026-01-01 | 2027-01-01 | $1M / $2M |
| Workers Comp | FCCI | WC-9910233 | 2026-03-15 | 2027-03-15 | Statutory + $1M EL |
| Commercial Auto | Progressive | CA-7781200 | 2025-11-01 | 2026-11-01 | $1M CSL |

Three carriers, three renewal dates. If you track "the COI expires 2027-01-01"
you will schedule that subcontractor in December with lapsed auto coverage.

Vertical Ops stores **one row per coverage line** (`insurance_policies`), each
with its own dates, and evaluates each independently.

---

## 2. Requirement resolution

Requirements are configuration, never hard-coded. Templates are scoped, and the
most specific one that mentions a coverage type wins **that whole rule**:

```
Project override          (scope = 'project', matching project_id)
        ↓
Vendor default template   (vendors.default_requirement_template_id)
        ↓
Trade template            (scope = 'trade', matching vendor.primary_trade)
        ↓
Global default            (scope = 'global')
```

The spec calls out project → trade → global. The vendor level sits below the
project override because `vendors.default_requirement_template_id` exists in the
schema and a specific vendor's negotiated terms should beat a generic trade rule.

Merging is **per coverage type and whole-record**, not field-by-field. If the
Roofing template mentions General Liability, its entire GL rule applies; Workers
Comp still comes from Global. Nobody has to work out which template contributed
which individual limit.

### What a requirement can specify

`required` · `min_limit_each_occurrence` · `min_limit_aggregate` ·
`min_combined_single_limit` · `min_workers_comp_el` ·
`additional_insured_required` · `waiver_of_subrogation_required` ·
`primary_noncontributory_required` · `endorsement_required` · `notes`

Migration `0004` installs a **starter** global template — $1M/$2M GL, $1M EL
workers comp, $1M auto CSL, umbrella off. Every line is labelled as a starting
point. **Confirm all of it with the company's insurance professional before
relying on the results.** Edit in Settings → Insurance requirements.

---

## 3. Which policies count

For "is this vendor OK today", only certificates in status `approved` or
`needs_review` contribute policy lines. `replaced`, `rejected` and `archived`
certificates are history — kept forever, but they do not make anyone compliant.

For a given coverage type the evaluator picks:

1. a policy **in force** on the evaluation date; if several, the latest expiration
2. otherwise the policy with the latest expiration

Step 2 matters: it lets the system say *"GL expired 20 days ago"* instead of
*"GL missing"*. Those are very different conversations with a subcontractor.

---

## 4. Per-coverage checks, in order

For each **required** coverage:

1. **Expiration** — no date recorded → fail. Past → fail. Inside the warning
   window (default 30 days, configurable) → warning.
2. **Not yet effective** — effective date in the future → fail.
3. **Limits** — each configured minimum compared against `limits_json`. A limit
   the requirement asks for but the policy does not record is a **failure**, not
   a pass. Silence is not evidence.
4. **Endorsement flags** — additional insured, waiver of subrogation, primary /
   non-contributory. Required but absent → fail.
5. **Human review** — the source certificate must be `approved`. `needs_review`
   → warning. `rejected` → fail.

### Limit key mapping

| Requirement field | Read from `limits_json` (in order) |
|---|---|
| `min_limit_each_occurrence` | `each_occurrence`, `occurrence`, `combined_single_limit` |
| `min_limit_aggregate` | `general_aggregate`, `aggregate` |
| `min_combined_single_limit` | `combined_single_limit`, `each_occurrence` |
| `min_workers_comp_el` | `el_each_accident`, `employers_liability`, `each_occurrence` |

---

## 5. Overall status

Worst check wins:

```
NON_COMPLIANT  >  MISSING  >  NEEDS_REVIEW  >  EXPIRING_SOON  >  WAIVED  >  COMPLIANT
```

| Status | Meaning | Badge |
|---|---|---|
| `compliant` | All required coverages present, current, sufficient, flags satisfied, reviewed | Green |
| `expiring_soon` | Otherwise fine, but something expires inside the warning window | Amber |
| `needs_review` | Documents exist, a person has not verified them yet | Blue |
| `missing` | A required coverage has no policy line at all | Red |
| `non_compliant` | Expired, under-limit, or a required condition fails | Red |
| `waived` | An authorised exception is masking a failure | Grey |

Colour is never the only signal — every badge pairs a dot with a word.

A vendor with **no** configured requirements returns `needs_review`, not
`compliant`. Nothing verified is not the same as everything fine.

---

## 6. Waivers — documented exceptions

Real example: a sole proprietor with a valid Florida workers comp exemption. The
requirement genuinely cannot be met, and that is genuinely fine — but it must be
a decision on the record, not a quietly ignored red row.

Every waiver requires a reason (10 characters minimum), an approver (taken from
the session, never from the form), a timestamp, and an optional expiry. Only
admin and office roles can create one.

**A waiver masks a failure; it never erases it.**

```json
{
  "coverageType": "workers_compensation",
  "status": "waived",
  "waiver": {
    "reason": "Sole proprietor with valid FL exemption on file",
    "underlyingStatus": "missing",
    "underlyingReasons": ["No Workers Compensation policy line is on file."]
  }
}
```

The underlying finding renders in the requirement matrix and exports into every
audit package. Waivers are revoked, never deleted — the grant and the revocation
both stay on record.

---

## 7. Historical / period-aware evaluation

For audits the question is not *"is this vendor covered today?"* but *"were they
covered while they were on the job, during this window?"*

```
policy.effective_date <= period_end   AND   policy.expiration_date >= period_start
```

Inclusive at both ends. Implemented in `overlapsPeriod()`, tested against all
four boundary cases plus policies with unrecorded dates (which are **included**,
so a vendor is never silently dropped because someone left a field blank).

Audit rows show two columns: status **at period end** (the answer the auditor
wants) and status **today** (context). They are frequently different, and that is
correct.

---

## 8. Documentation Readiness

```
ready vendors / total required vendors × 100
```

Scoped to vendors assigned to **live** projects (preconstruction through final
walkthrough) — a dormant vendor should not drag the number down. "Ready" counts
`compliant`, `expiring_soon` and `waived`.

Labelled **Documentation Readiness** everywhere, never "compliance score". It
measures paperwork completeness against configured requirements. It is not a
legal opinion and not an insurance guarantee, and the dashboard says so.

---

## 9. Expiration reminders

Default thresholds: **60, 30, 7, 0** days. Configurable in Settings.

`GET /api/cron/compliance-reminders`, daily at 12:00 UTC, `Authorization: Bearer
$CRON_SECRET`.

Each `(policy, threshold)` pair fires **exactly once, ever**, enforced against
`notification_log`. Without that a policy 30 days out would email the office
every single morning, and the whole feed would end up in a filtered folder
nobody opens.

The job also recalculates every vendor's cached status, so the dashboard stays
honest even if nobody opened the app.

---

## 10. Manual entry works with no AI

`OPENAI_API_KEY` is **not** required. The supported workflow is:

1. Select the subcontractor
2. Attach the PDF or photo
3. Fill the certificate header (broker, named insured, issue date)
4. Add coverage lines — three are pre-created (GL, WC, Auto); "Add coverage line"
   for more. The limit fields change to match the coverage type.
5. Link applicable projects
6. Save → status `needs_review`
7. Review the matrix against the document → Approve or Reject
8. Approving supersedes the previous certificate (marks it `replaced`) and
   recalculates compliance

AI extraction was deliberately **not** built. Per spec §35 it is a stretch goal,
and a wrong auto-extracted expiration date is worse than no extraction at all.
The extension point is `createCertificate()`, which already accepts a fully
formed payload from any source.

---

## Signed subcontractor agreements (Phase 2)

Agreements are tracked in `subcontractor_agreements` and are **deliberately
separate from insurance compliance**.

A signed contract and a current COI are two different obligations, and a vendor
can easily have one without the other. Folding agreements into the compliance
evaluator would let a signed contract mask a lapsed policy on the vendor's
status banner — which is exactly the failure the compliance module exists to
prevent. The vendor page shows them side by side, on separate tabs, with
separate statuses.

**Rules:**

- Statuses: `missing`, `sent`, `signed`, `expired`, `superseded`.
- Marking an agreement **signed requires an attached document**. A status
  without the paperwork is a note, not proof, and the action refuses.
- Recording a new agreement **supersedes** the previous one — it never
  overwrites it. The old row is marked `superseded` and kept, with its version
  number and its document intact.
- An agreement with no expiration date is treated as evergreen; the dashboard
  only warns on ones that do expire.
- The dashboard reports two things: active subcontractors with **no agreement at
  all**, and agreements expiring within 60 days.

If a dispute ever turns on which terms were in force on a given date, the
version history is the record that answers it. That is why nothing is deleted.

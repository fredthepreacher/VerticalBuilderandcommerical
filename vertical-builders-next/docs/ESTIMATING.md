# Estimating

How an estimate is built, what the AI is and is not allowed to do, and how an
approved estimate becomes a job.

## The shape of an estimate

```
estimates                     one per quote, numbered EST-YY-NNNN
  └── estimate_line_items     description, quantity, unit, unit price, taxable
  └── estimate_photos         site photos, linked to rows in `documents`
  └── roof_measurements       optional; one estimate can have several versions
```

An estimate belongs to a **contact** and optionally to a **project**. Approving
one and converting it creates the project if there isn't one yet — it never
creates a second customer record.

## Money rules

All of the arithmetic lives in `lib/ops/finance/calc.ts`. It is pure: no
database, no clock, no request. That is what makes an estimate reproducible.

- **Money is integer cents.** Always. Never a float.
- **Quantities may be decimal** — 2.5 squares of roof is a real thing.
- `quantity × unitPriceCents` is **rounded exactly once, at the line**. Rounding
  each line before summing is what keeps the printed line totals adding up to
  the printed subtotal.
- **Discount is applied before tax**, which is the normal contractor convention.
- A discount larger than the subtotal is **clamped**, not allowed to produce a
  negative total that would then flow into payment logic.

Totals are always recomputed on the server when an estimate is saved. A total
posted from the browser is never trusted.

## Statuses

```
draft ─────────┐
ai_draft ──────┼──▶ ready_for_review ──▶ sent ──▶ approved ──▶ (converted to job)
measuring ─────┘                          │
                                          └──▶ declined
                                          └──▶ expired
```

Two gates are enforced in code, not in guidance:

1. **`ai_draft` cannot reach `sent` or `approved` directly.** The transition
   table in `lib/ops/services/estimates.ts` forbids it. An AI draft must pass
   through `ready_for_review`, which is where a human signs off.
2. **An estimate cannot be sent while any line is flagged `needs_review`.**
   `setEstimateStatus` refuses, and says which line.

## What the AI does

`lib/ops/estimating/ai.ts`. It drafts a **scope and a line list**. It does not
price anything.

The safety boundary is `sanitizeResult()` — code, not prompt text, because a
prompt is advisory and code is not:

- A unit price is taken **from the pricebook, matched by id, or it is not set at
  all**. A price the model produced is discarded even when it looks sensible —
  "looks sensible" is exactly how a wrong number reaches a customer.
- The **unit** comes from the pricebook too. The catalogue knows whether a thing
  is sold by the square or the linear foot; the model guesses.
- A line with **no pricebook backing** gets `needsReview: true` and no price.
- A line whose pricebook item is **priced at $0** gets `needsReview: true` — the
  starter catalogue ships unpriced on purpose.
- A referenced pricebook id that **does not exist** is dropped with a warning.
- A quantity that is not a finite number **defaults to 1** and says so.
- The line list is **capped at 60**, so a runaway response cannot flood a quote.
- If the service is roofing and **no measurement is attached**, a warning says
  the quantities came from the description alone.

Every draft records its provenance: provider, model, `PROMPT_VERSION`,
timestamp, whether measurements were used, how many pricebook items were
offered, and how many lines need review. Assumptions and warnings are stored and
shown. Hidden chain-of-thought is not stored.

Without `OPENAI_API_KEY` the AI panel reports itself unavailable and the
estimate is built by hand from the pricebook. Nothing else changes.

## The pricebook

`pricebook_items`: name, category, service type, unit, default unit price, and
optional default material and labor costs.

Migration `0007` installs 26 starter items **all priced at $0** and tagged
`needs-price`. This is deliberate. Inventing plausible Florida roofing prices
would produce a catalogue that looks ready and quietly quotes the wrong numbers.
Settings → Pricebook shows the unpriced count until they are filled in.

Items are **retired, never deleted**. Estimate lines copy the price they were
quoted at but keep a reference to the item, and deleting the row would break the
trail from a quoted line back to the catalogue entry it came from.

## Photos and PDFs

Estimate photos go into the same private document store as everything else —
there is no public URL, and each is fetched through a short-lived signed link.

`lib/ops/estimating/pdf.ts` renders a single estimate. `/api/estimates/batch-export`
zips up to 40 at once. Per-estimate failures are collected into an
`EXPORT_ERRORS.txt` inside the ZIP rather than failing the whole download, and
**customers are never merged into one PDF** — one file per estimate, always.

## Converting to a job

`convertEstimateToProject` reuses the estimate's contact, creates the project if
needed, copies the address and service category, sets the contract amount from
the estimate total, and links both records in both directions. The estimate is
kept, not consumed.

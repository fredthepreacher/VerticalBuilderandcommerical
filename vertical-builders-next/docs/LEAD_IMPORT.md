# Bulk lead import

Bringing thousands of leads in from a spreadsheet or another CRM without
creating a mess that takes weeks to unpick.

## The shape of the flow

```
browser: read file → parse CSV → map columns → validate
  ↓
POST /api/leads/import/validate   creates the job, returns duplicate maps
  ↓
POST /api/leads/import/chunk      400 rows at a time, returns running totals
  ↓  (repeat)
PATCH /api/leads/import/[id]      marks completion
  ↓
GET /api/leads/import/[id]?format=csv   error report for the rows that failed
```

The browser does the parsing and validation because a 20,000-row file should not
be uploaded three times while someone fixes a column mapping. The server does
the duplicate matching and the writing, because the browser cannot be trusted
about what already exists.

## Why chunking

One request cannot insert thousands of rows inside a serverless function's
timeout. Work goes up in slices of **400**. Running totals are written to
`lead_import_jobs` after every slice, so a closed laptop mid-import leaves an
accurate, resumable record rather than an unknown state.

`lead_import_errors` holds the rejected rows with their reasons, downloadable as
a CSV the operator can fix and re-upload.

## CSV parsing

`parseCsv` is a real RFC 4180 parser, not `split(',')`. Contractor lead lists
routinely contain:

- quoted commas — `"Smith, John"`, `"123 Main St, Unit 4"`
- embedded newlines in a notes column
- escaped quotes — `"He said ""hi"""`
- a UTF-8 BOM, which Excel writes and which corrupts the first header
- CRLF line endings

Splitting on commas silently shifts every column after the first quoted one.
Nobody notices until they call the wrong number.

## Column mapping

`suggestMapping` guesses from a list of header spellings seen in real exports
from other CRMs — `First Name`, `fname`, `E-mail Address`, `Mobile Phone`,
`Zip Code`, and so on. Headers and aliases are normalised the same way, so
punctuation differences do not matter.

Exact matches win first, so `address` cannot steal the column that
`email address` should have taken. Unknown columns are **left unmapped rather
than guessed at**, and the operator always sees and can correct the mapping
before anything is written.

## Validation

A row is **rejected** when:

- it has no first name, last name *or* company — there is nothing to identify it by
- it has no valid email *and* no valid phone — an unreachable lead is not a lead

A row is **warned but accepted** when one channel is bad and the other works, or
when a state field is longer than two letters (it is truncated and the operator
is told).

Normalisation is what duplicate detection rests on:

- **Email** — trimmed, lowercased, must actually look like an address.
- **Phone** — reduced to ten digits, punctuation and a leading US country code
  stripped. Anything that is not ten digits is not a phone number.

## Duplicate matching

**Email first, then phone. Never name alone.**

Email is the stronger signal; households and businesses share phone numbers, and
two different people called J. Smith are not the same person. Merging on a name
match is how a CRM quietly loses a customer.

Duplicates are detected against the database *and* against earlier rows in the
same file — exports frequently contain the same person twice.

The operator chooses what happens to a matched row: **skip**, **update the
existing lead**, or **import anyway**. There is no silent merge.

## After the import

Every import is listed on the import screen with its counts — total, imported,
updated, skipped, rejected — and a link to the error CSV. The record stays, so
"where did these 4,000 leads come from" has an answer six months later.

---

# Property Prospects

Storm lists, canvassing routes and door-knocking sheets arrive as a column of
addresses and nothing else:

```csv
STOP,ADDRESS
1,"4386 Sibley Bay St, Port Charlotte, FL 33980"
2,"2200 Example Rd, Punta Gorda, FL 33950"
```

Before this feature every row of one was rejected as uncontactable. Now the
importer has two modes, and an address is enough in the second.

## The two modes

| | **Standard leads** | **Property prospects** |
| --- | --- | --- |
| Requires | A name **and** an email or phone | A usable property address |
| Name / phone / email | Required | Optional, and kept when present |
| Duplicate keys | Email → phone | Email → phone → normalised address |
| Default stage | `new` | `needs_contact_info` |
| Default source | `import` | `storm_list` |
| Record type | `contact_lead` | `property_prospect` |

**The standard rules were not loosened.** Letting address-only rows through
everywhere would mean a genuinely broken contact list imports silently as junk,
which is the failure those rules existed to catch. The modes are separate, and
`validateRows` defaults to `standard` so every existing caller keeps the
behaviour it had.

The mode is **suggested** from the file's own contents — including whether a
mapped Phone column actually holds anything — and **always confirmed** by the
operator on the mapping step. A file with addresses and no contact details no
longer produces a blocking error; it produces an offer:

> **No contact information was detected**
> This file contains property addresses but no phone numbers, emails or contact
> names. You can import these as Property Prospects and add contact information
> later.
> **[ Import as Property Prospects ]**

## Address parsing

`parseAddress()` decomposes a single address column and reports how sure it is:

| Input | Result | Confidence |
| --- | --- | --- |
| `4386 Sibley Bay St, Port Charlotte, FL 33980` | street / city / state / zip | high |
| `2200 Example Rd, Punta Gorda, FL` | street / city / state | high |
| `123 Main St Apt 4, Venice, FL 34293` | unit stays with the street | high |
| `4386 Sibley Bay St Port Charlotte FL 33980` | street kept whole, state + zip found | **partial** |
| `4386 Sibley Bay St` | street only | partial |
| `the blue house near the marina` | kept as typed | **low** |

Two decisions worth stating:

- **A comma-less address is flagged, not guessed at.** Splitting
  "4386 Sibley Bay St Port Charlotte FL" needs a gazetteer, and a guess puts a
  wrong city on a real customer record.
- **Anything below high confidence still imports.** It gets status
  `needs_review`, the reason is stored on the record, and the operator is told
  how many to look at. A canvasser can knock on a door the parser could not
  decompose; throwing the row away helps nobody.

An explicit City/State/ZIP column always beats the parser — the operator mapped
that column deliberately.

The address exactly as it appeared in the file is kept in
`source_metadata.original_address` whether or not parsing succeeded.

## Duplicate detection by address

`4386 Sibley Bay Street`, `4386 Sibley Bay St` and `4386 SIBLEY BAY ST` are one
house. Without normalisation, re-importing a storm list produces a second copy
of every property on it.

The canonical form lowercases, strips punctuation, and reduces suffixes and
directionals to one spelling (`street`→`st`, `northeast`→`ne`, `apartment`→`apt`,
and twenty-odd more), then appends the five-digit ZIP.

**It is implemented twice, on purpose:**

- `public.normalize_address(street, zip)` — an `IMMUTABLE` SQL function backing
  a **generated column**, `leads.address_key`. Generated means existing rows are
  normalised automatically and the key can never drift from the address it came
  from. It is indexed, so cross-file duplicate lookup is an exact `in` query.
- `normalizeAddress()` in `lib/ops/imports/address.ts` — the same algorithm in
  TypeScript, so the browser can flag within-file duplicates instantly.

If those two ever disagreed, duplicates would be missed **silently**. So they
are checked against each other rather than trusted: the rule table is pinned in
`tests/property-prospects.test.ts`, and the migration harness runs both over the
same fixture set and diffs the output.

Address matching applies **only in property mode**. Two tenants at one address
are two contact leads; address is the right key for a property and the wrong one
for a person. Email still beats phone, and phone still beats address.

The duplicate action selector is unchanged and still defaults to
**Skip duplicates — keep the existing lead untouched**.

## Schema (migration 0012)

```
leads.record_type        'contact_lead' | 'property_prospect'   (default contact_lead)
leads.stop_number        text — route sheets number stops "1", "12A", "R4-07"
leads.import_batch_tag   text — promoted from source_metadata so it can be filtered
leads.address_key        text — GENERATED, the normalised duplicate key
leads.first_name         now NULLABLE
```

**The rule `first_name NOT NULL` was enforcing did not go away — it moved.**

```sql
constraint leads_identifiable_check check (
  first_name <> '' or last_name <> '' or company_name <> '' or property_address <> ''
)
```

A lead must be identifiable by *something*. A property prospect is identified by
its address, a contact lead by a name. A row with neither is not a lead, it is
an empty row, and the database refuses it. Dropping the NOT NULL without this
would have been the one genuinely dangerous part of the change.

No placeholder values are ever written. A prospect with no owner has `NULL` in
`first_name`, not `"Unknown"` — a fake name is indistinguishable from a real one
three months later, and the visible gap is the entire point of the record type.

`lead_import_jobs` also gains `import_mode`, `needs_review_rows` and
`lead_source`, so months later "why does this lead have no phone number" is
answered by the job that created it.

## Stages

Three additions to the **existing** pipeline rather than a parallel status
system for prospects:

`needs_contact_info` · `door_knocked` · `do_not_contact`

The rest of the canvassing workflow already had a home:

| Asked for | Existing stage |
| --- | --- |
| Appointment Set | `consultation_scheduled` |
| Estimate Scheduled | `estimate_in_progress` |
| Contacted / Follow-Up / Won / Lost | the stages of those names |
| Assigned | the `assigned_to` column, which is not a stage |

`needs_contact_info` and `door_knocked` count as **open** on the dashboard — an
imported storm list is a pipeline of real work, and hiding it would make the
import look like it did nothing. `do_not_contact` is closed, alongside Won and
Lost.

## Enrichment

A property prospect becomes a full lead by being **edited**, never re-created.

The owner's name goes into `first_name` / `last_name` — the same columns a
website enquiry uses — so there is no separate "owner" shape to migrate between.
`record_type` records *provenance* and does not change; the record simply starts
displaying the name instead of the address, and moves along the same pipeline.

Where a name is absent, the address is the display value — in the lead list, the
kanban card, the detail page heading, global search, and the project title when
the lead is converted. A blank cell is indistinguishable from a broken record.

## Search and filters

The lead list filters on **stage, record type, batch, city and ZIP**, and the
search box covers name, company, email, phone, address, city, ZIP, stop number
and batch tag. The Batch and City dropdowns are built from values that actually
exist, so a company that has never imported a batch never sees an empty selector.

Global search returns prospects by address and labels them as such.

## Server-side enforcement

The mode is validated against an allowlist on `/validate`, and the chunk route
takes the mode **from the job record, not from the request body** — otherwise a
later chunk could switch a standard import into property mode and slip
contactless rows past the rules the operator agreed to.

Both routes still require the `leadsImport` capability; `read_only` does not
have it.

## Known limitations

- **US addresses only.** The parser knows US state abbreviations and five-digit
  ZIPs.
- **A comma-less "street city state" is not split.** State and ZIP are still
  extracted; the row is flagged.
- **No geocoding.** No latitude/longitude, no map view, no radius search, and no
  neighbourhood or territory grouping — the CRM has no reliable geographic data
  and inventing neighbourhoods would be worse than not having them. City, state
  and ZIP are filterable, which is what the field workflow actually needs today.
- **`update` on a duplicate fills gaps only**, and never reassigns an existing
  lead to the batch's assignee.
- **50,000 rows per file**, 25 MB, 400 rows per request. Larger files should be
  split.

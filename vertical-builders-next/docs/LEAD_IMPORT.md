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

# Roof measurements

## The honest version first

The requirement said "AI/remote roof measurements from aerial imagery". Aerial
imagery on its own **does not contain roof geometry**. Pitch, facet count, ridge
and hip lengths come from photogrammetry across many overlapping captures — not
from looking at one picture, however good the model looking at it is.

Producing numbers that way would put figures that look authoritative and are not
onto documents that go to customers and become the basis of a contract price.
So this module supports four sources and no fifth:

| Source | What it is | Trustworthy? |
| --- | --- | --- |
| **Manual entry** | Someone measured it; their name is on the record | Yes — and it says who |
| **Uploaded report** | A real EagleView/Nearmap PDF attached and keyed in | Yes |
| **EagleView API** | Ordered through their API | Yes, once verified — see below |
| **Nearmap API** | Ordered through their API | Yes, once verified — see below |

**"No measurement" is a supported, clearly-labelled outcome.** An estimate with
no measurement is allowed; it simply carries a warning that the roofing
quantities came from the description alone.

Google Maps imagery, if `GOOGLE_MAPS_API_KEY` is set, shows a static aerial
picture on the estimate screen. It is a picture. No number is ever derived from
it, and nothing is scraped.

## Not yet exercised against a live account

**The EagleView and Nearmap adapters have been written against the documented
APIs but have not been run against a live account.** This is stated in the code,
in `.env.example`, and here.

Before trusting quantities from either provider:

1. Order one report through the UI.
2. Open the stored `raw` payload on the measurement record.
3. Check that the mapped fields (`roofAreaSqft`, `primaryPitch`, `ridgeLf`,
   `eaveLf`, …) match what the provider's own report shows.
4. If a field name differs, correct the key list in
   `lib/ops/measurements/provider.ts` → `mapReport`.

`mapReport` reads defensively: it tries several documented key spellings per
field, coerces numeric strings, and **leaves a null rather than guessing** when
a field is absent. A null is visible in the UI; a fabricated zero is not.

The complete raw payload is kept on every measurement, so a disputed number can
always be traced back to what the provider actually sent.

## Configuration

```
ROOF_MEASUREMENT_PROVIDER=manual|eagleview|nearmap   # default: manual
EAGLEVIEW_CLIENT_ID=
EAGLEVIEW_CLIENT_SECRET=
NEARMAP_API_KEY=
GOOGLE_MAPS_API_KEY=                                 # static picture only
```

Settings → Measurements picks the provider (overriding the env default) and
reports which credentials are present — never their values. Secrets are read on
the server and never sent to the browser.

If the selected provider is not configured, the panel says so and offers manual
entry. **Nothing is blocked.**

## Ordering costs money

`measurementsOrder` is limited to owner/admin and office. A field user can read
a measurement and use its quantities; they cannot spend money ordering one.

## Derived quantities

`deriveQuantities()` is pure and separate from the providers, so the arithmetic
is identical whether the geometry came from EagleView or from a tape measure:

| Output | From |
| --- | --- |
| `squares` | explicit squares, else sqft ÷ 100, to one decimal |
| `squaresWithWaste` | squares × (1 + waste%), waste from the report or the default 10% |
| `ridgeAndHipLf` | ridge + hip, rounded |
| `perimeterLf` | eave + rake, rounded |
| `starterLf` | eave, rounded |

Every one of these returns `null` when the input geometry is unknown, rather
than a zero that would silently become a zero-quantity estimate line.

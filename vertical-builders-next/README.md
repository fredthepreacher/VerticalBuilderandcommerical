# Vertical Builders & Commercial

Two products, one Next.js application, one Vercel deployment:

1. **The public marketing site** — lead-generation website for a licensed Florida
   general contractor (CGC1528626) and roofing contractor (CCC1333649) in Nokomis, FL.
2. **Vertical Ops** — the internal CRM + Compliance Center at `/ops`, where website
   leads land and where subcontractor insurance is tracked, chased and audited.

Stack: **Next.js 14 (App Router) · TypeScript strict · React 18 · Supabase** —
no CSS framework; one hand-rolled global stylesheet for the site and a scoped
design system for the CRM. Deploy target: **Vercel**.

---

# Vertical Ops — CRM + Compliance Center

> Full documentation lives in [`/docs`](./docs):
> [Architecture](./docs/CRM_ARCHITECTURE.md) ·
> [COI & compliance rules](./docs/COI_COMPLIANCE_RULES.md) ·
> [Audit export workflow](./docs/AUDIT_EXPORT_WORKFLOW.md) ·
> [Deployment](./docs/DEPLOYMENT.md) ·
> [QA report](./docs/QA_REPORT.md) ·
> [Next phase](./docs/NEXT_PHASE.md)
>
> **[Production readiness verification](./docs/VERIFICATION_REPORT.md)** — read this first
>
> Phase 2 · [Gap analysis](./docs/PHASE_2_GAP_ANALYSIS.md) ·
> [Estimating](./docs/ESTIMATING.md) ·
> [Financials](./docs/FINANCIALS.md) ·
> [Measurements](./docs/MEASUREMENTS.md) ·
> [Lead import](./docs/LEAD_IMPORT.md)

## What it solves

The company is audited roughly every six months and has to produce organized
subcontractor insurance records on demand. Vertical Ops answers, in seconds:

- Which subcontractors are compliant right now, and which should not be scheduled?
- Which certificates expire in the next 7, 30 or 60 days?
- Who worked on Project X, and what insurance did they have *at the time*?
- Can I hand an auditor one organized ZIP without searching email and folders?

## Modules

| Route | What |
|---|---|
| `/ops/dashboard` | KPIs, expiring coverage, vendors needing attention, Documentation Readiness |
| `/ops/leads` | Website lead intake · table + kanban · convert to customer + project |
| `/ops/contacts` | Homeowners, businesses, property managers |
| `/ops/projects` | Prospect → complete, with a Compliance tab per job |
| `/ops/subcontractors` | Vendor records, certificates, documents, renewal requests |
| `/ops/compliance` | The register — every sub, every required coverage, evaluated |
| `/ops/documents` | Private vault, signed-URL downloads only |
| `/ops/tasks` · `/ops/activity` | Follow-ups and the permanent audit trail |
| `/ops/audits` | Six-month audit cycles and organized ZIP export |
| `/ops/estimates` | Estimates, AI drafting, roof measurements, photos, PDF and batch export |
| `/ops/schedule` | Gantt timeline of every active job |
| `/ops/invoices` | Job-linked invoicing, card/ACH via Stripe, check and cash |
| `/ops/leads/import` | Bulk import from a spreadsheet or another CRM |
| `/ops/settings` | Reminder timing, insurance requirements, pricebook, measurements, payments, financial access, users |
| `/upload/coi/{token}` | Public, tokenised vendor upload — no login |

Project detail also carries **Financials** (invoices, costs, gross profit) and
**Photos** (before / during / after) tabs; subcontractor detail carries an
**Agreement** tab.

## The one thing to understand

**A certificate is not one expiration date.** One ACORD form carries GL, WC and
Auto with three different carriers and three different renewal dates. Vertical
Ops stores one row per coverage line and evaluates each independently — which is
why renewal reminders and audit answers are correct. See
[COI_COMPLIANCE_RULES.md](./docs/COI_COMPLIANCE_RULES.md).

**Renewals never overwrite history.** A new certificate is a new version; the old
one is marked `replaced`, never deleted. Six-month audits ask what was on file in
March, and that question has to stay answerable.

**Money is integer cents, and the AI never sets a price.** Estimate and invoice
arithmetic lives in one pure file, `lib/ops/finance/calc.ts`. AI drafts a scope
and a line list; unit prices come from the pricebook by id, or the line is
flagged and cannot be sent. See
[ESTIMATING.md](./docs/ESTIMATING.md) and [FINANCIALS.md](./docs/FINANCIALS.md).

**A payment is only real when Stripe's signed webhook says so.** The browser
coming back from checkout is never treated as proof.

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in Supabase; everything else is optional
npm run dev                    # http://localhost:3000  ·  CRM at /ops

npm run verify                 # typecheck + lint + tests + production build
npm test                       # 65 unit tests
```

Supabase setup, migrations, the private bucket, seeding the first admin and the
production checklist are all in [DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## How website leads reach the CRM

```
Website form  →  POST /api/public/leads  →  Supabase lead row
                 (honeypot, origin allow-list, rate limit, Zod)
                        ↓
                 activity log  →  office notification  →  visible in /ops/leads
```

The lead row is written **first**. An email failure is logged and never surfaced
— losing an enquiry because Resend hiccuped would be the worst possible outcome.
The old `/api/quote` endpoint still works and forwards to the new one.

## Requesting a renewed COI

Office clicks **Request updated COI** → a 32-byte token is generated (only its
SHA-256 hash is stored) → the vendor gets `/upload/coi/{token}` → they upload
from their phone with no login → the certificate lands as **Needs review**.
The office can always copy the link and send it themselves. An upload alone can
never make a vendor compliant.

## Roles

| Role | Can |
|---|---|
| **Owner / Admin** | Everything, including user management |
| **Office / Compliance** | Everything operational: vendors, COIs, reviews, waivers, audits, requirements |
| **Project Manager** | Read everything; edit records, assign vendors, upload documents. Cannot change insurance requirements or grant exceptions. |
| **Read-only / Auditor** | View records and the Audit Center; download packages. Cannot edit anything. |

Enforced three times: middleware, server-side capability checks on every
mutation, and Postgres Row Level Security.

## Security posture

Private storage bucket with no public read · short-lived signed URLs minted per
click · hashed upload tokens · Zod on every mutation and public endpoint ·
rate-limited public endpoints · `import 'server-only'` so a leaked service key
is a build error rather than a runtime incident · no raw stack traces to users ·
permanent audit log with secrets filtered out.

---

# The public marketing site

Everything below documents the public website. **It was not modified by the CRM
work** beyond three additive changes: `app/layout.tsx` wraps its chrome in
`SiteChrome` so it does not render on `/ops`, `QuoteForm` posts to the CRM
endpoint, and `robots.ts` disallows `/ops` and `/upload/`. Every marketing route
is still statically prerendered.

## Required Vercel Environment Variables

See [`.env.example`](./.env.example) for the complete, commented list covering
both the site and Vertical Ops. The website-only subset:

```txt
OPENAI_API_KEY=your_openai_api_key_here        # AI chatbot (server-side only)
RESEND_API_KEY=your_resend_api_key_here        # lead email delivery
LEAD_NOTIFICATION_EMAIL=Office@verticalbc.com  # where leads are sent
RESEND_FROM_EMAIL=your_verified_resend_sender  # verified Resend sender
NEXT_PUBLIC_SITE_URL=https://www.verticalbuildersandcommercial.com
```

Add these in Vercel → Project Settings → Environment Variables, then redeploy.
No secrets live in the repo; nothing secret is exposed to the browser
(`NEXT_PUBLIC_SITE_URL` is a public URL, not a secret). Without `OPENAI_API_KEY`
the chatbot uses its built-in fallback engine; without `RESEND_API_KEY` form
leads are logged server-side (visible in `vercel logs`) and the visitor still
sees the success state.

## Quick start

    npm install
    npm run dev        # http://localhost:3000
    npm run build      # production build
    npm run start      # serve production build
    npm run lint       # eslint (next/core-web-vitals)

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project → Import** the repo. Framework is auto-detected
   (Next.js) — no settings needed.
3. Add environment variables (Settings → Environment Variables), from `.env.example`:
   - `RESEND_API_KEY` — from https://resend.com (verify the sending domain)
   - `LEAD_TO_EMAIL` — where leads go (Office@verticalbc.com)
   - `LEAD_FROM_EMAIL` — verified sender, e.g. leads@verticalbc.com
4. Redeploy. Test the contact form; leads arrive by email.

**Without** `RESEND_API_KEY`, the form still works: leads are logged server-side
(`vercel logs` or dev console) and the user sees the success state. Do not ship
production this way for long — set up Resend (or swap in Formspree/EmailJS inside
`app/api/quote/route.ts`; the integration point is documented there).

## Where things live

| Path | What |
|---|---|
| `lib/data.ts` | **Single source of truth**: phone, email, licenses, reviews, FAQs, service areas |
| `lib/services.ts` | Content for the three service pages |
| `lib/gallery.ts` + `lib/gallery-manifest.json` | Gallery categories + image manifest (name, size, alt) |
| `lib/serviceAreas.ts` | 16 location pages: unique intro/local copy, county, nearby areas per city |
| `app/` | Routes: `/`, `/roofing`, `/interior-repair`, `/pools-lanais`, `/gallery`, `/about`, `/contact`, `/service-areas`, `/service-areas/[slug]` (16 SSG city pages), `/thank-you`, `/api/quote` |
| `components/` | One component per section; `ServicePageTemplate` powers all three service pages |
| `public/images/` | Curated homepage set (19 optimized WebP) |
| `public/gallery/<cat>/{full,thumb}/` | 56 gallery photos + 480px thumbnails |
| `public/videos/` | `hero-flyover.mp4` (hero bg), `pool-build.mp4` (project card) |
| `public/brand/` | Real logo files (full + V mark); favicon generated at `app/icon.png` |

## Performance notes

- Homepage uses only the curated image set; the 56-photo gallery is a separate
  route with 480px thumbnails, `next/image` lazy loading, and a full-res lightbox.
- Hero video: two encodes — 1.5 MB desktop, 0.4 MB 720p mobile — muted/looped/playsInline
  with WebP poster fallback; skipped entirely for `prefers-reduced-motion` and Data Saver users.
- All marketing pages are statically prerendered. The `/ops` CRM and `/upload`
  portal are server-rendered on demand (per-user session data) and are excluded
  from the sitemap and robots.txt.
- `next/image` serves AVIF/WebP with responsive `sizes` on Vercel automatically.

## Location pages (GEO/AEO)

- `/service-areas` index + 26 statically generated city pages (Sarasota → Boca Grande).
  LaBelle and Immokalee were intentionally left as non-clickable mentions — too far
  inland / too little search demand to justify pages (they'd read as doorway pages).
- Each page has unique intro copy and a local angle (no doorway-page duplication),
  city-specific metadata, Service + FAQPage + BreadcrumbList JSON-LD, nearby-area
  links, and a local CTA. All are in the sitemap.
- To add a city: add one entry to `lib/serviceAreas.ts` — route, metadata, and
  sitemap pick it up automatically.

## Service pages

Seven service pages: three pillars (`/roofing`, `/interior-repair`, `/pools-lanais`)
plus four with distinct search value: `/new-construction`, `/kitchen-bath-remodels`,
`/impact-windows-doors`, `/permitting-help`. All share `ServicePageTemplate`, are
linked from the homepage chips, footer, and every location page. Chips without a
page (fences/gutters, pavers, epoxy, structural engineering) are covered inside
the pillar pages instead of thin standalone pages.

## AI assistant (OpenAI-powered, with offline fallback)

Two layers, so the chat never breaks:

1. **`app/api/chat/route.ts`** — OpenAI Responses API (`gpt-4o-mini`), server-side
   only. Reads `OPENAI_API_KEY` from Vercel env vars — the key never reaches the
   browser and is never a `NEXT_PUBLIC_` variable. Site knowledge (services, all 26
   service areas, licenses CGC1528626/CCC1333649, contact, financing language, FAQs,
   page paths) is injected as structured instructions from the same `lib/` data the
   pages render from. Behavior rules enforce: concise contractor tone, no invented
   prices/timelines/permit/insurance/financing promises, single Nokomis office,
   call/estimate-form guidance, and "call to confirm" for unknown cities.
2. **`lib/assistant.ts`** — deterministic rule engine used as instant fallback when
   the key is missing or OpenAI errors (route returns 503 → widget answers locally).
   Verified against 10 expected-answer test questions (10/10).

**To activate real AI:** add `OPENAI_API_KEY` in Vercel → Settings → Environment
Variables and redeploy. Until then the fallback engine answers everything.

Optional upgrades (commented in the route): OpenAI `file_search` with a vector
store of site content, or `web_search` if answers should ever use outside info
(off by default — not needed for a contractor knowledge bot).

## Mobile design

- Fluid type/spacing via `clamp()`; hero keeps full impact with stacked full-width CTAs.
- Project media rows become swipeable scroll-snap cards on <960px; trust bar swipes horizontally.
- 48px minimum tap targets; larger form inputs on mobile; sticky call/estimate bar.

## SEO

- Per-page `metadata` exports (title template, descriptions, OG image)
- JSON-LD: GeneralContractor/RoofingContractor in root layout, FAQPage on pages with FAQs
- `app/sitemap.ts` and `app/robots.ts` generate sitemap.xml / robots.txt
- Semantic headings; local keywords in copy

## AI assistant (future)

`components/AiAssistantWidget.tsx` is a working placeholder: floating brand button
→ panel with quick actions (call / request estimate). No API keys required; nothing
breaks without them. To make it a real AI agent:

1. Add `app/api/assistant/route.ts` that calls your LLM provider
   (e.g. Anthropic) using `process.env.ANTHROPIC_API_KEY` — server-side only,
   never expose the key to the client.
2. Replace the static messages in the widget with chat state + POST to that route.
3. Keep the call/estimate quick actions visible during chat — they are the conversion.

## ⚠️ Before launch: production domain

All canonical URLs, OG tags, sitemap, robots, and schema derive from `BIZ.siteUrl`
in `lib/data.ts`, which now reads `NEXT_PUBLIC_SITE_URL` from the environment.
The Vercel preview URL contains a "commerical" typo — when the final domain is
connected, set `NEXT_PUBLIC_SITE_URL` in Vercel and redeploy. No code change needed.

## Business facts (verified 7/1/26)

- Licenses **CGC1528626 / CCC1333649** — confirmed by Fred; match the current site
  and the client's own services graphic. Verify anytime at Florida DBPR.
- Reviews section: short excerpts of real Google reviews (4.9★ / 75 at time of
  pull), attributed by first name, linking to the full Google profile.

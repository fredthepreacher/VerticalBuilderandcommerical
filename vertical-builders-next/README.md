# Vertical Builders & Commercial — Next.js Web App

Production-ready lead-generation web app for a licensed Florida general contractor
(CGC1528626) and roofing contractor (CCC1333649) in Nokomis, FL.

Stack: **Next.js 14 (App Router) · TypeScript · React 18** — no CSS framework,
one hand-rolled global stylesheet. Deploy target: **Vercel**.

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
- All pages are statically prerendered except `/api/quote`.
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

All canonical URLs, OG tags, sitemap, robots, and schema derive from ONE constant:
`BIZ.siteUrl` in `lib/data.ts` (currently `https://www.verticalbuildersandcommercial.com`).
The Vercel preview URL contains a "commerical" typo — when the final domain is
connected in Vercel, update `BIZ.siteUrl` to match and redeploy. One line, done.

## Business facts (verified 7/1/26)

- Licenses **CGC1528626 / CCC1333649** — confirmed by Fred; match the current site
  and the client's own services graphic. Verify anytime at Florida DBPR.
- Reviews section: short excerpts of real Google reviews (4.9★ / 75 at time of
  pull), attributed by first name, linking to the full Google profile.

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
| `app/` | Routes: `/`, `/roofing`, `/interior-repair`, `/pools-lanais`, `/gallery`, `/about`, `/contact`, `/thank-you`, `/api/quote` |
| `components/` | One component per section; `ServicePageTemplate` powers all three service pages |
| `public/images/` | Curated homepage set (19 optimized WebP) |
| `public/gallery/<cat>/{full,thumb}/` | 56 gallery photos + 480px thumbnails |
| `public/videos/` | `hero-flyover.mp4` (hero bg), `pool-build.mp4` (project card) |
| `public/brand/` | Real logo files (full + V mark); favicon generated at `app/icon.png` |

## Performance notes

- Homepage uses only the curated image set; the 56-photo gallery is a separate
  route with 480px thumbnails, `next/image` lazy loading, and a full-res lightbox.
- Hero video: desktop-only, muted/looped/playsInline, ~1.5 MB, poster fallback,
  respects `prefers-reduced-motion`. Phones never download it.
- All pages are statically prerendered except `/api/quote`.
- `next/image` serves AVIF/WebP with responsive `sizes` on Vercel automatically.

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

## Business facts (verified 7/1/26)

- Licenses **CGC1528626 / CCC1333649** — confirmed by Fred; match the current site
  and the client's own services graphic. Verify anytime at Florida DBPR.
- Reviews section: short excerpts of real Google reviews (4.9★ / 75 at time of
  pull), attributed by first name, linking to the full Google profile.

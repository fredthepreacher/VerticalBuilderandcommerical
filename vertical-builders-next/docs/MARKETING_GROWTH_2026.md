# Marketing site — 2026 growth, UX & search pass

Branch `marketing-growth-pass-2026`, cut from `main` @ `09ba556` (production, PR #4 merged 2026‑09‑16).
Marketing routes only — no file under `app/ops`, `app/api`, `app/upload`, `lib/ops`, `middleware.ts` or `supabase/` was changed.
**Not merged. Not deployed.** Merging to `main` deploys production.

## Why these changes

**Business:** Vertical Builders & Commercial, 303 S Tamiami Trail Unit H, Nokomis FL. Florida Certified General Contractor CGC1528626 **and** Certified Roofing Contractor CCC1333649. Homeowners (primary) and commercial owners across Sarasota, Charlotte, Manatee, Lee, Collier and DeSoto counties. Primary goal: estimate requests + calls. Primary CTA: **Get a Free Estimate** (secondary: call).

**Verified differentiators** (used as positioning):
1. Two state certifications under one company — roof *and* the interior damage under it. Of the competitors studied, only one (RNW) combines roofing + GC, and it doesn't show license numbers.
2. Permit / unpermitted-work resolution by a GC that can also build the corrections. Permit expediters (e.g. Sarasota Permits) can't build; roofers don't cover it. Real reviews back this (“Eddie Ramon… worked with the county through the entire process”).
3. Real project photography and a named, reachable owner.

**Competitor pattern** (Anthony C. Leonard, SonShine, Siesta, Chappelle, Red Dog's, Mark Kaufman, RNW, Sarasota Permits): big review counts, manufacturer badges and warranties on display, templated city pages, thin FAQs, and no one publishes sourced answers on the 25% rule, roof-age insurance law or after-the-fact permits. Those content gaps are what the new guides and service FAQs target.

## What changed

### Search & entity
- **301s for 20 legacy WordPress URLs** still indexed by Google and currently 404ing (`/relaunch`, `/roofing-services`, `/residential-roofing`, `/commercial-roofing`, `/pool-enclosure-and-cages`, `/new-construction-builder`, `/our-service-areas`, the four long city URLs, `/structural-construction-…`, `/page/:n`, `/feed`, `/category/*`, `/author/*`…) → `lib/redirects.mjs`, wired in `next.config.mjs`.
- **og:url bug fixed.** The layout set `openGraph.url` to the homepage, and Next hands the parent's whole `openGraph` to any page that doesn't define one — so every inner page told social/AI crawlers it *was* the homepage. New `lib/seo.ts#pageMeta()` gives every page its own canonical, og:url, og:title/description/image and Twitter card.
- One business entity with a stable `@id`; every Service/Article/Page block references it. Added `WebSite`, `AboutPage`, `ContactPage`, `ItemList`, `ImageGallery` (55 original photos as `ImageObject`), `Article` (guides, with citations), `Service` per service page, `FAQPage` on service/area/guide pages. **No AggregateRating/Review markup** (self-served stars are ineligible and the count can't be kept live) — a test enforces this.
- Sitemap: new pages, stable `lastModified` (was build time on every URL).
- Titles/descriptions rewritten where they were duplicated or over-long; H1 added to /contact and /thank-you.

### New pages (+6 static routes; marketing static routes 45 → 51)
- `/services` — hub for all services (legacy `/services` URL now resolves here).
- `/guides` + 4 sourced guides: Florida 25% roof rule (FS 553.844(5)), roof age & insurance (FS 627.7011(5)), unpermitted work & after‑the‑fact permits, roof leak → ceiling damage order of operations.

### Service pages (all 7)
Quick-answer passage (quotable), warning signs, how-it-works steps (permit-specific steps on /permitting-help), matching real reviews, 3–6 FAQs with sources, featured city links, related services + guides, CTA that pre-selects the project type on the form.

### City pages (26)
Each now answers **who issues permits there** (city vs county vs split jurisdictions — Englewood, Manasota Key, Lakewood Ranch, Anna Maria Island), with visible breadcrumbs, varied metadata and links to the guides. **Removed unverifiable claims** (“several of our featured roofing projects are in this area”, “we have built ground-up homes in the North Port area”, “our most requested projects here”, “fastest response times”). Lakewood Ranch county corrected to Manatee & Sarasota.

### Homepage & conversion
- New hero: clear promise (“The roof, the repairs under it & the permits — one licensed contractor”), licenses + rating + free estimate proof line, and a **“What do you need help with?”** picker that sends visitors to the form with their project type chosen.
- New sections: *A roof leak is two jobs — we're licensed for both* (differentiator, with DBPR verify link) and *Permit problems, solved* (5-step process + real review).
- Reviews now always show “as of July 2026”. “At a glance” fact sheet rebuilt as a definition list for answer engines.
- Header: Services menu (all services), Permit Help, Guides, persistent **Free Estimate** button; shrinks on scroll; Escape closes menus; skip link.
- Contact: real H1, “What happens next” (3 steps), emergency note, preferred contact method (already supported by the CRM), accessible inline errors with focus on the first error, privacy note.
- **Lead-data fix:** website project types now all exist in the CRM's `SERVICE_TYPES` (the old “Remodeling” value didn't, so those leads fell outside every CRM filter).
- GA4: delegated `click_to_call`, `click_email`, `cta_click`, `outbound_profile` events. The existing `qualify_lead` event is untouched.
- 404 page lists likely destinations for old links.

### Design & accessibility
- Brand kept (navy + signal orange, Oswald/Inter). Added industry-specific motifs instead of SaaS styling: roof-pitch chevron on section labels, roof-peak edge on CTA bands, blueprint grid on the permit band and plain heroes, a license “placard” on About, warm sand neutral instead of cool UI gray.
- Orange darkened to `#c8361b` for text/buttons (white text 5.25:1; old `#f0492c` was 3.69:1 and failed AA). Bright orange kept for accents on navy.
- Focus-visible rings, keyboard-reachable horizontal scrollers, underlined in-text links, gallery filter semantics fixed (was `role=tab` with no tabpanels), lightbox focus management, reveal-on-scroll that is off for reduced-motion users and never hides content without JS.
- axe-core WCAG 2.1 AA: **0 violations** on /, /roofing, /permitting-help, /contact, /service-areas/venice, a guide, /gallery, /about, /services (390px).
- No horizontal overflow on 22 pages × 10 widths (320–1920). Privacy/Terms overflowed on phones before; fixed.

## Verification
`npm run verify`: typecheck ✓ · lint ✓ · **843 tests pass** (824 before + 19 new in `tests/marketing-seo.test.ts`) · build ✓.
Build: 51 static marketing routes, all `/ops` routes still dynamic. Every sitemap URL has one H1, a self-canonical, matching og:url and parseable JSON-LD; 0 broken internal links. Redirects verified with `next start` (trailing-slash URLs take two hops: `/relaunch/` → `/relaunch` → `/about`).

Not verifiable in the sandbox: Google Fonts (blocked by the sandbox network; loads normally on Vercel), Lighthouse field data, live lead insertion (no Supabase env locally — the API returned `stored:false` as designed).

## Owner actions (outside the code)
1. **Approve & merge** — review the Vercel preview of this branch first; merging deploys production.
2. **Fix NAP:** 2025 press releases list **(941) 800‑2411**; the site uses **941‑877‑2009**. Standardize the phone and “303 S Tamiami Trail **Unit H**” on Google, Yelp, Nextdoor, Facebook, RoofingQuotes (missing phone + website), Fence Contractor USA (miscategorized as a fence contractor).
3. **roofinginvertical.com** ranks for the brand but errors (Cloudflare 525). 301 it to this site or take it down.
4. **Google Business Profile:** primary category *Roofing contractor* or *General contractor* (pick by lead value), add the other + *Remodeler*; list every service page as a Service; add the permit-help service explicitly; post project photos weekly; ask each happy customer for a review mentioning the job + city; set the website to the homepage and the appointment link to `/contact`.
5. **Confirm or supply** (so they can be published): Google rating/count (update `BIZ.ratingValue/ratingCount/ratingAsOf` together), years in business (press release says 2014 — not published until confirmed), workmanship warranty terms, financing lender/terms, manufacturer certifications, business hours, an owner photo + short bio, and project locations (city) for gallery photos → these unlock city-specific proof and case studies.
6. **Search Console:** verify the domain, submit `/sitemap.xml`, and watch Coverage for the old WordPress URLs moving to “Page with redirect”.
7. **GA4:** mark `qualify_lead` and `click_to_call` as key events; link Search Console.
8. **Citations:** BBB and Angi profiles (none found), Sarasota & Venice chambers, Houzz with project photos.
9. Eyewall Armor hurricane fabric (from the 2025 release): if still offered and it has product approval, it's a good candidate for its own page.

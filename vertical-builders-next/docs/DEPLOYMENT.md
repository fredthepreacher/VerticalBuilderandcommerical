# Deployment

Start to finish, roughly 30–45 minutes. **The public marketing site keeps working
throughout** — if you stop after step 1, nothing changes for visitors except that
lead notification emails start coming from the new endpoint.

---

## 0. Prerequisites

- The GitHub repo connected to the existing Vercel project
- A Supabase account (the free tier is fine for this data volume)
- Optional: a Resend account with `verticalbc.com` verified

---

## 1. Create the Supabase project

1. https://supabase.com → **New project**
2. Region **East US (North Virginia)** — closest to Vercel's default and to SWFL
3. Save the database password somewhere safe
4. Project Settings → API, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` **(secret — server only)**

---

## 2. Run the migrations

SQL Editor → paste and run **in order**, one at a time:

| File | What it does |
|---|---|
| `supabase/migrations/0001_core_schema.sql` | Tables, indexes, `updated_at` triggers, auto-profile on signup |
| `supabase/migrations/0002_rls.sql` | Row Level Security on every table |
| `supabase/migrations/0003_storage.sql` | Creates the private `vertical-private-documents` bucket + policies |
| `supabase/migrations/0004_default_requirements.sql` | Starter global requirement template |
| `supabase/migrations/0005_operations_platform.sql` | **Phase 2.** 14 new tables (estimates, invoices, payments, costs, photos, measurements, imports, agreements, pricebook), new nullable columns on `projects` and `app_settings`, and the invoice-recalculation trigger. Additive only — nothing is dropped |
| `supabase/migrations/0006_phase2_rls.sql` | **Phase 2.** RLS for the new tables, plus `can_view_costs()` / `can_view_profit()` |
| `supabase/migrations/0007_starter_pricebook.sql` | **Phase 2.** 26 catalogue items, all at $0 and tagged `needs-price` — price them in Settings → Pricebook before quoting |
| `supabase/migrations/0008_invoice_balance_guard.sql` | **Phase 2.** Keeps `balance_due_cents` equal to `total_cents − amount_paid_cents` on every write, and repairs any row already stale. Added after the production-readiness pass found two paths that left it wrong |
| `supabase/migrations/0009_auditor_financial_lockdown.sql` | **Phase 2.** Removes job-cost and profitability visibility from the `read_only`/Auditor role. Admin, office and the configurable project-manager switches are unchanged |
| `supabase/migrations/0010_data_api_grants.sql` | **Phase 2.** Grants the `authenticated` and `service_role` roles the Data API privileges the schema depends on, and sets default privileges so future tables inherit them. Without this the CRM renders blank. `anon` stays revoked |

All ten are re-runnable: applying them twice on a clean Postgres 16 produces
an identical schema and exactly 26 pricebook rows (verified 2026-08-23).

> **If the CRM renders blank after signing in, it is almost certainly grants.**
> Supabase has a project setting called *Automatically expose new tables* (Data
> API settings). When it is off, new tables get no privileges for the
> `authenticated` role, so every screen comes back empty even though login
> works and the rows exist. Migration `0010` issues those grants itself, so the
> setting no longer matters — but if you skipped `0010`, that is the symptom.

Each should report success with no errors. Verify:

- **Table Editor** → 36 tables under `public`
- **Storage** → `vertical-private-documents` exists and is **not** public
- **Authentication → Policies** → every table shows RLS enabled

> `0003` creates the bucket via SQL. If your project restricts that, create it
> manually in Storage: name `vertical-private-documents`, **Public = off**,
> file size limit 10 MB — then re-run `0003` for the policies.

---

## 3. Seed the first admin

Supabase → **Authentication → Users → Add user**

- Email: `Office@verticalbc.com` (or the owner's address)
- Password: set one, or send an invite
- ✅ Auto Confirm User

The `on_auth_user_created` trigger creates the matching `profiles` row
automatically. **The first user to sign up becomes `admin`; everyone after
defaults to `office`,** and an admin can change roles in Settings → Users.

Add the rest of the team the same way.

---

## 4. Configure Vercel

Project → Settings → Environment Variables. Add for **Production** (and Preview
if you use it):

| Variable | Value | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from step 1 | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1 | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 | Yes |
| `NEXT_PUBLIC_SITE_URL` | `https://www.verticalbuildersandcommercial.com` | Yes |
| `NEXT_PUBLIC_CRM_URL` | same as above (CRM is at `/ops`) | Yes |
| `CRON_SECRET` | `openssl rand -base64 32` | For reminders |
| `RESEND_API_KEY` | from Resend | For email |
| `RESEND_FROM_EMAIL` | `leads@verticalbc.com` | For email |
| `LEAD_NOTIFICATION_EMAIL` | `Office@verticalbc.com` | For email |
| `OPENAI_API_KEY` | existing value, if the site chat is in use | Optional |
| `PUBLIC_FORM_SHARED_SECRET` | **leave blank** | Only for a split deployment |

**Phase 2 — all optional.** Every one of these features works without its
variable set; each reports its own state in Settings rather than failing
silently.

| Variable | Value | Enables |
|---|---|---|
| `OPENAI_ESTIMATE_MODEL` | e.g. `gpt-4o` | AI estimate drafting (with `OPENAI_API_KEY`) |
| `ROOF_MEASUREMENT_PROVIDER` | `manual` \| `eagleview` \| `nearmap` | Default measurement source |
| `EAGLEVIEW_CLIENT_ID` / `EAGLEVIEW_CLIENT_SECRET` | from EagleView | Ordering EagleView reports |
| `NEARMAP_API_KEY` | from Nearmap | Ordering Nearmap reports |
| `GOOGLE_MAPS_API_KEY` | from Google Cloud | Static aerial picture on the estimate screen |
| `STRIPE_SECRET_KEY` | `sk_live_…` | Online payments |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | Online payments |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Confirming those payments |

### Stripe webhook

After the first deploy: Stripe → Developers → Webhooks → **Add endpoint**

- URL: `https://<your-domain>/api/webhooks/stripe`
- Events: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `charge.refunded`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy. **All three
Stripe variables must be present before the Pay button appears** — the Payments
settings tab names any that are missing, and reports whether the keys are live
or test.

Without Supabase vars the site still builds and serves; `/ops/login` explains
what is missing. Without `RESEND_API_KEY` leads are still saved and renewal
links are still generated — you copy and send them yourself. Without
`CRON_SECRET` the reminder endpoint refuses to run rather than becoming an open
email relay.

---

## 5. Auth redirect URLs

Supabase → Authentication → URL Configuration:

- **Site URL:** `https://www.verticalbuildersandcommercial.com`
- **Redirect URLs:** add
  - `https://www.verticalbuildersandcommercial.com/ops/dashboard`
  - `https://www.verticalbuildersandcommercial.com/ops/login`
  - `http://localhost:3000/ops/dashboard` (development)

Required for the email sign-in link option to work.

---

## 6. Deploy

```bash
npm run verify     # typecheck + lint + tests + production build
git push
```

Vercel builds automatically. `vercel.json` registers the daily cron
(12:00 UTC ≈ 8am ET) and the `noindex` headers on `/ops` and `/upload`.

> **Cron requires a Vercel Pro plan.** On Hobby, point an external scheduler
> (cron-job.org, GitHub Actions) at
> `GET https://…/api/cron/compliance-reminders` with header
> `Authorization: Bearer <CRON_SECRET>`. Same behaviour.

---

## 7. Verify production

Work through these in order:

- [ ] Marketing site loads; header, footer, gallery, sticky CTA all normal
- [ ] `/ops/dashboard` while signed out → redirects to `/ops/login`
- [ ] Sign in as admin → dashboard renders
- [ ] Submit the website contact form → lead appears in `/ops/leads` within seconds
- [ ] Office notification email arrives (if Resend is configured)
- [ ] Create a subcontractor
- [ ] Upload a COI with GL + WC coverage lines → status shows **Needs review**
- [ ] Approve it → status recalculates
- [ ] Set a coverage expiration 20 days out → shows **Expiring Soon**
- [ ] Request an updated COI → open the link in a private window → upload → new
      certificate appears as Needs review
- [ ] Paste a document's `storage_path` into a browser directly → **denied**
- [ ] Download via the app → works
- [ ] Create an audit cycle → generate a package → ZIP contains the register and
      the vendor folders
- [ ] Generate a second package → the first is still downloadable
- [ ] Open the dashboard and compliance table on a phone
- [ ] Trigger the cron manually:
      `curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/compliance-reminders`
- [ ] Call it without the header → **401**

### Phase 2

- [ ] Settings → Pricebook lists 26 items and warns that they are unpriced
- [ ] Price one item, then build an estimate from it → line total is correct
- [ ] Add a line with no pricebook item → it is flagged **needs review**
- [ ] Try to send that estimate → **refused**, naming the line
- [ ] Clear the flag, send it, approve it, convert it → a job is created and the
      customer record is **reused**, not duplicated
- [ ] Download the estimate PDF; batch-export two estimates → one PDF each
- [ ] Import a small CSV with a quoted comma, a duplicate row and a row with no
      contact details → the duplicate is flagged, the bad row is rejected, and
      the error CSV downloads
- [ ] Create an invoice from the approved estimate, send it, record a check
      payment for part of it → status shows **partially paid** and the balance
      is right
- [ ] Record a payment larger than the balance → refused until the overpayment
      box is ticked
- [ ] Void the payment → the balance returns to its previous value
- [ ] (If Stripe is configured) Pay a test invoice → the payment only appears
      **after** the webhook lands, not on the browser redirect
- [ ] Send the same Stripe event twice from the dashboard → the second is
      recorded as a duplicate and does **not** double-credit
- [ ] Log a job cost → gross profit and margin appear for admin
- [ ] Sign in as a project manager with `profit_visible_to_pm` off → costs are
      visible, profit is not
- [ ] Sign in as a field user → neither costs nor profit are visible
- [ ] Set scheduled dates on two jobs → both bars appear on `/ops/schedule`
- [ ] Upload before/after photos on a phone → they appear under the right phase
- [ ] Record a subcontractor agreement without a document and mark it signed →
      **refused**; attach the PDF and it saves
- [ ] Record a second agreement → the first becomes **superseded** and is still
      downloadable

---

## 8. Demo data

`supabase/seed_demo.sql` creates five subcontractors that exercise every
compliance state (compliant, expiring, missing WC, expired, needs review), plus
leads, contacts, projects and an audit cycle. **Development and staging only.**
Everything is prefixed `[DEMO]`; the removal script is at the bottom of the file.

---

## 9. Rollback

The CRM is additive. To disable it without touching the marketing site:

1. Remove the Supabase env vars in Vercel → `/ops` redirects to a login page that
   explains it is not configured. Every marketing route is unaffected.
2. Full revert: `git revert` the commit and redeploy. The Supabase project can
   stay — no data is lost.

---

## 10. Backups

Supabase takes daily automatic backups on paid plans. On the free tier:

```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" \
  --no-owner --no-acl -f vertical-ops-$(date +%F).sql
```

Storage objects are **not** in that dump. Download the bucket separately, or
treat the audit packages (which embed copies of every source document) as the
practical archive.

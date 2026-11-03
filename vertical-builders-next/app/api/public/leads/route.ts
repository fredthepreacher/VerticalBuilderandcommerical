import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { isOpsConfigured } from '@/lib/ops/supabase/env'
import { createLeadFromWebsite, type IntakeResult } from '@/lib/ops/services/leads'
import { newLeadEmail, officeEmail, recordNotification, sendEmail } from '@/lib/ops/services/notifications'
import { publicLeadSchema, type PublicLeadInput } from '@/lib/ops/validations/lead'

/**
 * ============================================================================
 * PUBLIC LEAD INTAKE  —  the only write path open to the internet
 * ----------------------------------------------------------------------------
 * The website form posts here. Defences, in order:
 *   1. honeypot field ("company") — bots fill it, humans never see it
 *   2. origin allow-list — cross-site posts are rejected
 *   3. optional shared secret for a cross-app deployment
 *   4. in-memory rate limit per IP
 *   5. Zod validation with hard length caps
 *   6. service-role insert restricted to exactly one table and one shape
 *
 * Once the lead row exists the visitor is told we have it. Email notification
 * failures are logged, never surfaced — losing a lead because Resend hiccuped
 * would be the worst possible outcome here.
 *
 * If the row can't be written (CRM not configured, paused, down or too slow),
 * the whole lead is emailed to the office instead, and the visitor is told we
 * have it once that email is accepted.
 * ============================================================================
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** How long the CRM gets to store a lead before the office is emailed it instead. */
const STORE_TIMEOUT_MS = 8_000

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Vertical Ops did not answer within ${ms} ms`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** The email-only copy of a lead the CRM couldn't take, with every field the visitor filled in. */
function emailUnsavedLead(lead: PublicLeadInput) {
  const message = newLeadEmail({
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    serviceType: lead.projectType,
    customerType: lead.customerType,
    message: lead.message,
    sourcePage: lead.sourcePage,
    crmUrl: null,
    details: {
      Address: [lead.propertyAddress, lead.zip].filter(Boolean).join(' '),
      Timeline: lead.timeline,
      'Contact by': lead.preferredContactMethod,
      Financing: lead.financingInterest ? 'Interested' : null,
    },
  })
  return sendEmail({ to: officeEmail(), subject: message.subject, text: message.text, replyTo: lead.email })
}

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5
const buckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    if (buckets.size > 5000) buckets.clear() // crude ceiling; serverless instances are short-lived
    return false
  }
  bucket.count += 1
  return bucket.count > MAX_PER_WINDOW
}

function allowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  // Same-origin form posts from the marketing site send no Origin in some
  // browsers; that is fine, the honeypot and validation still apply.
  if (!origin) return true

  const allowed = new Set(
    [
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.NEXT_PUBLIC_CRM_URL,
      'https://www.verticalbuildersandcommercial.com',
      'https://verticalbuildersandcommercial.com',
    ].filter(Boolean) as string[],
  )

  const host = request.headers.get('host')
  if (host) {
    allowed.add(`https://${host}`)
    allowed.add(`http://${host}`)
  }

  try {
    const url = new URL(origin)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
    for (const candidate of allowed) {
      if (new URL(candidate).host === url.host) return true
    }
  } catch {
    return false
  }
  return false
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  if (!allowedOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'Request rejected.' }, { status: 403 })
  }

  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: 'Too many submissions. Please wait a minute and try again, or call us at 941-877-2009.' },
      { status: 429 },
    )
  }

  // Optional shared secret, for when the website is deployed separately.
  const requiredSecret = process.env.PUBLIC_FORM_SHARED_SECRET
  if (requiredSecret && request.headers.get('x-vbc-form-secret') !== requiredSecret) {
    return NextResponse.json({ ok: false, error: 'Request rejected.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const parsed = publicLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Please check the form and try again.', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  // Honeypot — respond exactly like a success so bots learn nothing.
  if (parsed.data.company && parsed.data.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  // The CRM may be not wired up, paused or down. The site must not break and the lead must not be
  // lost, so when it can't be stored the office gets the whole lead by email instead.
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null
  let result: IntakeResult = { ok: false, error: 'CRM not configured' }
  if (isOpsConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      admin = createSupabaseAdminClient()
      result = await withTimeout(createLeadFromWebsite(admin, parsed.data), STORE_TIMEOUT_MS)
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  if (!admin || !result.ok) {
    console.error('[leads] not stored in Vertical Ops, emailing the office instead:', result.error)
    const fallback = await emailUnsavedLead(parsed.data)
    if (fallback.status === 'sent') return NextResponse.json({ ok: true, stored: false })

    console.error('[leads] lead neither stored nor emailed:', JSON.stringify({
      name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone,
      service: parsed.data.projectType, city: parsed.data.city,
    }))
    return NextResponse.json(
      { ok: false, error: 'We could not save that. Please call us at 941-877-2009 and we will take the details.' },
      { status: 500 },
    )
  }

  // Notification is best-effort and must never affect the response.
  const crmUrl = `${(process.env.NEXT_PUBLIC_CRM_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')}/ops/leads/${result.leadId}`
  const message = newLeadEmail({
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
    city: parsed.data.city,
    serviceType: parsed.data.projectType,
    customerType: parsed.data.customerType,
    message: parsed.data.message,
    sourcePage: parsed.data.sourcePage,
    crmUrl,
  })

  const outcome = await sendEmail({
    to: officeEmail(),
    subject: message.subject,
    text: message.text,
    replyTo: parsed.data.email,
  })
  await recordNotification(admin, {
    notificationType: 'new_lead',
    recipient: officeEmail(),
    outcome,
  })

  return NextResponse.json({ ok: true, leadId: result.leadId })
}

export function GET() {
  return NextResponse.json({ ok: false, error: 'Method not allowed.' }, { status: 405 })
}

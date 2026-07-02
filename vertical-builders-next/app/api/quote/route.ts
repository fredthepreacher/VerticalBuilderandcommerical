import { NextResponse } from 'next/server'

/**
 * Lead form endpoint (Vercel-compatible).
 *
 * Email delivery uses Resend (https://resend.com) when RESEND_API_KEY is set:
 *   RESEND_API_KEY  — Resend API key
 *   LEAD_TO_EMAIL   — where leads go (default Office@verticalbc.com)
 *   LEAD_FROM_EMAIL — verified sender (e.g. leads@verticalbc.com)
 *
 * Without a key (local dev / first deploy), the lead is logged server-side and
 * the endpoint still returns success so the UX can be tested end-to-end.
 * Swap in Formspree/EmailJS here instead if preferred.
 */

interface QuotePayload {
  name?: string
  phone?: string
  email?: string
  city?: string
  projectType?: string
  message?: string
  company?: string // honeypot
}

const clean = (v: unknown, max = 500) => String(v ?? '').slice(0, max).trim()

export async function POST(req: Request) {
  let body: QuotePayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  // Honeypot — pretend success for bots
  if (body.company) return NextResponse.json({ ok: true })

  const lead = {
    name: clean(body.name, 120),
    phone: clean(body.phone, 40),
    email: clean(body.email, 160),
    city: clean(body.city, 80),
    projectType: clean(body.projectType, 60),
    message: clean(body.message, 2000),
    receivedAt: new Date().toISOString(),
  }

  if (!lead.name || !lead.phone || !lead.email) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.LEAD_TO_EMAIL || 'Office@verticalbc.com'
  const from = process.env.LEAD_FROM_EMAIL || 'onboarding@resend.dev'

  if (apiKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Website Leads <${from}>`,
        to: [to],
        reply_to: lead.email,
        subject: `New ${lead.projectType || 'project'} lead — ${lead.name} (${lead.city || 'SWFL'})`,
        text: [
          `Name: ${lead.name}`,
          `Phone: ${lead.phone}`,
          `Email: ${lead.email}`,
          `City: ${lead.city || '—'}`,
          `Project type: ${lead.projectType || '—'}`,
          '',
          'Message:',
          lead.message || '—',
        ].join('\n'),
      }),
    })
    if (!res.ok) {
      console.error('Resend error', res.status, await res.text())
      return NextResponse.json({ ok: false, error: 'Email delivery failed' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  }

  // No email provider configured — log the lead so it isn't silently lost.
  // Visible in `vercel logs` / local dev console. Configure RESEND_API_KEY for production!
  console.warn('[LEAD — no RESEND_API_KEY configured]', JSON.stringify(lead))
  return NextResponse.json({ ok: true, demo: true })
}

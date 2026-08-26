import { NextResponse } from 'next/server'

/**
 * LEGACY lead endpoint.
 *
 * The website form now posts to /api/public/leads, which writes the lead into
 * Vertical Ops (Supabase) and then notifies the office. This route is kept so
 * that anything still pointing at the old URL — a cached page, an external
 * form, a Zapier hook someone set up — keeps working instead of silently
 * dropping enquiries. It forwards the payload to the new endpoint.
 *
 * Safe to delete once nothing has hit it for a while; check the server logs.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  console.warn('[quote] legacy /api/quote used — forwarding to /api/public/leads')

  const url = new URL('/api/public/leads', request.url)
  const forwarded = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Preserve the caller's origin so the allow-list behaves identically.
      ...(request.headers.get('origin') ? { origin: request.headers.get('origin')! } : {}),
      ...(process.env.PUBLIC_FORM_SHARED_SECRET
        ? { 'x-vbc-form-secret': process.env.PUBLIC_FORM_SHARED_SECRET }
        : {}),
    },
    body: JSON.stringify({ ...body, sourcePage: body.sourcePage ?? '/api/quote (legacy)' }),
  })

  const result = await forwarded.json().catch(() => ({ ok: forwarded.ok }))
  return NextResponse.json(result, { status: forwarded.status })
}

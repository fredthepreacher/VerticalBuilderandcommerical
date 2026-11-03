import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The website form must never lose a lead: when Vertical Ops can't store it (not configured, paused,
// down or too slow), the office gets the whole lead by email and the visitor still sees success.

const mocks = vi.hoisted(() => ({
  configured: true,
  createLeadFromWebsite: vi.fn(),
  sendEmail: vi.fn(),
  recordNotification: vi.fn(),
}))

vi.mock('@/lib/ops/supabase/env', () => ({ isOpsConfigured: () => mocks.configured }))
vi.mock('@/lib/ops/supabase/admin', () => ({ createSupabaseAdminClient: () => ({}) }))
vi.mock('@/lib/ops/services/leads', () => ({ createLeadFromWebsite: mocks.createLeadFromWebsite }))
vi.mock('@/lib/ops/services/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ops/services/notifications')>()),
  sendEmail: mocks.sendEmail,
  recordNotification: mocks.recordNotification,
}))

import { POST } from '../app/api/public/leads/route'

const ORIGINAL_ENV = { ...process.env }
let ip = 0

const lead = {
  name: 'Sample Visitor',
  email: 'visitor@example.com',
  phone: '941-555-0100',
  projectType: 'Roofing',
  city: 'Venice',
  propertyAddress: '100 Sample St',
  zip: '34285',
  timeline: 'Within a month',
  message: 'Leak over the garage.',
}

function submit(body: Record<string, unknown> = lead) {
  ip += 1 // a fresh address per request keeps the per-IP rate limit out of the way
  return POST(new NextRequest('https://www.verticalbuildersandcommercial.com/api/public/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `203.0.113.${ip}` },
    body: JSON.stringify(body),
  }))
}

const sentEmail = () => mocks.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string; replyTo: string }

beforeEach(() => {
  mocks.configured = true
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
  process.env.LEAD_NOTIFICATION_EMAIL = 'office@example.com'
  mocks.createLeadFromWebsite.mockReset()
  mocks.sendEmail.mockReset().mockResolvedValue({ status: 'sent', id: 'email-1' })
  mocks.recordNotification.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('public lead intake', () => {
  it('stores the lead and notifies the office with a link to it', async () => {
    mocks.createLeadFromWebsite.mockResolvedValue({ ok: true, leadId: 'lead-1' })

    const res = await submit()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, leadId: 'lead-1' })
    expect(sentEmail().text).toContain('Open in Vertical Ops:')
    expect(sentEmail().text).toContain('/ops/leads/lead-1')
    expect(mocks.recordNotification).toHaveBeenCalledOnce()
  })

  it('emails the whole lead to the office when the CRM rejects the insert', async () => {
    mocks.createLeadFromWebsite.mockResolvedValue({ ok: false, error: 'Lead could not be saved.' })

    const res = await submit()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stored: false })
    const email = sentEmail()
    expect(email.to).toBe('office@example.com')
    expect(email.replyTo).toBe('visitor@example.com')
    expect(email.text).toContain('NOT SAVED IN VERTICAL OPS')
    expect(email.text).toContain('941-555-0100')
    expect(email.text).toContain('Address:      100 Sample St 34285')
    expect(email.text).toContain('Timeline:     Within a month')
    expect(email.text).toContain('Leak over the garage.')
    expect(email.text).not.toContain('Open in Vertical Ops')
    expect(mocks.recordNotification).not.toHaveBeenCalled()
  })

  it('emails the office when the CRM is unreachable (for example, a paused project)', async () => {
    mocks.createLeadFromWebsite.mockRejectedValue(new TypeError('fetch failed'))

    const res = await submit()

    expect(await res.json()).toEqual({ ok: true, stored: false })
    expect(sentEmail().text).toContain('NOT SAVED IN VERTICAL OPS')
  })

  it('stops waiting for a CRM that does not answer and emails the office', async () => {
    vi.useFakeTimers()
    mocks.createLeadFromWebsite.mockReturnValue(new Promise(() => {}))

    const pending = submit()
    await vi.advanceTimersByTimeAsync(8_000)
    const res = await pending

    expect(await res.json()).toEqual({ ok: true, stored: false })
    expect(mocks.sendEmail).toHaveBeenCalledOnce()
  })

  it('emails the office when the CRM is not configured', async () => {
    mocks.configured = false

    const res = await submit()

    expect(await res.json()).toEqual({ ok: true, stored: false })
    expect(mocks.createLeadFromWebsite).not.toHaveBeenCalled()
    expect(sentEmail().text).toContain('NOT SAVED IN VERTICAL OPS')
  })

  it('asks the visitor to call when the lead can be neither stored nor emailed', async () => {
    mocks.createLeadFromWebsite.mockResolvedValue({ ok: false, error: 'Lead could not be saved.' })
    mocks.sendEmail.mockResolvedValue({ status: 'failed', error: 'Resend responded 500' })

    const res = await submit()

    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('941-877-2009')
  })

  it('still answers a bot that fills the honeypot with success, without storing or emailing', async () => {
    const res = await submit({ ...lead, company: 'Spam Co' })

    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.createLeadFromWebsite).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })
})

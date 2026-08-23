import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Email delivery through Resend.
 *
 * Every function here degrades gracefully: if RESEND_API_KEY is not configured,
 * or Resend returns an error, the caller still succeeds and the outcome is
 * recorded in notification_log. Losing a lead or a COI because an email bounced
 * would be far worse than a missed notification.
 */

export interface SendEmailInput {
  to: string | string[]
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export type EmailOutcome =
  | { status: 'sent'; id?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function sendEmail(input: SendEmailInput): Promise<EmailOutcome> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not configured — skipping:', input.subject)
    return { status: 'skipped', reason: 'RESEND_API_KEY is not configured' }
  }

  const from = process.env.RESEND_FROM_EMAIL || process.env.LEAD_FROM_EMAIL || 'onboarding@resend.dev'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Vertical Builders & Commercial <${from}>`,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error('[email] Resend rejected the message', res.status, detail)
      return { status: 'failed', error: `Resend responded ${res.status}` }
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return { status: 'sent', id: body.id }
  } catch (error) {
    console.error('[email] transport error', error)
    return { status: 'failed', error: error instanceof Error ? error.message : 'Unknown transport error' }
  }
}

export function officeEmail(): string {
  return process.env.LEAD_NOTIFICATION_EMAIL || process.env.LEAD_TO_EMAIL || 'Office@verticalbc.com'
}

export async function recordNotification(
  supabase: SupabaseClient,
  entry: {
    vendorId?: string | null
    policyId?: string | null
    notificationType: string
    thresholdDays?: number | null
    recipient?: string | null
    outcome: EmailOutcome
  },
): Promise<void> {
  const status =
    entry.outcome.status === 'sent' ? 'sent'
    : entry.outcome.status === 'skipped' ? 'logged'
    : 'failed'

  try {
    await supabase.from('notification_log').insert({
      vendor_id: entry.vendorId ?? null,
      policy_id: entry.policyId ?? null,
      notification_type: entry.notificationType,
      threshold_days: entry.thresholdDays ?? null,
      recipient: entry.recipient ?? null,
      status,
      error_message:
        entry.outcome.status === 'failed' ? entry.outcome.error
        : entry.outcome.status === 'skipped' ? entry.outcome.reason
        : null,
    })
  } catch (error) {
    console.error('[notifications] failed to write notification_log', error)
  }
}

// ---------------------------------------------------------------------------
// Message bodies
// ---------------------------------------------------------------------------

export function renewalRequestEmail(params: {
  vendorName: string
  contactName?: string | null
  uploadUrl: string
  expiresOn: string
  requested: string
  note?: string | null
  officePhone: string
}): { subject: string; text: string; html: string } {
  const greeting = params.contactName ? `Hi ${params.contactName},` : `Hello,`
  const subject = `Updated insurance certificate requested — ${params.vendorName}`
  const lines = [
    greeting,
    '',
    `Vertical Builders & Commercial needs an updated ${params.requested} on file for ${params.vendorName}.`,
    params.note ? `\n${params.note}\n` : '',
    'You can upload it here — no login or account is needed:',
    params.uploadUrl,
    '',
    `This secure link expires on ${params.expiresOn}.`,
    '',
    'You can also forward this link to your insurance agent so they can upload the certificate directly.',
    '',
    `Questions? Call the office at ${params.officePhone}.`,
    '',
    'Thank you,',
    'Vertical Builders & Commercial',
  ].filter(l => l !== '')

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a222c;line-height:1.6">
      <p>${escapeHtml(greeting)}</p>
      <p>Vertical Builders &amp; Commercial needs an updated <strong>${escapeHtml(params.requested)}</strong>
         on file for <strong>${escapeHtml(params.vendorName)}</strong>.</p>
      ${params.note ? `<p>${escapeHtml(params.note)}</p>` : ''}
      <p style="margin:28px 0">
        <a href="${params.uploadUrl}"
           style="background:#f0492c;color:#fff;text-decoration:none;padding:14px 26px;border-radius:8px;font-weight:600;display:inline-block">
          Upload Certificate
        </a>
      </p>
      <p style="color:#4a5561;font-size:13px">
        This secure link expires on ${escapeHtml(params.expiresOn)}. No login is required.
        You can forward it to your insurance agent.
      </p>
      <p style="color:#4a5561;font-size:13px">Questions? Call the office at ${escapeHtml(params.officePhone)}.</p>
      <p>Thank you,<br/>Vertical Builders &amp; Commercial</p>
    </div>`

  return { subject, text: lines.join('\n'), html }
}

export function expirationWarningEmail(params: {
  vendorName: string
  coverageLabel: string
  expirationDate: string
  daysOut: number
  crmUrl: string
}): { subject: string; text: string } {
  const when =
    params.daysOut <= 0 ? 'has expired'
    : `expires in ${params.daysOut} day${params.daysOut === 1 ? '' : 's'}`
  return {
    subject: `${params.vendorName} — ${params.coverageLabel} ${when} (${params.expirationDate})`,
    text: [
      `${params.vendorName}: ${params.coverageLabel} ${when} on ${params.expirationDate}.`,
      '',
      `Open the subcontractor record in Vertical Ops: ${params.crmUrl}`,
      '',
      'This is an automated reminder from the Vertical Ops compliance center.',
    ].join('\n'),
  }
}

export function newLeadEmail(params: {
  name: string
  phone: string
  email: string
  city?: string | null
  serviceType?: string | null
  customerType?: string | null
  message?: string | null
  sourcePage?: string | null
  crmUrl: string
}): { subject: string; text: string } {
  return {
    subject: `New ${params.serviceType || 'project'} lead — ${params.name} (${params.city || 'SWFL'})`,
    text: [
      `Name:         ${params.name}`,
      `Phone:        ${params.phone}`,
      `Email:        ${params.email}`,
      `City:         ${params.city || '—'}`,
      `Service:      ${params.serviceType || '—'}`,
      `Type:         ${params.customerType || '—'}`,
      `Landing page: ${params.sourcePage || '—'}`,
      '',
      'Message:',
      params.message || '—',
      '',
      `Open in Vertical Ops: ${params.crmUrl}`,
    ].join('\n'),
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

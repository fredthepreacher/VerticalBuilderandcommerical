import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { isOpsConfigured } from '@/lib/ops/supabase/env'
import { findExpiringPolicies } from '@/lib/ops/services/certificates'
import { refreshAllVendors } from '@/lib/ops/services/compliance'
import { getSettings } from '@/lib/ops/services/settings'
import {
  expirationWarningEmail, officeEmail, recordNotification, sendEmail,
} from '@/lib/ops/services/notifications'
import { logActivity } from '@/lib/ops/services/activity'
import { COVERAGE_LABELS, type CoverageType } from '@/lib/ops/types'

/**
 * ============================================================================
 * DAILY EXPIRATION REMINDERS
 * ----------------------------------------------------------------------------
 * Runs once a day from Vercel Cron. Protected by CRON_SECRET — without it, the
 * route refuses to do anything rather than becoming a free email cannon.
 *
 * The important behaviour is DEDUPLICATION. Each (policy, threshold) pair fires
 * exactly once, ever. Without that, a policy expiring in 30 days would generate
 * an identical email every single morning and the office would filter the whole
 * lot into a folder they never open.
 * ============================================================================
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured; refusing to run.' },
      { status: 503 },
    )
  }

  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  const header = request.headers.get('authorization')
  const queryKey = request.nextUrl.searchParams.get('key')
  const authorized = header === `Bearer ${secret}` || queryKey === secret
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  if (!isOpsConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 })
  }

  const admin = createSupabaseAdminClient()
  const settings = await getSettings(admin)
  const thresholds = [...settings.reminder_thresholds].sort((a, b) => b - a)
  const widest = Math.max(...thresholds, settings.warning_window_days)

  const crmBase = (process.env.NEXT_PUBLIC_CRM_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')

  // Include already-expired policies so "expiration day" (threshold 0) still
  // fires if the job did not run that exact morning.
  const policies = await findExpiringPolicies(admin, widest, { includeExpired: true })

  let sent = 0
  let skipped = 0
  let failed = 0
  const notified: string[] = []

  for (const policy of policies) {
    // Which configured threshold does this policy fall into today? Pick the
    // tightest one it has reached, so a policy 29 days out fires the 30-day
    // reminder, not the 60-day one all over again.
    const threshold = thresholds
      .filter(t => policy.days_out <= t)
      .sort((a, b) => a - b)[0]

    if (threshold === undefined) continue
    if (policy.days_out < -30) continue // long expired; the register already shouts about it

    // Dedupe: has this exact (policy, threshold) reminder already gone out?
    const { data: already } = await admin
      .from('notification_log')
      .select('id')
      .eq('policy_id', policy.policy_id)
      .eq('threshold_days', threshold)
      .eq('notification_type', 'expiration_warning')
      .in('status', ['sent', 'logged'])
      .limit(1)

    if (already && already.length > 0) {
      skipped += 1
      continue
    }

    const message = expirationWarningEmail({
      vendorName: policy.vendor_name,
      coverageLabel: COVERAGE_LABELS[policy.coverage_type as CoverageType] ?? policy.coverage_type,
      expirationDate: policy.expiration_date,
      daysOut: policy.days_out,
      crmUrl: `${crmBase}/ops/subcontractors/${policy.vendor_id}?tab=insurance`,
    })

    const outcome = await sendEmail({
      to: officeEmail(),
      subject: message.subject,
      text: message.text,
    })

    await recordNotification(admin, {
      vendorId: policy.vendor_id,
      policyId: policy.policy_id,
      notificationType: 'expiration_warning',
      thresholdDays: threshold,
      recipient: officeEmail(),
      outcome,
    })

    if (outcome.status === 'sent') sent += 1
    else if (outcome.status === 'failed') failed += 1
    else skipped += 1

    notified.push(`${policy.vendor_name} · ${policy.coverage_type} · ${threshold}d`)
  }

  // Keep the cached compliance status honest even if nobody opened the app.
  const refreshed = await refreshAllVendors(admin)

  await logActivity(admin, {
    action: 'reminder.sent',
    entityType: 'system',
    actorLabel: 'Daily reminder job',
    metadata: {
      policies_examined: policies.length,
      emails_sent: sent,
      skipped,
      failed,
      vendors_recalculated: refreshed,
    },
  })

  return NextResponse.json({
    ok: true,
    examined: policies.length,
    sent,
    skipped,
    failed,
    vendorsRecalculated: refreshed,
    thresholds,
    notified: notified.slice(0, 50),
  })
}

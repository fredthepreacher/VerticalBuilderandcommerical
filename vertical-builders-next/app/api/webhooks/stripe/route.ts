import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { isOpsConfigured } from '@/lib/ops/supabase/env'
import { logActivity } from '@/lib/ops/services/activity'
import {
  eventOutcome, HANDLED_EVENT_TYPES, verifyStripeWebhook, WebhookVerificationError,
} from '@/lib/ops/finance/payment-provider'

/**
 * ============================================================================
 * STRIPE WEBHOOK — the only thing that can mark a payment as received
 * ----------------------------------------------------------------------------
 * Three properties make this safe:
 *
 *   1. SIGNATURE VERIFIED. The raw body is checked against
 *      STRIPE_WEBHOOK_SECRET, which also enforces a timestamp tolerance, so a
 *      captured event body cannot be replayed later. An unverifiable request is
 *      rejected outright — never "processed just in case".
 *
 *   2. IDEMPOTENT. Every event id is written to payment_events, which has a
 *      unique index on (provider, provider_event_id). Stripe retries on any
 *      non-2xx and can deliver the same event more than once; the second
 *      insert fails and we return 200 without touching the payment again.
 *
 *   3. ALWAYS 200 ON A HANDLED EVENT. Returning an error to Stripe for
 *      something we have already recorded just makes it retry forever. Genuine
 *      processing failures are recorded with status 'failed' for a human, and
 *      only an unverifiable signature returns a 4xx.
 * ============================================================================
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isOpsConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  // The RAW body is required — any parsing or re-serialising breaks the HMAC.
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event
  try {
    event = verifyStripeWebhook(rawBody, signature)
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error('[stripe-webhook] rejected:', error.message)
      return NextResponse.json({ error: 'Signature verification failed.' }, { status: 400 })
    }
    console.error('[stripe-webhook] unexpected verification error', error)
    return NextResponse.json({ error: 'Could not process this event.' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  // --- Idempotency gate ---------------------------------------------------
  const { error: ledgerError } = await admin.from('payment_events').insert({
    provider: 'stripe',
    provider_event_id: event.id,
    event_type: event.type,
    invoice_id: event.invoiceId,
    status: HANDLED_EVENT_TYPES.has(event.type) ? 'processed' : 'ignored',
    payload_summary_json: event.summary,
  })

  if (ledgerError) {
    // 23505 = unique violation: we have seen this event before.
    if ((ledgerError as { code?: string }).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('[stripe-webhook] ledger insert failed', ledgerError)
    // Genuine database trouble — let Stripe retry.
    return NextResponse.json({ error: 'Could not record the event.' }, { status: 500 })
  }

  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type })
  }

  const outcome = eventOutcome(event.type)
  if (!outcome || !event.invoiceId) {
    await admin.from('payment_events')
      .update({ status: 'ignored', error_message: 'No invoice reference on the event.' })
      .eq('provider_event_id', event.id)
    return NextResponse.json({ received: true, ignored: 'no invoice reference' })
  }

  try {
    // Find the pending row created when the session was opened; fall back to
    // matching on the payment intent for a payment started outside the app.
    const { data: pending } = await admin
      .from('payments')
      .select('id, status, amount_cents, project_id')
      .eq('invoice_id', event.invoiceId)
      .eq('provider', 'stripe')
      .or(
        [
          event.sessionId ? `provider_session_id.eq.${event.sessionId}` : null,
          event.paymentIntentId ? `provider_payment_id.eq.${event.paymentIntentId}` : null,
          'status.eq.pending',
        ].filter(Boolean).join(','),
      )
      .order('created_at', { ascending: false })
      .limit(1)

    const existing = pending?.[0]

    if (outcome === 'succeeded') {
      const amount = event.amountCents ?? existing?.amount_cents ?? 0

      if (existing) {
        await admin.from('payments').update({
          status: 'succeeded',
          amount_cents: amount,
          provider_payment_id: event.paymentIntentId,
          received_date: new Date().toISOString().slice(0, 10),
          notes: 'Confirmed by Stripe webhook.',
        }).eq('id', existing.id)
      } else {
        // No pending row: a payment link paid outside the normal flow.
        const { data: invoice } = await admin
          .from('invoices').select('project_id').eq('id', event.invoiceId).maybeSingle()
        if (!invoice) throw new Error('Invoice referenced by the event does not exist.')

        await admin.from('payments').insert({
          invoice_id: event.invoiceId,
          project_id: invoice.project_id,
          amount_cents: amount,
          method: 'card',
          status: 'succeeded',
          provider: 'stripe',
          provider_payment_id: event.paymentIntentId,
          provider_session_id: event.sessionId,
          received_date: new Date().toISOString().slice(0, 10),
          notes: 'Recorded from a Stripe webhook with no matching pending payment.',
        })
      }

      await logActivity(admin, {
        action: 'payment.succeeded',
        entityType: 'invoice',
        entityId: event.invoiceId,
        actorLabel: 'Stripe webhook',
        metadata: { amount_cents: amount, event_type: event.type },
      })
    }

    if (outcome === 'failed' && existing) {
      await admin.from('payments').update({
        status: 'failed',
        notes: String(event.summary.failure ?? 'Stripe reported the payment failed.'),
      }).eq('id', existing.id)

      await logActivity(admin, {
        action: 'payment.failed',
        entityType: 'invoice',
        entityId: event.invoiceId,
        actorLabel: 'Stripe webhook',
        metadata: { event_type: event.type, reason: event.summary.failure ?? null },
      })
    }

    if (outcome === 'refunded') {
      const refunded = event.refundedAmountCents ?? 0
      if (existing) {
        await admin.from('payments').update({
          refunded_amount_cents: refunded,
          status: refunded >= (existing.amount_cents as number) ? 'refunded' : 'succeeded',
          notes: 'Refund recorded from a Stripe webhook.',
        }).eq('id', existing.id)
      }
      await logActivity(admin, {
        action: 'payment.refunded',
        entityType: 'invoice',
        entityId: event.invoiceId,
        actorLabel: 'Stripe webhook',
        metadata: { refunded_amount_cents: refunded },
      })
    }

    // The database trigger recalculates the invoice from its payments; this is
    // belt and braces in case a row was written outside the trigger's path.
    await admin.rpc('recalculate_invoice_totals', { p_invoice_id: event.invoiceId })

    return NextResponse.json({ received: true, outcome })
  } catch (error) {
    console.error('[stripe-webhook] processing failed', error)
    await admin.from('payment_events').update({
      status: 'failed',
      error_message: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
    }).eq('provider_event_id', event.id)

    // 200 so Stripe stops retrying — the failure is recorded for a person to
    // pick up in Settings → System rather than looping forever.
    return NextResponse.json({ received: true, processing_failed: true })
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed.' }, { status: 405 })
}

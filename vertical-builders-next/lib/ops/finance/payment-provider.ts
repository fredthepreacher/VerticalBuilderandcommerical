import 'server-only'
import Stripe from 'stripe'

/**
 * ============================================================================
 * PAYMENT PROVIDER
 * ----------------------------------------------------------------------------
 * Vertical Ops never sees a card number or a bank account number. The customer
 * is sent to Stripe's hosted Checkout page, enters their details there, and the
 * only thing that comes back to us is an event saying what happened.
 *
 * Two rules govern everything below:
 *
 *   1. THE BROWSER REDIRECT IS NOT PROOF OF PAYMENT. A success URL can be typed
 *      into an address bar. Payment status changes only when a signed webhook
 *      says so.
 *
 *   2. WEBHOOKS ARE PROCESSED IDEMPOTENTLY. Stripe retries; a network blip
 *      means the same event arrives twice. The unique index on
 *      payment_events(provider, provider_event_id) is what makes a replay a
 *      no-op rather than a double credit.
 *
 * With no Stripe credentials, everything here reports "not configured" and the
 * invoicing module carries on: check, cash and other manual payments are
 * recorded by the office exactly as before.
 * ============================================================================
 */

export interface PaymentSessionInput {
  invoiceId: string
  invoiceNumber: string
  projectName: string
  amountCents: number
  customerEmail?: string | null
  methods: ('card' | 'ach')[]
  successUrl: string
  cancelUrl: string
}

export interface PaymentSessionResult {
  ok: boolean
  sessionId?: string
  url?: string
  error?: string
}

export interface PaymentStatusResult {
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'void'
  amountCents?: number
  providerPaymentId?: string | null
}

export interface PaymentProvider {
  readonly name: string
  isConfigured(): boolean
  createPaymentSession(input: PaymentSessionInput): Promise<PaymentSessionResult>
  getPaymentStatus(externalId: string): Promise<PaymentStatusResult>
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function isWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET)
}

let client: Stripe | null = null

function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set.')
  }
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Pinned so a Stripe API change cannot alter behaviour without a deploy.
      apiVersion: '2025-02-24.acacia',
      typescript: true,
      appInfo: { name: 'Vertical Ops', version: '2.0.0' },
    })
  }
  return client
}

export const stripeProvider: PaymentProvider = {
  name: 'stripe',

  isConfigured: isStripeConfigured,

  async createPaymentSession(input: PaymentSessionInput): Promise<PaymentSessionResult> {
    if (!isStripeConfigured()) {
      return {
        ok: false,
        error: 'Online payments are not configured. Record a check or bank transfer manually, or add Stripe credentials in Settings.',
      }
    }
    if (input.amountCents <= 0) {
      return { ok: false, error: 'There is no balance left to pay on this invoice.' }
    }

    // Stripe's minimum charge is 50 cents; below that the session is rejected
    // with an opaque error, so it is caught here with a useful message.
    if (input.amountCents < 50) {
      return { ok: false, error: 'Online payments must be at least $0.50. Record this one manually instead.' }
    }

    const methods: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = []
    if (input.methods.includes('card')) methods.push('card')
    if (input.methods.includes('ach')) methods.push('us_bank_account')
    if (methods.length === 0) {
      return { ok: false, error: 'No online payment method is enabled in Settings.' }
    }

    try {
      const session = await stripe().checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: methods,
          customer_email: input.customerEmail ?? undefined,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: input.amountCents,
                product_data: {
                  name: `Invoice ${input.invoiceNumber}`,
                  description: input.projectName.slice(0, 300),
                },
              },
            },
          ],
          // Echoed back on the webhook — this is how an event finds its invoice.
          metadata: {
            invoice_id: input.invoiceId,
            invoice_number: input.invoiceNumber,
            source: 'vertical-ops',
          },
          payment_intent_data: {
            metadata: { invoice_id: input.invoiceId, invoice_number: input.invoiceNumber },
            description: `${input.invoiceNumber} — ${input.projectName}`.slice(0, 300),
          },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        },
        // Retrying "pay this invoice" must not create two sessions.
        { idempotencyKey: `inv_${input.invoiceId}_${input.amountCents}` },
      )

      return { ok: true, sessionId: session.id, url: session.url ?? undefined }
    } catch (error) {
      console.error('[stripe] session creation failed', error)
      return {
        ok: false,
        error: 'The payment page could not be opened. Try again, or record the payment manually.',
      }
    }
  },

  async getPaymentStatus(externalId: string): Promise<PaymentStatusResult> {
    if (!isStripeConfigured()) return { status: 'pending' }
    try {
      const intent = await stripe().paymentIntents.retrieve(externalId)
      return {
        status: mapIntentStatus(intent.status),
        amountCents: intent.amount_received || intent.amount,
        providerPaymentId: intent.id,
      }
    } catch (error) {
      console.error('[stripe] status lookup failed', error)
      return { status: 'pending' }
    }
  },
}

function mapIntentStatus(status: Stripe.PaymentIntent.Status): PaymentStatusResult['status'] {
  switch (status) {
    case 'succeeded': return 'succeeded'
    case 'canceled': return 'void'
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'processing':
    case 'requires_capture':
      return 'pending'
    default: return 'pending'
  }
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

export interface VerifiedEvent {
  id: string
  type: string
  invoiceId: string | null
  paymentIntentId: string | null
  sessionId: string | null
  amountCents: number | null
  /** Only ever set on a refund event. */
  refundedAmountCents: number | null
  summary: Record<string, unknown>
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

/**
 * Verifies a Stripe signature and extracts only the fields we act on.
 *
 * `constructEvent` checks the HMAC *and* the timestamp tolerance, which is what
 * stops an attacker replaying a genuine old event body. Verification is
 * mandatory — an unsigned or unverifiable request is rejected, never
 * "processed just in case".
 */
export function verifyStripeWebhook(rawBody: string, signature: string | null): VerifiedEvent {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new WebhookVerificationError('STRIPE_WEBHOOK_SECRET is not configured; refusing to trust this request.')
  }
  if (!signature) {
    throw new WebhookVerificationError('Missing Stripe-Signature header.')
  }

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret)
  } catch (error) {
    throw new WebhookVerificationError(
      error instanceof Error ? `Signature verification failed: ${error.message}` : 'Signature verification failed.',
    )
  }

  return extractEvent(event)
}

export function extractEvent(event: Stripe.Event): VerifiedEvent {
  const base = {
    id: event.id,
    type: event.type,
    invoiceId: null as string | null,
    paymentIntentId: null as string | null,
    sessionId: null as string | null,
    amountCents: null as number | null,
    refundedAmountCents: null as number | null,
    summary: {} as Record<string, unknown>,
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session
      return {
        ...base,
        invoiceId: (session.metadata?.invoice_id as string) ?? null,
        paymentIntentId: typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
        sessionId: session.id,
        amountCents: session.amount_total ?? null,
        summary: {
          payment_status: session.payment_status,
          invoice_number: session.metadata?.invoice_number ?? null,
        },
      }
    }

    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent
      return {
        ...base,
        invoiceId: (intent.metadata?.invoice_id as string) ?? null,
        paymentIntentId: intent.id,
        amountCents: intent.amount_received || intent.amount,
        summary: {
          status: intent.status,
          failure: intent.last_payment_error?.message ?? null,
          invoice_number: intent.metadata?.invoice_number ?? null,
        },
      }
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      return {
        ...base,
        invoiceId: (charge.metadata?.invoice_id as string) ?? null,
        paymentIntentId: typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id ?? null,
        amountCents: charge.amount,
        refundedAmountCents: charge.amount_refunded,
        summary: { refunded: charge.refunded, amount_refunded: charge.amount_refunded },
      }
    }

    default:
      return { ...base, summary: { ignored: true } }
  }
}

/** Events that change a payment. Anything else is logged and ignored. */
export const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
])

export function eventOutcome(type: string): 'succeeded' | 'failed' | 'refunded' | null {
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded'
      || type === 'payment_intent.succeeded') {
    return 'succeeded'
  }
  if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') {
    return 'failed'
  }
  if (type === 'charge.refunded') return 'refunded'
  return null
}

export interface PaymentConfigState {
  onlineEnabled: boolean
  stripeConfigured: boolean
  webhookConfigured: boolean
  publishableKeyPresent: boolean
  message: string
}

/** Drives Settings → Payments. Never exposes a key value. */
export function describePaymentConfig(onlineEnabledSetting: boolean): PaymentConfigState {
  const stripeConfigured = isStripeConfigured()
  const webhookConfigured = isWebhookConfigured()

  let message: string
  if (!stripeConfigured) {
    message = 'Stripe is not connected. Check, cash and manually-recorded payments work normally; card and ACH need STRIPE_SECRET_KEY.'
  } else if (!webhookConfigured) {
    message = 'Stripe is connected but STRIPE_WEBHOOK_SECRET is missing. Payments cannot be confirmed automatically — set the webhook secret before taking card payments.'
  } else if (!onlineEnabledSetting) {
    message = 'Stripe is fully configured but online payments are switched off below.'
  } else {
    message = 'Online card and ACH payments are live. Payment status updates from verified Stripe webhooks only.'
  }

  return {
    onlineEnabled: onlineEnabledSetting && stripeConfigured && webhookConfigured,
    stripeConfigured,
    webhookConfigured,
    publishableKeyPresent: Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    message,
  }
}

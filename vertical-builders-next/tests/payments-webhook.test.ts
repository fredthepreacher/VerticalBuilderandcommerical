import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import {
  describePaymentConfig, eventOutcome, extractEvent, HANDLED_EVENT_TYPES,
  isStripeConfigured, isWebhookConfigured, verifyStripeWebhook, WebhookVerificationError,
} from '../lib/ops/finance/payment-provider'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

const event = (type: string, object: unknown): Stripe.Event =>
  ({ id: `evt_${type}`, type, data: { object } } as unknown as Stripe.Event)

describe('eventOutcome', () => {
  it('maps every handled event type to an outcome', () => {
    for (const type of HANDLED_EVENT_TYPES) {
      expect(eventOutcome(type)).not.toBeNull()
    }
  })

  it('classifies success, failure and refund correctly', () => {
    expect(eventOutcome('checkout.session.completed')).toBe('succeeded')
    expect(eventOutcome('checkout.session.async_payment_succeeded')).toBe('succeeded')
    expect(eventOutcome('payment_intent.succeeded')).toBe('succeeded')
    expect(eventOutcome('checkout.session.async_payment_failed')).toBe('failed')
    expect(eventOutcome('payment_intent.payment_failed')).toBe('failed')
    expect(eventOutcome('charge.refunded')).toBe('refunded')
  })

  it('returns null for events we do not act on, so they are logged and ignored', () => {
    expect(eventOutcome('customer.created')).toBeNull()
    expect(eventOutcome('invoice.paid')).toBeNull()
    expect(eventOutcome('')).toBeNull()
  })
})

describe('extractEvent', () => {
  it('pulls the invoice id out of checkout session metadata, never out of the URL', () => {
    const result = extractEvent(event('checkout.session.completed', {
      id: 'cs_test_1',
      payment_intent: 'pi_test_1',
      amount_total: 250_000,
      payment_status: 'paid',
      metadata: { invoice_id: 'inv-uuid', invoice_number: 'INV-26-0007' },
    }))
    expect(result.invoiceId).toBe('inv-uuid')
    expect(result.sessionId).toBe('cs_test_1')
    expect(result.paymentIntentId).toBe('pi_test_1')
    expect(result.amountCents).toBe(250_000)
    expect(result.summary.invoice_number).toBe('INV-26-0007')
  })

  it('handles an expanded payment_intent object as well as a string id', () => {
    const result = extractEvent(event('checkout.session.completed', {
      id: 'cs_test_2', payment_intent: { id: 'pi_expanded' }, amount_total: 100, metadata: {},
    }))
    expect(result.paymentIntentId).toBe('pi_expanded')
  })

  it('leaves the invoice id null when metadata is missing, rather than guessing', () => {
    const result = extractEvent(event('checkout.session.completed', {
      id: 'cs_test_3', amount_total: 100,
    }))
    expect(result.invoiceId).toBeNull()
  })

  it('prefers amount_received on a payment intent', () => {
    const succeeded = extractEvent(event('payment_intent.succeeded', {
      id: 'pi_1', amount: 500_00, amount_received: 500_00, status: 'succeeded', metadata: { invoice_id: 'x' },
    }))
    expect(succeeded.amountCents).toBe(50_000)

    const failed = extractEvent(event('payment_intent.payment_failed', {
      id: 'pi_2', amount: 500_00, amount_received: 0, status: 'requires_payment_method',
      last_payment_error: { message: 'Your card was declined.' }, metadata: {},
    }))
    expect(failed.amountCents).toBe(50_000)
    expect(failed.summary.failure).toBe('Your card was declined.')
  })

  it('captures the refunded amount separately from the charge amount', () => {
    const result = extractEvent(event('charge.refunded', {
      id: 'ch_1', payment_intent: 'pi_1', amount: 100_000, amount_refunded: 25_000,
      refunded: false, metadata: { invoice_id: 'inv-uuid' },
    }))
    expect(result.amountCents).toBe(100_000)
    expect(result.refundedAmountCents).toBe(25_000)
    expect(result.invoiceId).toBe('inv-uuid')
  })

  it('marks an unhandled event as ignored instead of inventing fields', () => {
    const result = extractEvent(event('customer.subscription.created', { id: 'sub_1' }))
    expect(result.summary).toEqual({ ignored: true })
    expect(result.invoiceId).toBeNull()
    expect(result.amountCents).toBeNull()
  })
})

describe('verifyStripeWebhook', () => {
  it('refuses when no webhook secret is configured', () => {
    expect(() => verifyStripeWebhook('{}', 't=1,v1=abc')).toThrow(WebhookVerificationError)
    expect(() => verifyStripeWebhook('{}', 't=1,v1=abc')).toThrow(/STRIPE_WEBHOOK_SECRET/)
  })

  it('refuses an unsigned request rather than processing it just in case', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    expect(() => verifyStripeWebhook('{}', null)).toThrow(/Stripe-Signature/)
  })

  it('refuses a forged signature', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    expect(() => verifyStripeWebhook('{"id":"evt_1"}', 't=1,v1=deadbeef'))
      .toThrow(WebhookVerificationError)
  })
})

describe('configuration reporting', () => {
  it('reports nothing configured on a bare environment', () => {
    expect(isStripeConfigured()).toBe(false)
    expect(isWebhookConfigured()).toBe(false)
    const state = describePaymentConfig(true)
    expect(state.onlineEnabled).toBe(false)
    expect(state.message).toMatch(/STRIPE_SECRET_KEY/)
  })

  it('will not report online payments live while the webhook secret is missing', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    const state = describePaymentConfig(true)
    expect(state.stripeConfigured).toBe(true)
    expect(state.webhookConfigured).toBe(false)
    expect(state.onlineEnabled).toBe(false)
    expect(state.message).toMatch(/STRIPE_WEBHOOK_SECRET/)
  })

  it('reports the setting being off separately from the keys being absent', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const state = describePaymentConfig(false)
    expect(state.onlineEnabled).toBe(false)
    expect(state.message).toMatch(/switched off/i)
  })

  it('reports live only when the keys and the setting agree', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_123'
    const state = describePaymentConfig(true)
    expect(state.onlineEnabled).toBe(true)
    expect(state.publishableKeyPresent).toBe(true)
  })

  it('never puts a secret value in the message it shows an operator', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_SUPERSECRETVALUE'
    const state = describePaymentConfig(true)
    expect(state.message).not.toContain('SUPERSECRETVALUE')
  })
})

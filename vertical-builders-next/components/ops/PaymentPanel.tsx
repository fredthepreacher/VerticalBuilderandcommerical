'use client'

import { useState, useTransition } from 'react'
import { CreditCard, Landmark, Receipt } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import {
  createPaymentSessionAction, recordPaymentAction, sendInvoiceAction,
  voidInvoiceAction, voidPaymentAction,
} from '@/app/ops/actions/finance'
import { formatCents } from '@/lib/ops/utils/money'
import { formatDate } from '@/lib/ops/utils/dates'
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/ops/types'
import { Badge } from './StatusBadge'

export interface PaymentRow {
  id: string
  amountCents: number
  refundedCents: number
  method: PaymentMethod
  status: string
  provider: string | null
  checkNumber: string | null
  receivedDate: string | null
  notes: string | null
}

/**
 * Payment recording.
 *
 * Manual entry (check, cash, bank transfer someone confirmed) always works and
 * needs no configuration. Online card and ACH appear only when Stripe is fully
 * connected, and even then this panel never marks a payment as received — that
 * only happens when the verified webhook arrives.
 */
export default function PaymentPanel({
  invoiceId,
  invoiceStatus,
  balanceDueCents,
  payments,
  onlineEnabled,
  onlineMessage,
  allowedMethods,
  canRecord,
  canRefund,
  canVoid,
}: {
  invoiceId: string
  invoiceStatus: string
  balanceDueCents: number
  payments: PaymentRow[]
  onlineEnabled: boolean
  onlineMessage: string
  allowedMethods: string[]
  canRecord: boolean
  canRefund: boolean
  canVoid: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [showVoid, setShowVoid] = useState(false)
  const [voidReason, setVoidReason] = useState('')

  const isDraft = invoiceStatus === 'draft'
  const isVoid = invoiceStatus === 'void'
  const settled = balanceDueCents <= 0
  const overpaid = balanceDueCents < 0

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <Receipt aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-muted)' }} />
        <h2>Payments</h2>
      </div>

      <div className="ops-card-body">
        {overpaid && (
          <div className="ops-banner warn">
            <div>
              <strong>Overpaid by {formatCents(Math.abs(balanceDueCents))}</strong>
              More has been received than this invoice is for. Refund the difference or apply it to
              another invoice — it will not clear itself.
            </div>
          </div>
        )}

        {isDraft && canVoid && (
          <div className="ops-banner info">
            <div>
              <strong>This invoice is still a draft</strong>
              Mark it as sent before recording a payment, so the numbers stop moving.
            </div>
            <div className="ops-banner-actions">
              <button type="button" className="ops-btn ops-btn-sm ops-btn-dark" disabled={pending}
                onClick={() => startTransition(async () => {
                  const result = await sendInvoiceAction(invoiceId)
                  setMessage(result.error ?? result.message ?? null)
                })}>
                Mark as sent
              </button>
            </div>
          </div>
        )}

        {/* ---- history ------------------------------------------------------ */}
        {payments.length > 0 && (
          <div className="ops-table-wrap" style={{ marginBottom: 16 }}>
            <table className="ops-table">
              <thead>
                <tr><th>Received</th><th>Method</th><th className="num">Amount</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {payments.map(payment => (
                  <tr key={payment.id}>
                    <td className="nowrap">{payment.receivedDate ? formatDate(payment.receivedDate) : '—'}</td>
                    <td>
                      {PAYMENT_METHOD_LABELS[payment.method]}
                      {payment.checkNumber && <span className="ops-sub2">Check #{payment.checkNumber}</span>}
                      {payment.provider === 'stripe' && <span className="ops-sub2">via Stripe</span>}
                    </td>
                    <td className="num">
                      {formatCents(payment.amountCents)}
                      {payment.refundedCents > 0 && (
                        <span className="ops-sub2">−{formatCents(payment.refundedCents)} refunded</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={
                        payment.status === 'succeeded' ? 'ok'
                        : payment.status === 'pending' ? 'warn'
                        : payment.status === 'failed' ? 'bad' : 'neutral'
                      }>
                        {payment.status}
                      </Badge>
                    </td>
                    <td className="ops-actions">
                      {canRefund && payment.status === 'succeeded' && payment.provider !== 'stripe' && (
                        <button type="button" className="ops-btn ops-btn-sm ops-btn-danger" disabled={pending}
                          onClick={() => startTransition(async () => {
                            const result = await voidPaymentAction(payment.id, 'Voided by the office')
                            setMessage(result.error ?? result.message ?? null)
                          })}>
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {message && (
          <p className={message.toLowerCase().includes('could not') || message.toLowerCase().includes('cannot')
            ? 'ops-error' : 'ops-hint'} role="status">{message}</p>
        )}

        {/* ---- online -------------------------------------------------------- */}
        {!isDraft && !isVoid && !settled && canRecord && (
          <div style={{ marginBottom: 18 }}>
            {onlineEnabled ? (
              <>
                <ActionForm action={createPaymentSessionAction}>
                  {state => {
                    if (state.ok && state.data?.checkoutUrl && !checkoutUrl) {
                      setCheckoutUrl(String(state.data.checkoutUrl))
                    }
                    return (
                      <>
                        <input type="hidden" name="invoice_id" value={invoiceId} />
                        <SubmitButton className="ops-btn ops-btn-primary" pendingLabel="Opening…">
                          {allowedMethods.includes('ach')
                            ? <><CreditCard aria-hidden="true" /><Landmark aria-hidden="true" /> Take card or ACH payment</>
                            : <><CreditCard aria-hidden="true" /> Take card payment</>}
                        </SubmitButton>
                      </>
                    )
                  }}
                </ActionForm>

                {checkoutUrl && (
                  <div className="ops-banner info" style={{ marginTop: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>Secure payment link</strong>
                      <code style={{ fontSize: '.73rem', wordBreak: 'break-all', display: 'block', marginTop: 4 }}>
                        {checkoutUrl}
                      </code>
                    </div>
                    <div className="ops-banner-actions">
                      <a className="ops-btn ops-btn-sm" href={checkoutUrl} target="_blank" rel="noopener noreferrer">
                        Open
                      </a>
                    </div>
                  </div>
                )}

                <p className="ops-hint" style={{ marginTop: 8 }}>
                  The invoice is only marked paid when Stripe confirms it. Returning from the
                  payment page does not, on its own, prove anything.
                </p>
              </>
            ) : (
              <p className="ops-hint">{onlineMessage}</p>
            )}
          </div>
        )}

        {/* ---- manual -------------------------------------------------------- */}
        {!isDraft && !isVoid && canRecord && (
          <div style={{ paddingTop: 16, borderTop: '1px solid var(--ops-line)' }}>
            <h3 style={{ marginBottom: 12 }}>Record a payment received</h3>
            <ActionForm action={recordPaymentAction}>
              {state => (
                <>
                  <input type="hidden" name="invoice_id" value={invoiceId} />
                  <div className="ops-grid-2">
                    <div className="ops-field">
                      <label htmlFor="pay-amount">Amount ($)</label>
                      <input id="pay-amount" name="amount" className="ops-input" inputMode="decimal"
                        defaultValue={balanceDueCents > 0 ? (balanceDueCents / 100).toFixed(2) : ''}
                        placeholder="0.00" required />
                      {state.fieldErrors?.amount_cents && (
                        <p className="ops-error">{state.fieldErrors.amount_cents[0]}</p>
                      )}
                    </div>
                    <div className="ops-field">
                      <label htmlFor="pay-method">Method</label>
                      <select id="pay-method" name="method" className="ops-select" defaultValue="check">
                        {MANUAL_PAYMENT_METHODS.map(m => (
                          <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                        ))}
                        <option value="ach">ACH / bank transfer (already received)</option>
                        <option value="card">Card (taken elsewhere)</option>
                      </select>
                    </div>
                  </div>
                  <div className="ops-grid-3">
                    <div className="ops-field">
                      <label htmlFor="pay-check">Check number</label>
                      <input id="pay-check" name="check_number" className="ops-input" />
                    </div>
                    <div className="ops-field">
                      <label htmlFor="pay-ref">Reference</label>
                      <input id="pay-ref" name="reference_number" className="ops-input" />
                    </div>
                    <div className="ops-field">
                      <label htmlFor="pay-date">Received on</label>
                      <input id="pay-date" name="received_date" type="date" className="ops-input"
                        defaultValue={new Date().toISOString().slice(0, 10)} required />
                    </div>
                  </div>
                  <div className="ops-field">
                    <label htmlFor="pay-notes">Notes</label>
                    <input id="pay-notes" name="notes" className="ops-input"
                      placeholder="Dropped off at the office by the homeowner" />
                  </div>
                  <label className="ops-check" style={{ marginBottom: 12 }}>
                    <input type="checkbox" name="allow_overpayment" />
                    <span>
                      Allow more than the balance
                      <span className="ops-hint" style={{ display: 'block' }}>
                        Tick this only when it is intended — a deposit, or one check covering two invoices.
                      </span>
                    </span>
                  </label>
                  <SubmitButton className="ops-btn ops-btn-dark">Record payment</SubmitButton>
                </>
              )}
            </ActionForm>
          </div>
        )}

        {/* ---- void ---------------------------------------------------------- */}
        {!isVoid && canVoid && payments.filter(p => p.status === 'succeeded').length === 0 && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--ops-line)' }}>
            {!showVoid ? (
              <button type="button" className="ops-btn ops-btn-sm ops-btn-danger" onClick={() => setShowVoid(true)}>
                Void this invoice
              </button>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <input className="ops-input" placeholder="Why is this being voided?"
                  value={voidReason} onChange={e => setVoidReason(e.target.value)} aria-label="Void reason" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="ops-btn ops-btn-sm ops-btn-danger"
                    disabled={pending || voidReason.trim().length < 3}
                    onClick={() => startTransition(async () => {
                      const result = await voidInvoiceAction(invoiceId, voidReason)
                      setMessage(result.error ?? result.message ?? null)
                      if (result.ok) setShowVoid(false)
                    })}>
                    Confirm void
                  </button>
                  <button type="button" className="ops-btn ops-btn-sm" onClick={() => setShowVoid(false)}>
                    Cancel
                  </button>
                </div>
                <p className="ops-hint">The invoice stays on the record marked void; it is never deleted.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

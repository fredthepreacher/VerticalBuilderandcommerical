/**
 * ============================================================================
 * FINANCIAL MATH — pure, deterministic, unit-tested
 * ----------------------------------------------------------------------------
 * Every number a customer sees on an estimate or an invoice, and every profit
 * figure the owner makes decisions on, comes out of this file.
 *
 * Two rules hold throughout:
 *
 *   1. Money is ALWAYS integer cents. Quantities may be decimal (2.5 squares of
 *      roof is a real thing), so `quantity × unitPriceCents` produces a
 *      fractional cent — which is rounded exactly once, at the line level, and
 *      never again. Rounding each line before summing is what keeps the printed
 *      line totals adding up to the printed subtotal.
 *
 *   2. Nothing here touches a database, a clock, or a request. That is what
 *      makes an estimate reproducible and a margin auditable.
 * ============================================================================
 */

export interface LineInput {
  quantity: number
  unitPriceCents: number
}

/**
 * One line total. Rounds half away from zero so 0.5¢ becomes 1¢ rather than
 * JavaScript's banker-ish `Math.round(-0.5) === -0` surprise on credits.
 */
export function lineTotalCents(line: LineInput): number {
  const quantity = Number.isFinite(line.quantity) ? line.quantity : 0
  const unit = Number.isFinite(line.unitPriceCents) ? Math.round(line.unitPriceCents) : 0
  const raw = quantity * unit
  return raw < 0 ? -Math.round(Math.abs(raw)) : Math.round(raw)
}

export interface TotalsInput {
  lines: LineInput[]
  discountCents?: number
  /** Percent, e.g. 7 for 7%. Applied to (subtotal − discount). */
  taxPercent?: number
  taxEnabled?: boolean
}

export interface Totals {
  subtotalCents: number
  discountCents: number
  taxableCents: number
  taxCents: number
  totalCents: number
}

/**
 * Estimate / invoice totals.
 *
 * Discount is applied before tax, which is the normal contractor convention and
 * the one Florida sales tax follows. A discount larger than the subtotal is
 * clamped rather than producing a negative invoice — that is almost always a
 * typo, and a negative total would flow into payment logic.
 */
export function calculateTotals(input: TotalsInput): Totals {
  const subtotalCents = input.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)

  const requestedDiscount = Math.max(0, Math.round(input.discountCents ?? 0))
  const discountCents = Math.min(requestedDiscount, Math.max(0, subtotalCents))

  const taxableCents = Math.max(0, subtotalCents - discountCents)

  const percent = input.taxEnabled === false ? 0 : (input.taxPercent ?? 0)
  const taxCents =
    percent > 0 && Number.isFinite(percent)
      ? Math.round((taxableCents * percent) / 100)
      : 0

  return {
    subtotalCents,
    discountCents,
    taxableCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  }
}

// ---------------------------------------------------------------------------
// Invoice payment application
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void'

export interface PaymentInput {
  amountCents: number
  refundedAmountCents?: number
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'void'
}

export interface InvoiceBalance {
  amountPaidCents: number
  balanceDueCents: number
  status: InvoiceStatus
  /** Positive when the customer has paid more than the invoice total. */
  overpaidCents: number
  isOverpaid: boolean
}

/**
 * Recomputes an invoice's paid amount and status from its payments.
 *
 * Deliberately a full recomputation rather than an increment: a refund, a
 * voided payment, or a corrected amount can then never leave the balance
 * wrong. Mirrors `recalculate_invoice_totals()` in migration 0005 — the
 * database is authoritative, this is the same rule available to the UI and to
 * tests without a round trip.
 *
 * Overpayment is surfaced, never silently clamped. The office needs to see it
 * to issue a refund.
 */
export function applyPayments(
  invoice: { totalCents: number; status: InvoiceStatus; dueDate?: string | null },
  payments: PaymentInput[],
  today: Date = new Date(),
): InvoiceBalance {
  const amountPaidCents = payments
    .filter(p => p.status === 'succeeded')
    .reduce((sum, p) => sum + Math.round(p.amountCents) - Math.round(p.refundedAmountCents ?? 0), 0)

  const balanceDueCents = invoice.totalCents - amountPaidCents
  const overpaidCents = Math.max(0, -balanceDueCents)

  // A void or draft invoice keeps its status regardless of payment activity.
  if (invoice.status === 'void' || invoice.status === 'draft') {
    return {
      amountPaidCents,
      balanceDueCents,
      status: invoice.status,
      overpaidCents,
      isOverpaid: overpaidCents > 0,
    }
  }

  let status: InvoiceStatus
  if (invoice.totalCents > 0 && amountPaidCents >= invoice.totalCents) {
    status = 'paid'
  } else if (amountPaidCents > 0) {
    status = 'partially_paid'
  } else if (invoice.dueDate && isPast(invoice.dueDate, today)) {
    status = 'overdue'
  } else {
    status = 'sent'
  }

  return { amountPaidCents, balanceDueCents, status, overpaidCents, isOverpaid: overpaidCents > 0 }
}

function isPast(dueDate: string, today: Date): boolean {
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00Z`)
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return due.getTime() < now.getTime()
}

/**
 * Guard for recording a payment. Overpayment is *allowed* (customers round up,
 * pay two invoices with one check, or leave a deposit) but the caller must
 * acknowledge it, so it can never happen by a slipped decimal point.
 */
export function validatePaymentAmount(
  amountCents: number,
  balanceDueCents: number,
  allowOverpayment: boolean,
): { ok: boolean; error?: string; wouldOverpayBy?: number } {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'Enter a payment amount greater than zero.' }
  }
  if (amountCents > balanceDueCents) {
    const over = amountCents - balanceDueCents
    if (!allowOverpayment) {
      return {
        ok: false,
        wouldOverpayBy: over,
        error: `That is ${formatCentsPlain(over)} more than the ${formatCentsPlain(balanceDueCents)} balance. Tick “allow overpayment” if that is intended.`,
      }
    }
    return { ok: true, wouldOverpayBy: over }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Job profitability
// ---------------------------------------------------------------------------

export interface ProfitabilityInput {
  /** Revenue basis. Null or zero means margin cannot be computed. */
  contractAmountCents: number | null | undefined
  costs: { amountCents: number; category?: string }[]
  invoicedCents?: number
  paidCents?: number
}

export interface Profitability {
  contractAmountCents: number | null
  totalCostCents: number
  grossProfitCents: number | null
  /** Percentage to one decimal, or null when there is no contract amount. */
  grossMarginPercent: number | null
  invoicedCents: number
  paidCents: number
  outstandingCents: number
  costsByCategory: Record<string, number>
  /** Set when margin could not be calculated, for the UI to explain why. */
  unavailableReason?: string
}

/**
 *   Gross profit = contract amount − total job cost
 *   Gross margin = gross profit / contract amount × 100
 *
 * When there is no contract amount there is no denominator, so this returns
 * null rather than zero or Infinity. The UI shows an em dash and says a
 * contract amount is required — a fake 0% would read as "this job loses money".
 *
 * This is JOB GROSS PROFIT, not net profit: it excludes overhead, tax,
 * financing and every accounting adjustment. Labelled that way everywhere.
 */
export function calculateProfitability(input: ProfitabilityInput): Profitability {
  const totalCostCents = input.costs.reduce((sum, c) => sum + Math.round(c.amountCents), 0)

  const costsByCategory: Record<string, number> = {}
  for (const cost of input.costs) {
    const key = cost.category ?? 'other'
    costsByCategory[key] = (costsByCategory[key] ?? 0) + Math.round(cost.amountCents)
  }

  const invoicedCents = Math.round(input.invoicedCents ?? 0)
  const paidCents = Math.round(input.paidCents ?? 0)
  const outstandingCents = invoicedCents - paidCents

  const contract = input.contractAmountCents
  if (contract === null || contract === undefined || contract === 0) {
    return {
      contractAmountCents: contract ?? null,
      totalCostCents,
      grossProfitCents: null,
      grossMarginPercent: null,
      invoicedCents,
      paidCents,
      outstandingCents,
      costsByCategory,
      unavailableReason:
        'Gross profit needs a contract amount on the job. Add one on the Overview tab.',
    }
  }

  const contractAmountCents = Math.round(contract)
  const grossProfitCents = contractAmountCents - totalCostCents
  const grossMarginPercent = Math.round((grossProfitCents / contractAmountCents) * 1000) / 10

  return {
    contractAmountCents,
    totalCostCents,
    grossProfitCents,
    grossMarginPercent,
    invoicedCents,
    paidCents,
    outstandingCents,
    costsByCategory,
  }
}

export const PROFIT_DISCLAIMER =
  'Gross profit is the contract amount less costs entered in Vertical Ops. It does not ' +
  'include company overhead, tax, financing, or accounting adjustments, and it is not ' +
  'a substitute for your accountant’s figures.'

// ---------------------------------------------------------------------------
// Small formatter used inside error messages above (UI uses utils/money.ts)
// ---------------------------------------------------------------------------
function formatCentsPlain(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  })
}

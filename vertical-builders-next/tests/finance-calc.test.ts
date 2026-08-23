import { describe, expect, it } from 'vitest'
import {
  applyPayments, calculateProfitability, calculateTotals, lineTotalCents,
  validatePaymentAmount, PROFIT_DISCLAIMER,
} from '../lib/ops/finance/calc'

describe('lineTotalCents', () => {
  it('multiplies a whole quantity exactly', () => {
    expect(lineTotalCents({ quantity: 3, unitPriceCents: 12_500 })).toBe(37_500)
  })

  it('rounds a fractional quantity exactly once, at the line', () => {
    // 2.5 squares × $412.33 = $1030.825 → 103082.5¢ → 103083¢
    expect(lineTotalCents({ quantity: 2.5, unitPriceCents: 41_233 })).toBe(103_083)
  })

  it('rounds half away from zero on credits rather than to -0', () => {
    expect(lineTotalCents({ quantity: 0.5, unitPriceCents: -1 })).toBe(-1)
    expect(Object.is(lineTotalCents({ quantity: 0.5, unitPriceCents: -1 }), -0)).toBe(false)
  })

  it('treats a non-finite quantity or price as zero rather than producing NaN', () => {
    expect(lineTotalCents({ quantity: Number.NaN, unitPriceCents: 1000 })).toBe(0)
    expect(lineTotalCents({ quantity: 2, unitPriceCents: Number.POSITIVE_INFINITY })).toBe(0)
  })
})

describe('calculateTotals', () => {
  const lines = [
    { quantity: 10, unitPriceCents: 45_000 },   // $4,500.00
    { quantity: 2.5, unitPriceCents: 12_000 },  // $300.00
  ]

  it('sums rounded line totals, so the printed lines add up to the printed subtotal', () => {
    const totals = calculateTotals({ lines })
    expect(totals.subtotalCents).toBe(480_000)
    expect(totals.subtotalCents).toBe(lines.reduce((s, l) => s + lineTotalCents(l), 0))
  })

  it('applies the discount before tax', () => {
    const totals = calculateTotals({ lines, discountCents: 80_000, taxPercent: 7, taxEnabled: true })
    expect(totals.discountCents).toBe(80_000)
    expect(totals.taxableCents).toBe(400_000)
    expect(totals.taxCents).toBe(28_000)
    expect(totals.totalCents).toBe(428_000)
  })

  it('clamps a discount larger than the subtotal instead of going negative', () => {
    const totals = calculateTotals({ lines, discountCents: 900_000 })
    expect(totals.discountCents).toBe(480_000)
    expect(totals.taxableCents).toBe(0)
    expect(totals.totalCents).toBe(0)
  })

  it('ignores a negative discount', () => {
    expect(calculateTotals({ lines, discountCents: -5_000 }).discountCents).toBe(0)
  })

  it('charges no tax when tax is switched off, even with a rate set', () => {
    expect(calculateTotals({ lines, taxPercent: 7, taxEnabled: false }).taxCents).toBe(0)
  })

  it('produces zeroes for an empty estimate rather than NaN', () => {
    const totals = calculateTotals({ lines: [], taxPercent: 7, taxEnabled: true })
    expect(totals).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 0 })
  })
})

describe('applyPayments', () => {
  const invoice = { totalCents: 100_000, status: 'sent' as const, dueDate: '2026-01-31' }
  const today = new Date('2026-01-15T12:00:00Z')

  it('counts only succeeded payments', () => {
    const balance = applyPayments(invoice, [
      { amountCents: 40_000, status: 'succeeded' },
      { amountCents: 30_000, status: 'pending' },
      { amountCents: 20_000, status: 'failed' },
      { amountCents: 10_000, status: 'void' },
    ], today)
    expect(balance.amountPaidCents).toBe(40_000)
    expect(balance.balanceDueCents).toBe(60_000)
    expect(balance.status).toBe('partially_paid')
  })

  it('subtracts refunded amounts from a succeeded payment', () => {
    const balance = applyPayments(invoice, [
      { amountCents: 100_000, refundedAmountCents: 25_000, status: 'succeeded' },
    ], today)
    expect(balance.amountPaidCents).toBe(75_000)
    expect(balance.status).toBe('partially_paid')
  })

  it('marks the invoice paid when the balance reaches zero', () => {
    const balance = applyPayments(invoice, [{ amountCents: 100_000, status: 'succeeded' }], today)
    expect(balance.status).toBe('paid')
    expect(balance.balanceDueCents).toBe(0)
    expect(balance.isOverpaid).toBe(false)
  })

  it('surfaces an overpayment instead of clamping it', () => {
    const balance = applyPayments(invoice, [{ amountCents: 125_000, status: 'succeeded' }], today)
    expect(balance.status).toBe('paid')
    expect(balance.balanceDueCents).toBe(-25_000)
    expect(balance.overpaidCents).toBe(25_000)
    expect(balance.isOverpaid).toBe(true)
  })

  it('recomputes from scratch, so removing a payment restores the balance', () => {
    const withPayment = applyPayments(invoice, [{ amountCents: 60_000, status: 'succeeded' }], today)
    const withoutPayment = applyPayments(invoice, [], today)
    expect(withPayment.balanceDueCents).toBe(40_000)
    expect(withoutPayment.balanceDueCents).toBe(100_000)
    expect(withoutPayment.status).toBe('sent')
  })

  it('reports overdue only once the due date has passed and nothing is paid', () => {
    const late = new Date('2026-02-05T12:00:00Z')
    expect(applyPayments(invoice, [], late).status).toBe('overdue')
    // A part payment is more informative than "overdue" on the badge.
    expect(applyPayments(invoice, [{ amountCents: 1_000, status: 'succeeded' }], late).status)
      .toBe('partially_paid')
  })

  it('never changes the status of a void or draft invoice', () => {
    const paid = [{ amountCents: 100_000, status: 'succeeded' as const }]
    expect(applyPayments({ ...invoice, status: 'void' }, paid, today).status).toBe('void')
    expect(applyPayments({ ...invoice, status: 'draft' }, paid, today).status).toBe('draft')
  })

  it('does not mark a zero-total invoice paid on no payments', () => {
    const balance = applyPayments({ totalCents: 0, status: 'sent', dueDate: null }, [], today)
    expect(balance.status).toBe('sent')
  })
})

describe('validatePaymentAmount', () => {
  it('rejects zero, negative and non-finite amounts', () => {
    expect(validatePaymentAmount(0, 10_000, false).ok).toBe(false)
    expect(validatePaymentAmount(-500, 10_000, false).ok).toBe(false)
    expect(validatePaymentAmount(Number.NaN, 10_000, false).ok).toBe(false)
  })

  it('accepts an exact payment', () => {
    expect(validatePaymentAmount(10_000, 10_000, false)).toEqual({ ok: true })
  })

  it('refuses a slipped decimal point unless overpayment is acknowledged', () => {
    const result = validatePaymentAmount(100_000, 10_000, false)
    expect(result.ok).toBe(false)
    expect(result.wouldOverpayBy).toBe(90_000)
    expect(result.error).toContain('900.00')
  })

  it('allows a deliberate overpayment and reports the excess', () => {
    expect(validatePaymentAmount(12_000, 10_000, true)).toEqual({ ok: true, wouldOverpayBy: 2_000 })
  })
})

describe('calculateProfitability', () => {
  const costs = [
    { amountCents: 200_000, category: 'materials' },
    { amountCents: 150_000, category: 'labor' },
    { amountCents: 50_000, category: 'materials' },
    { amountCents: 25_000 },
  ]

  it('computes gross profit and margin to one decimal', () => {
    const result = calculateProfitability({
      contractAmountCents: 1_000_000, costs, invoicedCents: 600_000, paidCents: 400_000,
    })
    expect(result.totalCostCents).toBe(425_000)
    expect(result.grossProfitCents).toBe(575_000)
    expect(result.grossMarginPercent).toBe(57.5)
    expect(result.outstandingCents).toBe(200_000)
  })

  it('groups costs by category and files an uncategorised cost under other', () => {
    const result = calculateProfitability({ contractAmountCents: 1_000_000, costs })
    expect(result.costsByCategory).toEqual({ materials: 250_000, labor: 150_000, other: 25_000 })
  })

  it('returns nulls and a reason rather than 0% when there is no contract amount', () => {
    for (const contract of [null, undefined, 0]) {
      const result = calculateProfitability({ contractAmountCents: contract, costs })
      expect(result.grossProfitCents).toBeNull()
      expect(result.grossMarginPercent).toBeNull()
      expect(result.unavailableReason).toBeTruthy()
      // Costs are still reported — they are known even when the margin is not.
      expect(result.totalCostCents).toBe(425_000)
    }
  })

  it('reports a negative margin honestly on a job that lost money', () => {
    const result = calculateProfitability({
      contractAmountCents: 300_000,
      costs: [{ amountCents: 450_000, category: 'subcontractor' }],
    })
    expect(result.grossProfitCents).toBe(-150_000)
    expect(result.grossMarginPercent).toBe(-50)
  })

  it('ships a disclaimer that names what is excluded', () => {
    expect(PROFIT_DISCLAIMER).toMatch(/overhead/i)
    expect(PROFIT_DISCLAIMER).toMatch(/accountant/i)
  })
})

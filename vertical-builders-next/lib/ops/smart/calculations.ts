import type { CalculationRequest, CalculationResult } from './types'

/**
 * ============================================================================
 * SMART CALCULATOR — deterministic, no expression evaluation
 * ----------------------------------------------------------------------------
 * There is no `eval`, no `new Function`, and no expression parser. The router
 * recognises a fixed set of shapes and hands this module two numbers and a
 * kind. That is a real constraint — "(1800 * 1.2) - 150" is not supported —
 * and it is the right trade for a calculator that sits behind a text box in a
 * business system.
 *
 * Every result shows its formula, because a number with no working shown is
 * something the user has to take on trust, and the whole point of Smart Ops is
 * that they do not have to.
 * ============================================================================
 */

/** Above this, the user has almost certainly mistyped. Contractor money, not astronomy. */
export const MAX_MAGNITUDE = 1_000_000_000_000

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const plain = (n: number) => {
  const rounded = Math.round(n * 10_000) / 10_000
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

const pct = (n: number) => `${Math.round(n * 100) / 100}%`

const fail = (expression: string, error: string): CalculationResult =>
  ({ ok: false, expression, formula: '', value: '—', error })

/**
 * Parses a number out of a matched fragment: strips $ and thousands commas.
 * Returns null rather than NaN so callers must handle the miss.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return n
}

export function calculate(request: CalculationRequest): CalculationResult {
  const { kind, a, b, operator } = request

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return fail('—', 'That does not look like a number I can work with.')
  }
  if (Math.abs(a) > MAX_MAGNITUDE || Math.abs(b) > MAX_MAGNITUDE) {
    return fail('—', 'Those numbers are larger than this calculator will handle.')
  }

  switch (kind) {
    case 'arithmetic': {
      const op = operator ?? '+'
      if (op === '/' && b === 0) {
        return fail(`${plain(a)} ÷ 0`, 'Division by zero has no answer.')
      }
      const value = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      const symbol = op === '*' ? '×' : op === '/' ? '÷' : op
      return {
        ok: true,
        expression: `${plain(a)} ${symbol} ${plain(b)}`,
        formula: `${plain(a)} ${symbol} ${plain(b)}`,
        value: plain(value),
        raw: value,
      }
    }

    // a% of b
    case 'percent_of': {
      const value = (a / 100) * b
      return {
        ok: true,
        expression: `${pct(a)} of ${money(b)}`,
        formula: `${plain(b)} × ${plain(a / 100)}`,
        value: money(value),
        raw: value,
      }
    }

    // add a% to b
    case 'percent_add': {
      const increase = (a / 100) * b
      const value = b + increase
      return {
        ok: true,
        expression: `${money(b)} plus ${pct(a)}`,
        formula: `${plain(b)} × (1 + ${plain(a / 100)})`,
        value: money(value),
        raw: value,
        detail: [{ label: 'Increase', value: money(increase) }],
      }
    }

    // subtract a% from b
    case 'percent_subtract': {
      const decrease = (a / 100) * b
      const value = b - decrease
      return {
        ok: true,
        expression: `${money(b)} minus ${pct(a)}`,
        formula: `${plain(b)} × (1 − ${plain(a / 100)})`,
        value: money(value),
        raw: value,
        detail: [{ label: 'Reduction', value: money(decrease) }],
      }
    }

    // a% markup on cost b — the sell price
    case 'markup': {
      const marginDollars = (a / 100) * b
      const value = b + marginDollars
      const marginPercent = value === 0 ? 0 : (marginDollars / value) * 100
      return {
        ok: true,
        expression: `${pct(a)} markup on ${money(b)}`,
        formula: `sell price = cost × (1 + markup%) = ${plain(b)} × ${plain(1 + a / 100)}`,
        value: money(value),
        raw: value,
        detail: [
          { label: 'Cost', value: money(b) },
          { label: 'Added', value: money(marginDollars) },
          { label: 'Resulting gross margin', value: pct(marginPercent) },
        ],
      }
    }

    // revenue a, cost b
    case 'gross_profit': {
      const value = a - b
      return {
        ok: true,
        expression: `Gross profit on ${money(a)} revenue and ${money(b)} cost`,
        formula: 'profit = revenue − cost',
        value: money(value),
        raw: value,
        detail: [
          { label: 'Revenue', value: money(a) },
          { label: 'Cost', value: money(b) },
        ],
      }
    }

    // revenue a, cost b
    case 'gross_margin': {
      if (a === 0) {
        return fail(
          `Gross margin on ${money(a)} revenue and ${money(b)} cost`,
          'Margin cannot be calculated against zero revenue.',
        )
      }
      const profit = a - b
      const value = (profit / a) * 100
      return {
        ok: true,
        expression: `Gross margin on ${money(a)} revenue and ${money(b)} cost`,
        formula: 'margin = (revenue − cost) ÷ revenue × 100',
        value: pct(value),
        raw: value,
        detail: [
          { label: 'Gross profit', value: money(profit) },
          { label: 'Revenue', value: money(a) },
        ],
      }
    }

    // price a, cost b
    case 'markup_percent': {
      if (b === 0) {
        return fail(
          `Markup on ${money(b)} cost sold at ${money(a)}`,
          'Markup cannot be calculated against zero cost.',
        )
      }
      const profit = a - b
      const value = (profit / b) * 100
      const margin = a === 0 ? 0 : (profit / a) * 100
      return {
        ok: true,
        expression: `Markup on ${money(b)} cost sold at ${money(a)}`,
        formula: 'markup = (price − cost) ÷ cost × 100',
        value: pct(value),
        raw: value,
        detail: [
          { label: 'Gross profit', value: money(profit) },
          { label: 'Gross margin', value: pct(margin) },
        ],
      }
    }

    default:
      return fail('—', 'That calculation is not supported.')
  }
}

/**
 * Markup and margin are the two numbers people most often mix up, and getting
 * them the wrong way round on a bid is expensive. Exposed separately so the
 * template and the job-profit answer can reuse the same arithmetic.
 */
export function marginFromMarkup(markupPercent: number): number {
  const multiplier = 1 + markupPercent / 100
  if (multiplier === 0) return 0
  return ((multiplier - 1) / multiplier) * 100
}

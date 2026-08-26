import { describe, expect, it } from 'vitest'
import { calculate, marginFromMarkup, parseAmount, MAX_MAGNITUDE } from '../lib/ops/smart/calculations'
import { parseIntent } from '../lib/ops/smart/intents'

/**
 * ============================================================================
 * THE SMART CALCULATOR
 * ----------------------------------------------------------------------------
 * Two layers: the parser turning a phrase into a typed request, and the
 * arithmetic itself. Both are tested, because the interesting failure is a
 * phrase that parses into the *wrong shape* and then computes it perfectly.
 *
 * Markup versus margin is the one that costs real money if it is wrong, so it
 * gets the most attention here.
 * ============================================================================
 */

/** Parses the phrase the way the assistant would, then runs it. */
const ask = (phrase: string) => {
  const match = parseIntent(phrase)
  expect(match?.intent, `"${phrase}" did not parse as a calculation`).toBe('calculation')
  return calculate(match!.args.calculation!)
}

describe('parseAmount', () => {
  it('strips currency formatting', () => {
    expect(parseAmount('$2,500.00')).toBe(2500)
    expect(parseAmount('1800')).toBe(1800)
    expect(parseAmount('0.5')).toBe(0.5)
  })

  it('returns null rather than NaN for anything else', () => {
    for (const bad of ['', 'one thousand', 'abc', '1.2.3', '$']) {
      expect(parseAmount(bad)).toBeNull()
    }
  })
})

describe('percentages', () => {
  it('answers "What is 15% of 2500?"', () => {
    const result = ask('What is 15% of 2500?')
    expect(result.ok).toBe(true)
    expect(result.raw).toBe(375)
    expect(result.value).toBe('$375.00')
    expect(result.formula).toContain('0.15')
  })

  it('handles a formatted amount', () => {
    expect(ask('what is 15% of $2,500.00').raw).toBe(375)
  })

  it('answers "Add a 20% markup to 1800"', () => {
    const result = ask('Add a 20% markup to 1800')
    expect(result.raw).toBe(2160)
    expect(result.formula).toContain('cost × (1 + markup%)')
  })

  it('answers "add 20% to 1800" as a plain increase', () => {
    const result = ask('add 20% to 1800')
    expect(result.raw).toBe(2160)
    expect(result.detail?.[0]).toEqual({ label: 'Increase', value: '$360.00' })
  })

  it('answers "1800 plus 20%" the same way round', () => {
    expect(ask('1800 plus 20%').raw).toBe(2160)
  })

  it('answers "subtract 10% from 5000"', () => {
    const result = ask('subtract 10% from 5000')
    expect(result.raw).toBe(4500)
    expect(result.detail?.[0]).toEqual({ label: 'Reduction', value: '$500.00' })
  })

  it('understands "take 10% off 5000"', () => {
    expect(ask('take 10% off 5000').raw).toBe(4500)
  })
})

describe('markup versus margin — the expensive mix-up', () => {
  it('a 20% markup on 1800 sells at 2160 and yields a 16.67% margin, not 20%', () => {
    const result = ask('20% markup on 1800')
    expect(result.raw).toBe(2160)
    const margin = result.detail?.find(d => d.label === 'Resulting gross margin')
    expect(margin?.value).toBe('16.67%')
  })

  it('marginFromMarkup agrees', () => {
    expect(Math.round(marginFromMarkup(20) * 100) / 100).toBe(16.67)
    expect(marginFromMarkup(0)).toBe(0)
    expect(Math.round(marginFromMarkup(100))).toBe(50)
  })

  it('markup percentage on 3000 cost sold at 4000 is 33.33%, and margin is 25%', () => {
    const result = ask('markup percentage if cost is 3000 and price is 4000')
    expect(result.value).toBe('33.33%')
    expect(result.detail?.find(d => d.label === 'Gross margin')?.value).toBe('25%')
  })

  it('reads the same question with price stated first', () => {
    const result = ask('markup if price is 4000 and cost is 3000')
    expect(result.value).toBe('33.33%')
  })
})

describe('profit and margin', () => {
  it('answers "profit on 4000 revenue and 3000 cost"', () => {
    const result = ask('what is the profit on 4000 revenue and 3000 cost')
    expect(result.raw).toBe(1000)
    expect(result.formula).toBe('profit = revenue − cost')
  })

  it('answers "margin on 4000 revenue and 3000 cost"', () => {
    const result = ask('what margin is 4000 revenue on 3000 cost')
    expect(result.value).toBe('25%')
    expect(result.detail?.[0]).toEqual({ label: 'Gross profit', value: '$1,000.00' })
  })

  it('reports a negative profit rather than hiding it', () => {
    const result = calculate({ kind: 'gross_profit', a: 3_000, b: 4_000 })
    expect(result.raw).toBe(-1_000)
    expect(result.value).toBe('$-1,000.00')
  })
})

describe('plain arithmetic', () => {
  it('handles one operator', () => {
    expect(calculate({ kind: 'arithmetic', a: 1_200, b: 340, operator: '+' }).raw).toBe(1_540)
    expect(calculate({ kind: 'arithmetic', a: 1_200, b: 340, operator: '-' }).raw).toBe(860)
    expect(calculate({ kind: 'arithmetic', a: 12, b: 4, operator: '*' }).raw).toBe(48)
    expect(calculate({ kind: 'arithmetic', a: 12, b: 4, operator: '/' }).raw).toBe(3)
  })

  it('parses a typed expression', () => {
    expect(ask('2500 * 0.15').raw).toBe(375)
    expect(ask('what is 1200 + 340').raw).toBe(1_540)
  })
})

describe('the cases that must fail cleanly', () => {
  it('refuses division by zero with an explanation, not NaN or Infinity', () => {
    const result = calculate({ kind: 'arithmetic', a: 100, b: 0, operator: '/' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no answer/i)
    expect(result.value).toBe('—')
  })

  it('refuses margin against zero revenue', () => {
    const result = calculate({ kind: 'gross_margin', a: 0, b: 500 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/zero revenue/i)
  })

  it('refuses markup against zero cost', () => {
    const result = calculate({ kind: 'markup_percent', a: 500, b: 0 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/zero cost/i)
  })

  it('refuses absurd magnitudes rather than rendering nonsense', () => {
    const result = calculate({ kind: 'percent_of', a: 15, b: MAX_MAGNITUDE * 10 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/larger than this calculator/i)
  })

  it('never returns NaN or Infinity for any input', () => {
    const kinds = [
      'arithmetic', 'percent_of', 'percent_add', 'percent_subtract',
      'markup', 'gross_profit', 'gross_margin', 'markup_percent',
    ] as const
    for (const kind of kinds) {
      for (const [a, b] of [[0, 0], [Number.NaN, 1], [1, Number.POSITIVE_INFINITY], [-5, -5]]) {
        const result = calculate({ kind, a, b, operator: '/' })
        expect(Number.isNaN(result.raw ?? 0), `${kind} produced NaN`).toBe(false)
        expect(Number.isFinite(result.raw ?? 0), `${kind} produced Infinity`).toBe(true)
        expect(result.value).not.toContain('NaN')
        expect(result.value).not.toContain('Infinity')
      }
    }
  })
})

describe('there is no expression evaluation anywhere', () => {
  it('the module contains no eval, Function or dynamic execution', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    // Comments are stripped first: these files document the rule in their own
    // prose, and a comment naming the thing is the opposite of a violation.
    const code = readFileSync(join(process.cwd(), 'lib/ops/smart/calculations.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/\beval\s*\(/)
    expect(code).not.toMatch(/new\s+Function/)
    expect(code).not.toMatch(/setTimeout\s*\(\s*['"`]/)
  })

  it('a nested expression is not silently mis-evaluated — it simply does not parse', () => {
    // Honest limitation: one operator only. Better to decline than to guess at
    // precedence and hand back a confidently wrong figure.
    expect(parseIntent('(1800 * 1.2) - 150')?.intent).not.toBe('calculation')
  })
})

describe('every result shows its working', () => {
  it('exposes a formula the user can check by hand', () => {
    for (const phrase of [
      'what is 15% of 2500', 'add 20% to 1800', 'subtract 10% from 5000',
      '20% markup on 1800', 'profit on 4000 revenue and 3000 cost',
      'margin on 4000 revenue and 3000 cost',
    ]) {
      const result = ask(phrase)
      expect(result.ok, phrase).toBe(true)
      expect(result.formula.length, `${phrase} has no formula`).toBeGreaterThan(0)
      expect(result.expression.length).toBeGreaterThan(0)
    }
  })
})

import { parseAmount } from './calculations'
import type { CalculationRequest, SmartOpsMatch } from './types'

/**
 * ============================================================================
 * SMART OPS INTENT PARSER — bounded, honest, no model
 * ----------------------------------------------------------------------------
 * This recognises a defined set of operational phrasings. It does not
 * understand English, and it does not pretend to: an unrecognised request
 * returns null, and the caller then either hands it to the generative Copilot
 * (if AI Enhanced is activated) or shows the built-in help.
 *
 * The temptation with a rule parser is to widen the patterns until *something*
 * always matches. That is the failure mode to avoid — a confident wrong answer
 * about insurance expiry is worse than "I don't handle that one". Every rule
 * here requires a distinctive keyword, and ordering puts the most specific
 * families first.
 * ============================================================================
 */

export const MAX_WINDOW_DAYS = 365
export const DEFAULT_EXPIRY_WINDOW_DAYS = 45

/** Lowercase, collapse whitespace, drop punctuation the rules never need. */
export function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’']/g, '')
    // Commas are kept: "$2,500.00" must survive to reach the amount parser.
    .replace(/[^a-z0-9%$.,()\-+*/×÷\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const has = (text: string, ...words: string[]) => words.some(w => text.includes(w))

/** A day window if the phrase names one, clamped. */
export function extractWindowDays(text: string): number | undefined {
  const match = text.match(/(\d{1,5})\s*(?:calendar\s*)?(day|days|d)\b/)
  if (match) return clampDays(Number(match[1]))
  // "in the next 2 weeks" / "next 3 months"
  const weeks = text.match(/(\d{1,3})\s*(week|weeks)\b/)
  if (weeks) return clampDays(Number(weeks[1]) * 7)
  const months = text.match(/(\d{1,3})\s*(month|months)\b/)
  if (months) return clampDays(Number(months[1]) * 30)
  return undefined
}

export function clampDays(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_WINDOW_DAYS
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.round(n)))
}

// ---------------------------------------------------------------------------
// Calculator patterns
// ---------------------------------------------------------------------------

const NUM = String.raw`\$?\d[\d,]*\.?\d*`

/**
 * Ordered most-specific first. Each returns a typed request; none of them
 * evaluates a string.
 */
function matchCalculation(text: string): CalculationRequest | null {
  const num = (s: string | undefined) => (s === undefined ? null : parseAmount(s))

  // markup percentage if cost is 3000 and price is 4000
  let m = text.match(new RegExp(
    String.raw`markup.*?cost\s*(?:is|of|=)?\s*(${NUM}).*?(?:price|sells?|sold|sell price)\s*(?:is|of|at|=)?\s*(${NUM})`,
  ))
  if (m) {
    const cost = num(m[1]); const price = num(m[2])
    if (cost !== null && price !== null) return { kind: 'markup_percent', a: price, b: cost }
  }
  // markup percentage if price is 4000 and cost is 3000
  m = text.match(new RegExp(
    String.raw`markup.*?(?:price|sells?|sold)\s*(?:is|of|at|=)?\s*(${NUM}).*?cost\s*(?:is|of|=)?\s*(${NUM})`,
  ))
  if (m) {
    const price = num(m[1]); const cost = num(m[2])
    if (cost !== null && price !== null) return { kind: 'markup_percent', a: price, b: cost }
  }

  // 20% markup on 1800  /  add a 20% markup to 1800
  m = text.match(new RegExp(String.raw`(\d[\d.]*)\s*%?\s*markup\s*(?:on|to|for|of)\s*(${NUM})`))
  if (m) {
    const rate = num(m[1]); const cost = num(m[2])
    if (rate !== null && cost !== null) return { kind: 'markup', a: rate, b: cost }
  }
  // markup 1800 by 20%
  m = text.match(new RegExp(String.raw`markup\s*(${NUM})\s*(?:by|at)\s*(\d[\d.]*)\s*%`))
  if (m) {
    const cost = num(m[1]); const rate = num(m[2])
    if (rate !== null && cost !== null) return { kind: 'markup', a: rate, b: cost }
  }

  // margin on 4000 revenue and 3000 cost  (revenue/cost in either order)
  const marginWord = /\bmargin\b/.test(text)
  const profitWord = /\b(gross profit|profit)\b/.test(text)
  if (marginWord || profitWord) {
    const revenue = text.match(new RegExp(String.raw`(${NUM})\s*(?:in\s*)?(?:revenue|sales|price|contract)`))
      ?? text.match(new RegExp(String.raw`revenue\s*(?:is|of|=)?\s*(${NUM})`))
    const cost = text.match(new RegExp(String.raw`(${NUM})\s*(?:in\s*)?cost`))
      ?? text.match(new RegExp(String.raw`cost\s*(?:is|of|=)?\s*(${NUM})`))
    const r = num(revenue?.[1]); const c = num(cost?.[1])
    if (r !== null && c !== null) {
      return { kind: marginWord ? 'gross_margin' : 'gross_profit', a: r, b: c }
    }
  }

  // add 20% to 1800  —  rate first, base second
  m = text.match(new RegExp(String.raw`(?:add|increase|plus)\s*(?:a\s*)?(\d[\d.]*)\s*%\s*(?:to|onto|on)\s*(${NUM})`))
  if (m) {
    const rate = num(m[1]); const base = num(m[2])
    if (rate !== null && base !== null) return { kind: 'percent_add', a: rate, b: base }
  }
  // 1800 plus 20%  —  base first, rate second
  m = text.match(new RegExp(String.raw`(${NUM})\s*(?:plus|\+)\s*(\d[\d.]*)\s*%`))
  if (m) {
    const base = num(m[1]); const rate = num(m[2])
    if (rate !== null && base !== null) return { kind: 'percent_add', a: rate, b: base }
  }

  // subtract 10% from 5000  /  take 10% off 5000  /  5000 less 10%
  m = text.match(new RegExp(String.raw`(?:subtract|take|remove|less|minus|discount)\s*(?:a\s*)?(\d[\d.]*)\s*%\s*(?:from|off|of)\s*(${NUM})`))
  if (m) {
    const rate = num(m[1]); const base = num(m[2])
    if (rate !== null && base !== null) return { kind: 'percent_subtract', a: rate, b: base }
  }
  m = text.match(new RegExp(String.raw`(${NUM})\s*(?:less|minus)\s*(\d[\d.]*)\s*%`))
  if (m) {
    const base = num(m[1]); const rate = num(m[2])
    if (rate !== null && base !== null) return { kind: 'percent_subtract', a: rate, b: base }
  }

  // 15% of 2500
  m = text.match(new RegExp(String.raw`(\d[\d.]*)\s*%\s*of\s*(${NUM})`))
  if (m) {
    const rate = num(m[1]); const base = num(m[2])
    if (rate !== null && base !== null) return { kind: 'percent_of', a: rate, b: base }
  }

  // Plain two-operand arithmetic. One operator only, and the WHOLE remaining
  // phrase has to be that one operation.
  //
  // The strictness is the point. A looser, end-anchored match would read
  // "(1800 * 1.2) - 150" as "1.2 - 150" and return -148.8 with complete
  // confidence. Declining to answer is the better failure.
  const bare = text
    .replace(/^(?:what\s+is|whats|calculate|compute|work\s+out|how\s+much\s+is)\s+/, '')
    .replace(/[?\s]+$/, '')
    .trim()
  m = bare.match(new RegExp(String.raw`^(${NUM})\s*([-+*/×÷])\s*(${NUM})$`))
  if (m) {
    const a = num(m[1]); const b = num(m[3])
    const raw = m[2]
    const operator = raw === '×' ? '*' : raw === '÷' ? '/' : (raw as '+' | '-' | '*' | '/')
    if (a !== null && b !== null) return { kind: 'arithmetic', a, b, operator }
  }

  return null
}

// ---------------------------------------------------------------------------
// Template patterns
// ---------------------------------------------------------------------------

const TEMPLATE_RULES: { key: string; test: (t: string) => boolean }[] = [
  { key: 'coi_renewal', test: t => has(t, 'coi', 'certificate', 'insurance') && has(t, 'renewal', 'renew', 'expiring request') },
  { key: 'missing_document', test: t => has(t, 'missing document', 'missing paperwork request', 'document request', 'w9 request', 'request paperwork') },
  { key: 'lead_first_response', test: t => has(t, 'first response', 'new lead reply', 'initial response', 'respond to a new lead') },
  { key: 'lead_follow_up', test: t => has(t, 'follow up', 'follow-up', 'followup') },
  { key: 'inspection_confirmation', test: t => has(t, 'inspection', 'site visit', 'appointment confirm') },
  { key: 'unable_to_reach', test: t => has(t, 'unable to reach', 'cant reach', 'no answer', 'left a voicemail', 'voicemail') },
]

function matchTemplate(text: string): string | null {
  if (!has(text, 'template', 'draft', 'write', 'message', 'email', 'text', 'letter', 'wording')) return null
  for (const rule of TEMPLATE_RULES) if (rule.test(text)) return rule.key
  return null
}

// ---------------------------------------------------------------------------
// Job reference extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'my', 'our', 'this', 'that', 'job', 'jobs', 'project',
  'projects', 'please', 'now', 'today',
])

/**
 * Pulls a job reference out of "job cost for the Miller residence".
 * Returns undefined rather than guessing when nothing follows the preposition —
 * the caller then asks which job rather than picking one.
 */
export function extractProjectQuery(text: string): string | undefined {
  const m = text.match(/(?:for|on|of)\s+(.{2,60})$/)
  if (!m) return undefined
  const words = m[1].split(' ').filter(w => w && !STOP_WORDS.has(w))
  const query = words.join(' ').trim()
  return query.length >= 2 ? query.slice(0, 60) : undefined
}

// ---------------------------------------------------------------------------
// The router's rule table
// ---------------------------------------------------------------------------

interface Rule {
  intent: SmartOpsMatch['intent']
  test: (t: string) => boolean
}

/**
 * Order matters. Financial job questions come before the generic job rule, and
 * "expiring" beats "compliance" because "what insurance is expiring" is both.
 */
const RULES: Rule[] = [
  {
    intent: 'help',
    test: t => /^(help|commands|what can you do|what do you do|options|menu)\b/.test(t)
      || has(t, 'what can you help', 'what can i ask', 'list of commands'),
  },
  {
    intent: 'expiring_policies',
    test: t => has(t, 'expir', 'renewal date', 'lapsing', 'lapse')
      && has(t, 'insurance', 'policy', 'policies', 'coi', 'certificate', 'coverage', 'cois'),
  },
  {
    // "what expires in 30 days" with no noun still means coverage here — it is
    // the only thing in this product that expires on a clock.
    intent: 'expiring_policies',
    test: t => /^(what|whats|show|list)?\s*(is|are)?\s*expir/.test(t) || /\bexpiring soon\b/.test(t),
  },
  {
    intent: 'audit_readiness',
    test: t => has(t, 'audit'),
  },
  {
    intent: 'missing_vendor_documents',
    test: t => has(t, 'missing', 'incomplete', 'not compliant', 'non compliant', 'noncompliant', 'compliance problem', 'compliance issue')
      || (has(t, 'paperwork', 'documents', 'files', 'w9') && has(t, 'who', 'which', 'show', 'list')),
  },
  {
    intent: 'missing_vendor_documents',
    test: t => has(t, 'compliance') && has(t, 'show', 'list', 'problem', 'status', 'who'),
  },
  {
    intent: 'unpaid_invoices',
    test: t => has(t, 'invoice', 'receivable', 'outstanding', 'unpaid', 'overdue', 'owed', 'owes', 'owe us', 'ar '),
  },
  {
    intent: 'job_profit',
    test: t => has(t, 'profit', 'margin') && has(t, 'job', 'project', 'on ', 'for '),
  },
  {
    intent: 'job_cost',
    test: t => has(t, 'job cost', 'job costs', 'cost on', 'cost for', 'costs on', 'costs for', 'spent on'),
  },
  {
    intent: 'open_estimates',
    test: t => has(t, 'estimates', 'quotes', 'bids', 'proposals')
      || (has(t, 'estimate', 'quote', 'bid') && has(t, 'open', 'waiting', 'sent', 'pending', 'show', 'list', 'outstanding')),
  },
  {
    intent: 'leads_follow_up',
    test: t => has(t, 'leads')
      || /\b(new|open|stale|the)\s+lead\b/.test(t)
      || has(t, 'who should i call', 'who to call', 'call back', 'callback'),
  },
  {
    // Deliberately narrow. A bare singular "job" appears in all sorts of
    // questions this parser has no business answering — "why did the Henderson
    // job go over budget" is a question for the AI, not a list of active jobs.
    // A plural, or an explicit scheduling word, is the signal that someone is
    // asking for the list.
    intent: 'active_jobs',
    test: t => has(t, 'jobs', 'projects', 'schedule', 'scheduled', 'whats on this week', 'upcoming', 'starting')
      || /\b(active|open|current)\s+(job|project)\b/.test(t),
  },
  {
    intent: 'attention_summary',
    test: t => has(t,
      'attention', 'need to do', 'need to know', 'priorit', 'urgent', 'today',
      'whats going on', 'what is going on', 'brief me', 'my day', 'summary', 'overview',
      'catch me up', 'status',
    ),
  },
]

/**
 * The whole parser.
 *
 * Returns null for anything it does not confidently recognise. That null is
 * load-bearing: it is what routes a free-form question to the generative
 * Copilot instead of getting a wrong deterministic answer.
 */
export function parseIntent(input: string): SmartOpsMatch | null {
  const text = normalise(input)
  if (!text) return null

  // Calculations first. "What is 15% of 2500" contains no operational keyword,
  // but "add 20% markup to the Miller job" would otherwise be caught by the
  // job rules, and the calculator is the more specific reading.
  const calculation = matchCalculation(text)
  if (calculation) {
    return { intent: 'calculation', args: { calculation }, matched: text }
  }

  const templateKey = matchTemplate(text)
  if (templateKey) {
    return { intent: 'template', args: { templateKey }, matched: text }
  }

  for (const rule of RULES) {
    if (!rule.test(text)) continue
    const args: SmartOpsMatch['args'] = {}
    const windowDays = extractWindowDays(text)
    if (windowDays !== undefined) args.windowDays = windowDays
    if (rule.intent === 'job_cost' || rule.intent === 'job_profit') {
      const projectQuery = extractProjectQuery(text)
      if (projectQuery) args.projectQuery = projectQuery
    }
    return { intent: rule.intent, args, matched: text }
  }

  return null
}

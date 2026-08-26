/**
 * ============================================================================
 * SMART OPS — shared types
 * ----------------------------------------------------------------------------
 * Smart Ops is the deterministic half of the Vertical Assistant. It answers a
 * bounded set of operational questions using the CRM's own data, business rules
 * and calculations. No language model is involved and no external AI provider
 * is called, so it costs nothing per question and it works with no API key.
 *
 * It is NOT generative AI and must never be described as such. What it is
 * instead: a fast, honest command surface over data the signed-in user can
 * already see.
 * ============================================================================
 */

export type SmartOpsIntent =
  | 'attention_summary'
  | 'expiring_policies'
  | 'missing_vendor_documents'
  | 'audit_readiness'
  | 'leads_follow_up'
  | 'active_jobs'
  | 'open_estimates'
  | 'unpaid_invoices'
  | 'job_cost'
  | 'job_profit'
  | 'calculation'
  | 'template'
  | 'help'

/** Arguments the parser is allowed to extract. Deliberately tiny. */
export interface SmartOpsArgs {
  /** Clamped day window, when the phrase supplied one. */
  windowDays?: number
  /** A free-text job reference, e.g. "Miller residence". Used as a search term only. */
  projectQuery?: string
  /** Which template was asked for. */
  templateKey?: string
  /** The calculation the parser recognised. */
  calculation?: CalculationRequest
}

export interface SmartOpsMatch {
  intent: SmartOpsIntent
  args: SmartOpsArgs
  /**
   * The phrase that matched, kept for the "I read this as…" line. Never used to
   * build a query — every query argument is a separately extracted, typed value.
   */
  matched: string
}

export interface SmartFact {
  label: string
  value: string | number
  /** Draws attention in the UI without the parser choosing a colour. */
  tone?: 'neutral' | 'warn' | 'bad' | 'ok'
}

export interface SmartItem {
  id?: string
  title: string
  subtitle?: string
  /** Built by application code from a fixed route map. The parser never supplies one. */
  href?: string
  status?: string
}

export interface SmartAction {
  label: string
  href?: string
  /** A follow-up phrase the user can click to run. Must itself be a supported command. */
  command?: string
}

export interface SmartOpsResponse {
  mode: 'smart_ops'
  intent: SmartOpsIntent
  title: string
  summary: string
  facts?: SmartFact[]
  items?: SmartItem[]
  notices?: string[]
  suggestedActions?: SmartAction[]
  /** Copyable body, used by the template intent. */
  copyText?: string
}

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

export type CalculationKind =
  | 'arithmetic'
  | 'percent_of'
  | 'percent_add'
  | 'percent_subtract'
  | 'markup'
  | 'gross_profit'
  | 'gross_margin'
  | 'markup_percent'

export interface CalculationRequest {
  kind: CalculationKind
  /** Meaning depends on `kind`; see `lib/ops/smart/calculations.ts`. */
  a: number
  b: number
  operator?: '+' | '-' | '*' | '/'
}

export interface CalculationResult {
  ok: boolean
  /** e.g. "15% of $2,500.00" */
  expression: string
  /** e.g. "2500 × 0.15" — shown so the arithmetic is checkable. */
  formula: string
  /** Formatted for display. */
  value: string
  /** The raw number, for tests and for callers that want to format differently. */
  raw?: number
  /** Extra lines, e.g. profit alongside margin. */
  detail?: { label: string; value: string }[]
  error?: string
}

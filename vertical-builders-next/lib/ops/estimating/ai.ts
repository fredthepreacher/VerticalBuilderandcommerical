import 'server-only'
import type { PricebookItem } from '../types'

/**
 * ============================================================================
 * AI ESTIMATE DRAFTING
 * ----------------------------------------------------------------------------
 * The AI does three useful things: it turns a customer's description into a
 * structured scope, it maps that scope onto the company's own pricebook, and it
 * does the arithmetic of turning measurements into quantities.
 *
 * It is not allowed to do anything else. Specifically it must never:
 *   - price a line the company has not priced
 *   - invent roof measurements
 *   - invent permit or insurance requirements
 *   - send or approve anything
 *
 * The enforcement is not in the prompt — prompts are advisory. It is in
 * `sanitizeResult()` below, which drops any price the model tried to invent and
 * flags any line that is not backed by a pricebook item. A model that ignores
 * every instruction still cannot produce a sendable estimate.
 * ============================================================================
 */

export interface MeasurementSummary {
  roofAreaSquares?: number | null
  roofAreaSqft?: number | null
  primaryPitch?: string | null
  facetCount?: number | null
  ridgeLf?: number | null
  hipLf?: number | null
  valleyLf?: number | null
  eaveLf?: number | null
  rakeLf?: number | null
  wasteFactorPercent?: number | null
  provider?: string | null
}

export interface EstimateGenerationInput {
  serviceType: string
  property: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }
  customerRequest: string
  measurements?: MeasurementSummary | null
  pricebook: PricebookItem[]
  companyRules?: string[]
}

export interface GeneratedLine {
  pricebookItemId?: string
  description: string
  quantity: number
  unit: string
  /** Only ever set when it came from the pricebook. Never from the model. */
  suggestedUnitPriceCents?: number
  reasoningLabel?: string
  needsReview: boolean
}

export interface EstimateGenerationResult {
  scopeSummary: string
  lineItems: GeneratedLine[]
  assumptions: string[]
  warnings: string[]
  metadata: {
    provider: string
    model: string
    promptVersion: string
    generatedAt: string
    usedMeasurements: boolean
    pricebookItemsOffered: number
    linesNeedingReview: number
  }
}

export const PROMPT_VERSION = 'vbc-estimate-v1'

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

/**
 * Generates a draft. Throws AiUnavailableError when there is no key or the
 * provider fails — the caller keeps the estimate exactly as it was and shows a
 * message. A failed AI call must never damage work already entered.
 */
export async function generateEstimateDraft(
  input: EstimateGenerationInput,
): Promise<EstimateGenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new AiUnavailableError(
      'AI drafting is not configured. Set OPENAI_API_KEY, or build the estimate from the pricebook by hand.',
    )
  }

  const model = process.env.OPENAI_ESTIMATE_MODEL || 'gpt-4o-mini'
  const catalog = input.pricebook.filter(i => i.active).slice(0, 200)

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(input.companyRules ?? []) },
          { role: 'user', content: userPrompt(input, catalog) },
        ],
      }),
    })
  } catch (error) {
    console.error('[ai-estimate] transport error', error)
    throw new AiUnavailableError('Could not reach the AI service. Your estimate has not been changed.')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('[ai-estimate] provider error', response.status, detail.slice(0, 500))
    throw new AiUnavailableError(
      `The AI service returned an error (${response.status}). Your estimate has not been changed.`,
    )
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const raw = body.choices?.[0]?.message?.content
  if (!raw) {
    throw new AiUnavailableError('The AI service returned an empty response. Your estimate has not been changed.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('[ai-estimate] unparseable JSON', raw.slice(0, 500))
    throw new AiUnavailableError('The AI service returned something unusable. Your estimate has not been changed.')
  }

  return sanitizeResult(parsed, catalog, input, { provider: 'openai', model })
}

/**
 * The safety boundary. Everything the model returned passes through here.
 *
 * The critical rule: a unit price is taken from the PRICEBOOK, matched by id,
 * or it is not set at all. A price the model produced is discarded even if it
 * looks sensible — "looks sensible" is exactly how a wrong number gets quoted
 * to a customer.
 */
export function sanitizeResult(
  raw: unknown,
  pricebook: PricebookItem[],
  input: EstimateGenerationInput,
  provider: { provider: string; model: string },
): EstimateGenerationResult {
  const obj = (raw ?? {}) as Record<string, unknown>
  const byId = new Map(pricebook.map(i => [i.id, i]))
  const warnings: string[] = []

  const rawLines = Array.isArray(obj.lineItems) ? obj.lineItems : []
  const lineItems: GeneratedLine[] = []

  for (const entry of rawLines.slice(0, 60)) {
    const line = (entry ?? {}) as Record<string, unknown>

    const description = typeof line.description === 'string' ? line.description.trim().slice(0, 500) : ''
    if (!description) continue

    const quantityRaw = Number(line.quantity)
    const quantity = Number.isFinite(quantityRaw) && quantityRaw >= 0
      ? Math.round(quantityRaw * 100) / 100
      : 1
    if (!Number.isFinite(quantityRaw)) {
      warnings.push(`"${description.slice(0, 60)}" had no usable quantity — defaulted to 1.`)
    }

    const pricebookItemId =
      typeof line.pricebookItemId === 'string' && byId.has(line.pricebookItemId)
        ? line.pricebookItemId
        : undefined

    if (typeof line.pricebookItemId === 'string' && !pricebookItemId) {
      warnings.push(`"${description.slice(0, 60)}" referenced a pricebook item that does not exist.`)
    }

    const item = pricebookItemId ? byId.get(pricebookItemId)! : undefined

    // Unit comes from the pricebook when we have one — the catalog knows
    // whether a thing is sold by the square or the linear foot, the model guesses.
    const unit = item?.unit ?? (typeof line.unit === 'string' ? line.unit.toUpperCase().slice(0, 8) : 'EA')

    // *** The price rule ***
    const suggestedUnitPriceCents = item?.default_unit_price_cents

    // A line is flagged for review when it has no pricebook backing, or when
    // the pricebook item exists but has not been priced yet (the seeded
    // catalog ships at $0 deliberately).
    const unpriced = !item || !item.default_unit_price_cents
    const needsReview = unpriced || line.needsReview === true

    if (!item) {
      warnings.push(`"${description.slice(0, 60)}" is not in the pricebook — priced at $0 and flagged for review.`)
    } else if (!item.default_unit_price_cents) {
      warnings.push(`Pricebook item "${item.name}" has no price set yet — flagged for review.`)
    }

    lineItems.push({
      pricebookItemId,
      description,
      quantity,
      unit,
      suggestedUnitPriceCents,
      reasoningLabel: typeof line.reasoningLabel === 'string'
        ? line.reasoningLabel.trim().slice(0, 200)
        : undefined,
      needsReview,
    })
  }

  const assumptions = toStringArray(obj.assumptions).slice(0, 20)
  warnings.push(...toStringArray(obj.warnings).slice(0, 20))

  if (!input.measurements?.roofAreaSquares && /roof/i.test(input.serviceType)) {
    warnings.push(
      'No roof measurement was attached, so any roofing quantity below is an estimate from the description only. Attach a measurement before sending.',
    )
  }

  if (lineItems.length === 0) {
    warnings.push('The AI did not produce any usable line items. Build the estimate from the pricebook instead.')
  }

  return {
    scopeSummary: typeof obj.scopeSummary === 'string' ? obj.scopeSummary.trim().slice(0, 4000) : '',
    lineItems,
    assumptions,
    warnings,
    metadata: {
      provider: provider.provider,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      usedMeasurements: Boolean(input.measurements?.roofAreaSquares || input.measurements?.roofAreaSqft),
      pricebookItemsOffered: pricebook.length,
      linesNeedingReview: lineItems.filter(l => l.needsReview).length,
    },
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim().slice(0, 500))
    .filter(Boolean)
}

function systemPrompt(companyRules: string[]): string {
  return [
    'You are an estimating assistant for Vertical Builders & Commercial, a licensed Florida',
    'general contractor (CGC1528626) and roofing contractor (CCC1333649) in Nokomis, FL.',
    '',
    'You produce a DRAFT for a human estimator to review. You are not producing a quote.',
    '',
    'Rules you must follow:',
    '- Select line items from the supplied pricebook wherever one fits. Return its exact id.',
    '- Do NOT output prices. Pricing comes from the company pricebook, not from you.',
    '- Calculate quantities from the supplied measurements when they are provided.',
    '- If no measurement is supplied, say so in assumptions rather than guessing a roof size.',
    '- Never state a permit requirement, code requirement, or insurance coverage as fact.',
    '- If the request is ambiguous, add an assumption instead of inventing a detail.',
    '- If something needed is not in the pricebook, still include the line, set needsReview true,',
    '  and explain it in warnings.',
    '',
    ...(companyRules.length ? ['Company rules:', ...companyRules.map(r => `- ${r}`), ''] : []),
    'Respond with JSON only, in exactly this shape:',
    '{',
    '  "scopeSummary": "string — a short paragraph a customer would read",',
    '  "lineItems": [',
    '    { "pricebookItemId": "uuid or omitted", "description": "string",',
    '      "quantity": number, "unit": "string",',
    '      "reasoningLabel": "short note on how the quantity was derived",',
    '      "needsReview": boolean }',
    '  ],',
    '  "assumptions": ["string"],',
    '  "warnings": ["string"]',
    '}',
  ].join('\n')
}

function userPrompt(input: EstimateGenerationInput, pricebook: PricebookItem[]): string {
  const m = input.measurements
  const lines: string[] = [
    `Service type: ${input.serviceType}`,
    `Property: ${[input.property.address, input.property.city, input.property.state, input.property.zip].filter(Boolean).join(', ') || 'not supplied'}`,
    '',
    'Customer request:',
    input.customerRequest || '(none supplied)',
    '',
  ]

  if (m && (m.roofAreaSquares || m.roofAreaSqft)) {
    lines.push(
      'Roof measurements (authoritative — use these, do not estimate area yourself):',
      `  Area: ${m.roofAreaSquares ?? '?'} squares (${m.roofAreaSqft ?? '?'} sq ft)`,
      `  Predominant pitch: ${m.primaryPitch ?? 'not recorded'}`,
      `  Facets: ${m.facetCount ?? 'not recorded'}`,
      `  Ridge: ${m.ridgeLf ?? '?'} lf · Hip: ${m.hipLf ?? '?'} lf · Valley: ${m.valleyLf ?? '?'} lf`,
      `  Eave: ${m.eaveLf ?? '?'} lf · Rake: ${m.rakeLf ?? '?'} lf`,
      `  Waste factor: ${m.wasteFactorPercent ?? 'not specified'}%`,
      `  Source: ${m.provider ?? 'unknown'}`,
      '',
    )
  } else {
    lines.push('Roof measurements: NONE ATTACHED. Do not invent an area.', '')
  }

  lines.push(
    'Company pricebook (select by id; these are the only priced items available):',
    ...pricebook.map(i =>
      `  ${i.id} | ${i.name} | unit ${i.unit} | ${i.category ?? 'uncategorised'}${i.default_unit_price_cents ? '' : ' | NO PRICE SET'}`,
    ),
  )

  return lines.join('\n')
}

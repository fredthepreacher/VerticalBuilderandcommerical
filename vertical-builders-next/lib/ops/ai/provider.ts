import 'server-only'

/**
 * ============================================================================
 * PHASE 3 AI PROVIDER — the only place Phase 3 talks to a model
 * ----------------------------------------------------------------------------
 * Deliberately separate from `lib/ops/estimating/ai.ts`. That module carries the
 * estimate price-safety boundary and 35 passing tests; refactoring the two
 * together to save thirty lines of fetch handling would put that boundary at
 * risk for no user-visible gain. The duplication is the cheaper trade.
 *
 * Everything here is server-only. `import 'server-only'` makes a client-side
 * import a build error, which is what stops the API key reaching a bundle.
 * ============================================================================
 */

export const OPS_PROMPT_VERSION = 'vbc-ops-ai-v1'

/** Hard ceiling on a single completion, regardless of what a caller asks for. */
const MAX_OUTPUT_TOKENS = 2_000

/** A request that has not answered by now is not going to be useful. */
const DEFAULT_TIMEOUT_MS = 45_000

export type AiUnavailableReason =
  | 'not_configured'
  | 'disabled'
  | 'timeout'
  | 'transport'
  | 'provider_error'
  | 'empty_response'
  | 'unparseable'
  | 'invalid_shape'
  | 'rate_limited'

/**
 * Thrown for every failure mode. Callers catch this and leave the CRM exactly
 * as it was — an AI outage must never damage or block operational work.
 */
export class AiUnavailableError extends Error {
  readonly reason: AiUnavailableReason
  constructor(reason: AiUnavailableReason, message: string) {
    super(message)
    this.name = 'AiUnavailableError'
    this.reason = reason
  }
}

export interface AiConfig {
  configured: boolean
  model: string
  /** Never the value — only whether it is present. */
  keyPresent: boolean
}

export function opsModel(): string {
  return process.env.OPENAI_OPS_MODEL || 'gpt-4o-mini'
}

export function describeAiConfig(): AiConfig {
  const keyPresent = Boolean(process.env.OPENAI_API_KEY)
  return { configured: keyPresent, model: opsModel(), keyPresent }
}

export function isOpsAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AiContentPart[]
}

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

export interface AiUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface AiJsonResult<T = unknown> {
  data: T
  model: string
  promptVersion: string
  usage: AiUsage | null
  latencyMs: number
}

export interface AiJsonRequest {
  messages: AiMessage[]
  /** Clamped to MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number
  temperature?: number
  timeoutMs?: number
  /** Overrides the default ops model. Used by nothing today; kept for tuning. */
  model?: string
}

/**
 * One JSON completion.
 *
 * Returns parsed-but-unvalidated JSON. The caller is expected to run it through
 * a Zod schema immediately — see `lib/ops/ai/schemas.ts`. Splitting "did the
 * provider answer" from "is the answer usable" keeps the failure messages
 * honest: a timeout and a hallucinated field are different problems and get
 * different copy.
 */
export async function requestJson<T = unknown>(request: AiJsonRequest): Promise<AiJsonResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new AiUnavailableError(
      'not_configured',
      'AI is not configured. Set OPENAI_API_KEY to enable it — every screen keeps working without it.',
    )
  }

  const model = request.model || opsModel()
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: request.temperature ?? 0.1,
        max_tokens: Math.min(request.maxOutputTokens ?? 1_200, MAX_OUTPUT_TOKENS),
        response_format: { type: 'json_object' },
        messages: request.messages,
      }),
    })
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiUnavailableError('timeout', 'The AI service took too long to respond. Nothing has been changed.')
    }
    // Never log the error object wholesale — a fetch error can carry request
    // headers, and those carry the key.
    console.error('[ops-ai] transport error', error instanceof Error ? error.message : 'unknown')
    throw new AiUnavailableError('transport', 'Could not reach the AI service. Nothing has been changed.')
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 429) {
    throw new AiUnavailableError('rate_limited', 'The AI service is rate limiting requests. Try again shortly.')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('[ops-ai] provider error', response.status, detail.slice(0, 300))
    throw new AiUnavailableError(
      'provider_error',
      `The AI service returned an error (${response.status}). Nothing has been changed.`,
    )
  }

  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  } | null

  const raw = body?.choices?.[0]?.message?.content
  if (!raw) {
    throw new AiUnavailableError('empty_response', 'The AI service returned an empty response.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Log the length, not the content: a COI response would put insurance
    // details into the server log.
    console.error('[ops-ai] unparseable JSON response', `${raw.length} chars`)
    throw new AiUnavailableError('unparseable', 'The AI service returned something unusable.')
  }

  return {
    data: parsed as T,
    model,
    promptVersion: OPS_PROMPT_VERSION,
    usage: body?.usage
      ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
        }
      : null,
    latencyMs: Date.now() - started,
  }
}

/** Turns any thrown value into something safe to show a user. */
export function describeAiError(error: unknown): { reason: AiUnavailableReason; message: string } {
  if (error instanceof AiUnavailableError) return { reason: error.reason, message: error.message }
  console.error('[ops-ai] unexpected error', error instanceof Error ? error.message : 'unknown')
  return { reason: 'provider_error', message: 'Something went wrong talking to the AI service. Nothing has been changed.' }
}

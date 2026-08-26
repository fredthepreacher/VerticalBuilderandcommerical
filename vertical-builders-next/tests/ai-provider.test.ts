import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AiUnavailableError, OPS_PROMPT_VERSION, describeAiConfig, describeAiError,
  isOpsAiConfigured, opsModel, requestJson,
} from '../lib/ops/ai/provider'

/**
 * ============================================================================
 * THE PROVIDER — failing safely is the feature
 * ----------------------------------------------------------------------------
 * Two things are being asserted throughout:
 *
 *   1. Every failure mode throws `AiUnavailableError` with a reason, so a
 *      caller can leave the CRM untouched. An AI outage must never damage or
 *      block operational work.
 *   2. The API key never leaves this module — not in a thrown message, not in
 *      a console line, not in the returned result.
 * ============================================================================
 */

const KEY = 'sk-test-abcdefghijklmnopqrstuvwxyz0123456789'
const ORIGINAL_KEY = process.env.OPENAI_API_KEY
const ORIGINAL_MODEL = process.env.OPENAI_OPS_MODEL

/** Everything the module wrote to the console during one test. */
let consoleOutput: string[] = []

beforeEach(() => {
  consoleOutput = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(a => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY
  if (ORIGINAL_MODEL === undefined) delete process.env.OPENAI_OPS_MODEL
  else process.env.OPENAI_OPS_MODEL = ORIGINAL_MODEL
})

/** A fetch that returns whatever the test says, and records the request. */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return handler(url, init)
  })
  return calls
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const completion = (content: string, usage?: Record<string, number>) =>
  json({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) })

/**
 * Awaits a call that must reject, and returns the error typed. Using
 * `.catch(e => e as AiUnavailableError)` would union the error with the
 * resolved value and defeat the point of the assertion.
 */
async function rejection(promise: Promise<unknown>): Promise<AiUnavailableError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AiUnavailableError) return error
    throw error
  }
  throw new Error('expected the call to reject, but it resolved')
}

/** Same, for a call that may throw something other than AiUnavailableError. */
async function anyRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the call to reject, but it resolved')
}

describe('configuration', () => {
  it('reports itself unconfigured when no key is set', () => {
    delete process.env.OPENAI_API_KEY
    expect(isOpsAiConfigured()).toBe(false)
    expect(describeAiConfig().configured).toBe(false)
    expect(describeAiConfig().keyPresent).toBe(false)
  })

  it('reports presence without ever exposing the value', () => {
    process.env.OPENAI_API_KEY = KEY
    const config = describeAiConfig()
    expect(config.keyPresent).toBe(true)
    expect(JSON.stringify(config)).not.toContain(KEY)
    expect(JSON.stringify(config)).not.toContain('sk-')
  })

  it('defaults to an inexpensive model and honours the override', () => {
    delete process.env.OPENAI_OPS_MODEL
    expect(opsModel()).toBe('gpt-4o-mini')
    process.env.OPENAI_OPS_MODEL = 'gpt-4o'
    expect(opsModel()).toBe('gpt-4o')
  })
})

describe('a missing API key fails gracefully', () => {
  it('throws not_configured rather than attempting a call', async () => {
    delete process.env.OPENAI_API_KEY
    const calls = stubFetch(() => completion('{}'))

    await expect(requestJson({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toBeInstanceOf(AiUnavailableError)
    expect(calls).toHaveLength(0)
  })

  it('gives the operator an actionable message, not a stack trace', async () => {
    delete process.env.OPENAI_API_KEY
    const error = await rejection(requestJson({ messages: [] }))
    expect(error.reason).toBe('not_configured')
    expect(error.message).toMatch(/OPENAI_API_KEY/)
    expect(error.message).toMatch(/keeps working without it/i)
  })
})

describe('a provider failure does not damage data — it just refuses', () => {
  beforeEach(() => { process.env.OPENAI_API_KEY = KEY })

  it('maps a 429 to rate_limited', async () => {
    stubFetch(() => json({ error: 'slow down' }, 429))
    const error = await rejection(requestJson({ messages: [] }))
    expect(error.reason).toBe('rate_limited')
  })

  it('maps a 500 to provider_error and says nothing was changed', async () => {
    stubFetch(() => new Response('upstream exploded', { status: 500 }))
    const error = await rejection(requestJson({ messages: [] }))
    expect(error.reason).toBe('provider_error')
    expect(error.message).toMatch(/nothing has been changed/i)
  })

  it('maps an aborted request to timeout', async () => {
    stubFetch(() => {
      const abort = new Error('The operation was aborted')
      abort.name = 'AbortError'
      throw abort
    })
    const error = await rejection(requestJson({ messages: [] }))
    expect(error.reason).toBe('timeout')
    expect(error.message).toMatch(/nothing has been changed/i)
  })

  it('maps a network failure to transport', async () => {
    stubFetch(() => { throw new TypeError('fetch failed') })
    const error = await rejection(requestJson({ messages: [] }))
    expect(error.reason).toBe('transport')
  })

  it('maps an empty completion to empty_response', async () => {
    stubFetch(() => json({ choices: [{ message: { content: '' } }] }))
    const error = await rejection(requestJson({ messages: [] }))
    expect(error.reason).toBe('empty_response')
  })

  it('maps non-JSON prose to unparseable', async () => {
    stubFetch(() => completion('Sure! Here are the policies you asked about.'))
    const error = await rejection(requestJson({ messages: [] }))
    expect(error.reason).toBe('unparseable')
  })

  it('every failure is the same catchable type, so no caller can forget one', async () => {
    const cases: (() => Response)[] = [
      () => json({}, 429),
      () => json({}, 503),
      () => json({ choices: [] }),
      () => completion('not json'),
    ]
    for (const handler of cases) {
      stubFetch(handler)
      const error: unknown = await anyRejection(requestJson({ messages: [] }))
      expect(error).toBeInstanceOf(AiUnavailableError)
      expect((error as AiUnavailableError).reason).toBeTruthy()
    }
  })
})

describe('the key stays inside the module', () => {
  beforeEach(() => { process.env.OPENAI_API_KEY = KEY })

  it('sends the key as a bearer token and nowhere else', async () => {
    const calls = stubFetch(() => completion('{"ok":true}'))
    await requestJson({ messages: [{ role: 'user', content: 'hi' }] })

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(String(calls[0].url)).not.toContain(KEY)
    expect(String(calls[0].init.body)).not.toContain(KEY)
  })

  it('never puts the key in a thrown message', async () => {
    for (const handler of [
      () => json({}, 500),
      () => { throw new Error(`connect ECONNREFUSED using Bearer ${KEY}`) },
      () => completion('not json'),
    ]) {
      stubFetch(handler as () => Response)
      const error = await anyRejection(requestJson({ messages: [] }))
      expect(error.message).not.toContain(KEY)
    }
  })

  it('never logs the raw error object, which can carry the request headers', async () => {
    // A fetch rejection in Node can carry a `cause` holding the original
    // request. Logging `error` wholesale would put the Authorization header in
    // the server log; the module logs `error.message` for that reason.
    stubFetch(() => {
      const err = new Error('fetch failed') as Error & { cause?: unknown }
      err.cause = { headers: { Authorization: `Bearer ${KEY}` } }
      throw err
    })
    await requestJson({ messages: [] }).catch(() => undefined)
    expect(consoleOutput.join('\n')).not.toContain(KEY)
    expect(consoleOutput.join('\n')).toContain('transport error')
  })

  it('logs the length of an unparseable response, not its content', async () => {
    // A COI response would otherwise put a subcontractor's insurance detail
    // into the log.
    stubFetch(() => completion('Policy GL-99881 for ZZ Roofing expires 2027-01-01'))
    await requestJson({ messages: [] }).catch(() => undefined)
    const logged = consoleOutput.join('\n')
    expect(logged).not.toContain('ZZ Roofing')
    expect(logged).not.toContain('GL-99881')
    expect(logged).toMatch(/\d+ chars/)
  })
})

describe('a successful call', () => {
  beforeEach(() => { process.env.OPENAI_API_KEY = KEY })

  it('returns parsed JSON with the model and prompt version attached', async () => {
    stubFetch(() => completion('{"headline":"Three policies expire this month"}', {
      prompt_tokens: 120, completion_tokens: 40, total_tokens: 160,
    }))
    const result = await requestJson<{ headline: string }>({ messages: [{ role: 'user', content: 'brief me' }] })

    expect(result.data.headline).toBe('Three policies expire this month')
    expect(result.promptVersion).toBe(OPS_PROMPT_VERSION)
    expect(result.model).toBe(opsModel())
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 40, totalTokens: 160 })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('does not validate the shape — that is the schema layer’s job', async () => {
    // The provider deliberately returns unvalidated JSON so that "the provider
    // answered" and "the answer is usable" stay separate failures with
    // separate messages.
    stubFetch(() => completion('{"totally":"unexpected"}'))
    const result = await requestJson({ messages: [] })
    expect(result.data).toEqual({ totally: 'unexpected' })
  })

  it('asks for a JSON object and a low temperature', async () => {
    const calls = stubFetch(() => completion('{}'))
    await requestJson({ messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBeLessThanOrEqual(0.3)
  })

  it('clamps an oversized token request rather than trusting the caller', async () => {
    const calls = stubFetch(() => completion('{}'))
    await requestJson({ messages: [], maxOutputTokens: 999_999 })
    expect(JSON.parse(String(calls[0].init.body)).max_tokens).toBeLessThanOrEqual(2_000)
  })

  it('reports no usage rather than fabricating zeros when the provider omits it', async () => {
    stubFetch(() => completion('{}'))
    expect((await requestJson({ messages: [] })).usage).toBeNull()
  })
})

describe('describeAiError', () => {
  it('passes an AiUnavailableError through with its reason intact', () => {
    const described = describeAiError(new AiUnavailableError('timeout', 'took too long'))
    expect(described).toEqual({ reason: 'timeout', message: 'took too long' })
  })

  it('turns an unexpected throw into a safe message with no internals', () => {
    const described = describeAiError(new Error(`boom at /home/deploy/app with ${KEY}`))
    expect(described.reason).toBe('provider_error')
    expect(described.message).not.toContain(KEY)
    expect(described.message).not.toContain('/home/deploy')
    expect(described.message).toMatch(/nothing has been changed/i)
  })

  it('survives a thrown string, number or null', () => {
    for (const junk of ['a string', 42, null, undefined, { weird: true }]) {
      expect(() => describeAiError(junk)).not.toThrow()
      expect(describeAiError(junk).reason).toBe('provider_error')
    }
  })
})

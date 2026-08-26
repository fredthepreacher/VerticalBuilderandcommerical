import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findTodaysBrief, logAiRun } from '../lib/ops/services/ai-runs'

/**
 * ============================================================================
 * AI TELEMETRY
 * ----------------------------------------------------------------------------
 * `ai_runs` answers "who ran AI against what, and did it work". It must never
 * become a second copy of the customer's paperwork, and it must never break the
 * feature it is recording.
 * ============================================================================
 */

interface Insert { table: string; row: Record<string, unknown> }

/** A Supabase stand-in that records inserts and can be told to fail. */
function fakeSupabase(options: { failInsert?: boolean; rows?: Record<string, unknown>[] } = {}) {
  const inserts: Insert[] = []
  const filters: [string, unknown][] = []

  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'order', 'limit']) {
    query[method] = (...args: unknown[]) => {
      if (method === 'eq' || method === 'gte') filters.push([String(args[0]), args[1]])
      return query
    }
  }
  query.then = (resolve: (v: unknown) => void) => resolve({ data: options.rows ?? [], error: null })

  const client = {
    from(table: string) {
      return {
        ...query,
        insert(row: Record<string, unknown>) {
          if (options.failInsert) return Promise.reject(new Error('permission denied for table ai_runs'))
          inserts.push({ table, row })
          return Promise.resolve({ error: null })
        },
      }
    },
  } as never

  return { client, inserts, filters }
}

let consoleOutput: string[] = []

beforeEach(() => {
  consoleOutput = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' '))
  })
})

afterEach(() => vi.restoreAllMocks())

describe('a successful call writes the expected metadata', () => {
  it('records the user, feature, model, outcome and cost', async () => {
    const { client, inserts } = fakeSupabase()
    await logAiRun(client, {
      userId: '00000000-0000-4000-a000-000000000001',
      feature: 'copilot',
      model: 'gpt-4o-mini',
      promptVersion: 'vbc-ops-ai-v1',
      entityType: 'project',
      entityId: '00000000-0000-4000-d000-000000000009',
      inputRefs: { tools: ['get_expiring_policies'], pageContext: '/ops/dashboard' },
      outputSummary: { citedRecords: 3, hadProposal: false },
      tokenUsage: { promptTokens: 900, completionTokens: 120, totalTokens: 1_020 },
      latencyMs: 1_840,
    })

    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('ai_runs')
    const row = inserts[0].row
    expect(row.user_id).toBe('00000000-0000-4000-a000-000000000001')
    expect(row.feature).toBe('copilot')
    expect(row.status).toBe('succeeded')
    expect(row.model).toBe('gpt-4o-mini')
    expect(row.prompt_version).toBe('vbc-ops-ai-v1')
    expect(row.entity_type).toBe('project')
    expect(row.latency_ms).toBe(1_840)
    expect(row.token_usage).toEqual({ promptTokens: 900, completionTokens: 120, totalTokens: 1_020 })
    expect((row.input_refs as Record<string, unknown>).tools).toEqual(['get_expiring_policies'])
  })

  it('defaults to succeeded and nulls, so a caller cannot omit a column', async () => {
    const { client, inserts } = fakeSupabase()
    await logAiRun(client, { userId: 'u1', feature: 'dashboard_brief' })
    const row = inserts[0].row
    expect(row.status).toBe('succeeded')
    expect(row.model).toBeNull()
    expect(row.entity_id).toBeNull()
    expect(row.error_code).toBeNull()
    expect(row.input_refs).toEqual({})
    expect(row.output_summary).toEqual({})
  })
})

describe('a failed call is logged as a failure, not swallowed silently', () => {
  it('stores the reason code without the underlying prose', async () => {
    const { client, inserts } = fakeSupabase()
    await logAiRun(client, {
      userId: 'u1', feature: 'coi_extraction', status: 'failed', errorCode: 'timeout',
      entityType: 'document', entityId: 'd1',
    })
    expect(inserts[0].row.status).toBe('failed')
    expect(inserts[0].row.error_code).toBe('timeout')
  })

  it('records a refusal distinctly from an outage', async () => {
    const { client, inserts } = fakeSupabase()
    await logAiRun(client, { userId: 'u1', feature: 'copilot', status: 'refused', errorCode: 'unsupported_document' })
    expect(inserts[0].row.status).toBe('refused')
  })
})

describe('no secret and no document text reaches the table', () => {
  it('drops any key that looks like a credential', async () => {
    const { client, inserts } = fakeSupabase()
    await logAiRun(client, {
      userId: 'u1', feature: 'copilot',
      inputRefs: {
        apiKey: 'sk-live-abcdefghijklmnop', token: 'eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaaaaaaaaaaaaaa',
        authorization: 'Bearer abc', password: 'hunter2', tools: ['search_leads'],
      },
    })
    const refs = inserts[0].row.input_refs as Record<string, unknown>
    expect(refs).not.toHaveProperty('apiKey')
    expect(refs).not.toHaveProperty('token')
    expect(refs).not.toHaveProperty('authorization')
    expect(refs).not.toHaveProperty('password')
    expect(refs.tools).toEqual(['search_leads'])
  })

  it('never lets the raw service key through, under any key name', async () => {
    const { client, inserts } = fakeSupabase()
    const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.c2VydmljZV9yb2xl.signature'
    await logAiRun(client, {
      userId: 'u1', feature: 'copilot',
      inputRefs: { note: `called with ${serviceKey}` },
      outputSummary: { detail: `Bearer ${serviceKey}` },
    })
    const serialised = JSON.stringify(inserts[0].row)
    expect(serialised).not.toContain(serviceKey)
    expect(serialised).toContain('[redacted]')
  })

  it('clamps a long value so a prompt or a COI cannot be smuggled into the log', async () => {
    const { client, inserts } = fakeSupabase()
    await logAiRun(client, {
      userId: 'u1', feature: 'coi_extraction',
      outputSummary: { text: 'ZZ Roofing certificate detail '.repeat(500) },
    })
    const text = String((inserts[0].row.output_summary as Record<string, unknown>).text)
    expect(text.length).toBeLessThanOrEqual(301)
  })

  it('does not accept a prompt field at all — only counts and identifiers', () => {
    // Enforced by the input type rather than at runtime, so this is a source
    // check: `AiRunInput` has no prompt, message or content field.
    const source = readFileSync(join(process.cwd(), 'lib/ops/services/ai-runs.ts'), 'utf8')
    const shape = source.slice(source.indexOf('interface AiRunInput'), source.indexOf('export async function logAiRun'))
    expect(shape).not.toMatch(/\b(prompt|messages|content|documentText|rawResponse)\??:/)
  })
})

describe('a broken log never breaks the feature it is logging', () => {
  it('swallows an insert failure and returns normally', async () => {
    const { client } = fakeSupabase({ failInsert: true })
    await expect(logAiRun(client, { userId: 'u1', feature: 'copilot' })).resolves.toBeUndefined()
  })

  it('prints the failure so it is not invisible, without the secret', async () => {
    const { client } = fakeSupabase({ failInsert: true })
    await logAiRun(client, { userId: 'u1', feature: 'copilot', inputRefs: { apiKey: 'sk-should-never-appear' } })
    expect(consoleOutput.join('\n')).toContain('[ai-runs] failed to log')
    expect(consoleOutput.join('\n')).not.toContain('sk-should-never-appear')
  })
})

describe('same-day brief reuse', () => {
  it('scopes the lookup to this user, this feature, successes only, today only', async () => {
    const { client, filters } = fakeSupabase({ rows: [] })
    await findTodaysBrief(client, 'user-42', 'dashboard_brief')
    const asObject = Object.fromEntries(filters)
    expect(asObject.user_id).toBe('user-42')
    expect(asObject.feature).toBe('dashboard_brief')
    expect(asObject.status).toBe('succeeded')
    expect(String(asObject.created_at)).toMatch(/T00:00:00\.000Z$/)
  })

  it('returns null when there is nothing from today, rather than an empty shell', async () => {
    const { client } = fakeSupabase({ rows: [] })
    expect(await findTodaysBrief(client, 'user-42', 'dashboard_brief')).toBeNull()
  })

  it('returns the stored summary when one exists', async () => {
    const { client } = fakeSupabase({
      rows: [{ created_at: '2026-08-21T09:00:00.000Z', output_summary: { headline: 'Two jobs need attention' } }],
    })
    const found = await findTodaysBrief(client, 'user-42', 'dashboard_brief')
    expect(found?.summary).toEqual({ headline: 'Two jobs need attention' })
    expect(found?.createdAt).toBe('2026-08-21T09:00:00.000Z')
  })

  it('tolerates a row with no summary', async () => {
    const { client } = fakeSupabase({ rows: [{ created_at: '2026-08-21T09:00:00.000Z', output_summary: null }] })
    expect((await findTodaysBrief(client, 'user-42', 'audit_brief'))?.summary).toEqual({})
  })
})

describe('the ai_runs table itself', () => {
  const migration = readFileSync(join(process.cwd(), 'supabase/migrations/0011_ops_ai.sql'), 'utf8')

  it('has RLS enabled and forced', () => {
    expect(migration).toMatch(/alter table public\.ai_runs\s+enable\s+row level security/i)
    expect(migration).toMatch(/alter table public\.ai_runs\s+force\s+row level security/i)
  })

  it('only lets a user insert a row attributed to themselves', () => {
    expect(migration).toMatch(/user_id = auth\.uid\(\)/)
  })

  it('grants nothing to anon', () => {
    expect(migration).toMatch(/revoke all on public\.ai_runs[^;]*from anon/i)
  })

  it('has no delete policy, so the trail cannot be rewritten from the app', () => {
    expect(migration).not.toMatch(/for delete/i)
  })
})

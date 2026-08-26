import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSmartOps, helpResponse, type SmartOpsContext } from '../lib/ops/smart/router'
import { buildSmartAuditBrief, buildSmartDashboardBrief } from '../lib/ops/smart/briefs'
import { calculate } from '../lib/ops/smart/calculations'
import { renderTemplate, templateKeys } from '../lib/ops/smart/templates'
import { parseLeadNotes } from '../lib/ops/smart/lead-parser'
import { parseIntent } from '../lib/ops/smart/intents'

/**
 * ============================================================================
 * THE ZERO-PROVIDER GUARANTEE
 * ----------------------------------------------------------------------------
 * The commercial promise this whole follow-up rests on: the client can use
 * Vertical Ops indefinitely with no OpenAI key and no AI bill.
 *
 * Two ways of proving it, because either alone is weak:
 *
 *   Behavioural — run every Smart Ops path with OPENAI_API_KEY deleted and a
 *                 `fetch` that throws if anything reaches the network. If a
 *                 provider call existed, these tests would fail loudly.
 *   Structural  — read every file under lib/ops/smart and assert none of them
 *                 imports the provider, even transitively through the fact
 *                 collectors. This is what stops a future refactor quietly
 *                 reintroducing a call.
 *
 * (The guarantee is about AI-provider usage. Hosting and database costs are a
 * different question and are unaffected.)
 * ============================================================================
 */

const ORIGINAL_KEY = process.env.OPENAI_API_KEY

/** Any outbound HTTP at all fails the test, with the URL named. */
let networkAttempts: string[] = []

beforeEach(() => {
  delete process.env.OPENAI_API_KEY
  networkAttempts = []
  vi.stubGlobal('fetch', (url: unknown) => {
    const target = String(url)
    networkAttempts.push(target)
    throw new Error(`Smart Ops attempted a network request to ${target}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY
})

function fakeSupabase() {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of [
    'select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'gt', 'gte', 'lte',
    'ilike', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = chain
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null })
  return { from: () => builder } as never
}

const ctx = (): SmartOpsContext => ({
  supabase: fakeSupabase(),
  userId: '00000000-0000-4000-a000-000000000001',
  userName: 'Fred Pierre',
  role: 'admin',
  settings: { costs_visible_to_pm: true, profit_visible_to_pm: true },
})

// ---------------------------------------------------------------------------
// Behavioural
// ---------------------------------------------------------------------------

describe('with no OPENAI_API_KEY, every Smart Ops path still works', () => {
  const QUESTIONS = [
    'What needs my attention today?',
    'Show insurance expiring in 45 days',
    'Who is missing paperwork?',
    'What is my audit readiness?',
    'Which leads need follow-up?',
    'What jobs are active this week?',
    'Show open estimates',
    'Show unpaid invoices',
    'Job cost for the Miller residence',
    'Profit on the Miller residence',
    'What is 15% of 2500?',
    'Add a 20% markup to 1800',
    'Give me a COI renewal template',
    'help',
  ]

  for (const question of QUESTIONS) {
    it(`answers "${question}" without contacting a provider`, async () => {
      expect(process.env.OPENAI_API_KEY).toBeUndefined()
      const { response } = await runSmartOps(ctx(), question)
      expect(response, `"${question}" was not recognised`).not.toBeNull()
      expect(response?.mode).toBe('smart_ops')
      expect(response?.summary.length).toBeGreaterThan(0)
      expect(networkAttempts, `"${question}" reached the network`).toEqual([])
    })
  }

  it('the help card renders', () => {
    const help = helpResponse(ctx())
    expect(help.items?.length).toBeGreaterThan(5)
    expect(networkAttempts).toEqual([])
  })

  it('the dashboard brief renders', () => {
    const brief = buildSmartDashboardBrief({
      coverageExpiring30: 3, coverageExpired: 0, vendorsBlocking: 1, vendorsNeedingReview: 0,
      leadsNeedingFollowUp: 2, openLeads: 9, activeProjects: 4, jobsStartingThisWeek: 1,
    })
    expect(brief.headline.length).toBeGreaterThan(0)
    expect(networkAttempts).toEqual([])
  })

  it('the audit brief renders', () => {
    const brief = buildSmartAuditBrief({
      vendorsEvaluated: 6, byStatus: {}, blocking: [], expiringSoon: [], expired: [],
      needsReview: [], activeProjects: 2, auditPeriod: null,
    })
    expect(brief.readinessStatement.length).toBeGreaterThan(0)
    expect(networkAttempts).toEqual([])
  })

  it('the calculator works', () => {
    expect(calculate({ kind: 'percent_of', a: 15, b: 2_500 }).raw).toBe(375)
    expect(networkAttempts).toEqual([])
  })

  it('every template renders', () => {
    for (const key of templateKeys()) expect(renderTemplate(key).body.length).toBeGreaterThan(40)
    expect(networkAttempts).toEqual([])
  })

  it('the lead parser works', () => {
    const parsed = parseLeadNotes('Name: John Smith\nPhone: 941-555-0100\nService: Roofing')
    expect(parsed.fields.first_name).toBe('John')
    expect(networkAttempts).toEqual([])
  })

  it('the intent parser works', () => {
    expect(parseIntent('what is my audit readiness')?.intent).toBe('audit_readiness')
    expect(networkAttempts).toEqual([])
  })

  it('an unrecognised question returns null rather than reaching for a model', async () => {
    const { response } = await runSmartOps(ctx(), 'write me an essay about roofing')
    expect(response).toBeNull()
    expect(networkAttempts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

describe('no Smart Ops module can reach the AI provider, even indirectly', () => {
  const root = process.cwd()
  const smartDir = join(root, 'lib/ops/smart')

  /** Import specifiers on real import lines, ignoring prose in comments. */
  function importsOf(file: string): string[] {
    const source = readFileSync(file, 'utf8')
    return source
      .split('\n')
      .filter(l => /^\s*import\s/.test(l))
      .map(l => l.match(/from\s+['"]([^'"]+)['"]/)?.[1])
      .filter((s): s is string => Boolean(s))
  }

  /** Resolves a relative specifier to a file on disk, or null for a package. */
  function resolveLocal(fromFile: string, specifier: string): string | null {
    let base: string
    if (specifier.startsWith('.')) base = join(fromFile, '..', specifier)
    else if (specifier.startsWith('@/')) base = join(root, specifier.slice(2))
    else return null
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  /** Every local module reachable from the given entry points. */
  function reachable(entries: string[]): Set<string> {
    const seen = new Set<string>()
    const queue = [...entries]
    while (queue.length) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      for (const specifier of importsOf(file)) {
        const resolved = resolveLocal(file, specifier)
        if (resolved) queue.push(resolved)
      }
    }
    return seen
  }

  const smartFiles = readdirSync(smartDir).filter(f => f.endsWith('.ts')).map(f => join(smartDir, f))

  it('the transitive import graph of lib/ops/smart never includes the provider', () => {
    const graph = reachable(smartFiles)
    const provider = join(root, 'lib/ops/ai/provider.ts')
    const estimateAi = join(root, 'lib/ops/estimating/ai.ts')
    expect([...graph], 'a Smart Ops module reaches the AI provider').not.toContain(provider)
    expect([...graph], 'a Smart Ops module reaches the estimate AI module').not.toContain(estimateAi)
  })

  it('the Smart Ops server actions never reach the provider either', () => {
    const graph = reachable([join(root, 'app/ops/actions/smart.ts')])
    expect([...graph]).not.toContain(join(root, 'lib/ops/ai/provider.ts'))
  })

  it('no Smart Ops module names an AI endpoint or model', () => {
    for (const file of smartFiles) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} names an AI endpoint`).not.toMatch(/api\.openai\.com|anthropic\.com/)
      expect(source, `${file} names a model`).not.toMatch(/gpt-[0-9]|claude-[0-9]/)
      expect(source, `${file} reads the API key`).not.toMatch(/OPENAI_API_KEY/)
    }
  })

  it('the fact collectors are shared with the AI briefs, not duplicated', () => {
    // Both modes must report the same numbers. They do so by importing the same
    // collectors — if this ever became two implementations, the two briefs
    // could disagree and neither would obviously be wrong.
    const aiBriefs = readFileSync(join(root, 'lib/ops/ai/briefs.ts'), 'utf8')
    expect(aiBriefs).toMatch(/from '\.\.\/smart\/facts'/)
    expect(aiBriefs).not.toMatch(/export async function collectAuditFacts/)
  })
})

// ---------------------------------------------------------------------------
// The endpoint's own ordering
// ---------------------------------------------------------------------------

describe('the assistant endpoint tries Smart Ops before the model', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/ops/assistant/route.ts'), 'utf8')

  it('calls runSmartOps before runCopilot', () => {
    expect(route.indexOf('runSmartOps')).toBeGreaterThan(-1)
    expect(route.indexOf('runSmartOps')).toBeLessThan(route.indexOf('await runCopilot'))
  })

  it('returns the deterministic answer without touching the AI path', () => {
    expect(route).toMatch(/if \(smart\.response\)/)
  })

  it('records the deterministic run as smart_ops, never as AI spend', () => {
    expect(route).toMatch(/mode: 'smart_ops'/)
    expect(route).toMatch(/feature: 'smart_ops'/)
  })

  it('falls back to Smart Ops when the provider fails', () => {
    expect(route).toMatch(/body\.preferAi/)
    expect(route).toMatch(/providerFailed: true/)
  })

  it('resolves the role server-side and never from the request body', () => {
    expect(route).toMatch(/role: user\.role/)
    expect(route).not.toMatch(/body\.role|body\.userId|parsedBody\.role/)
    expect(route).toMatch(/\.strict\(\)/)
  })

  it('uses the user-scoped client, not the admin client', () => {
    const imports = route.split('\n').filter(l => /^\s*import\s/.test(l)).join('\n')
    expect(imports).toMatch(/createSupabaseServerClient/)
    expect(imports).not.toMatch(/createSupabaseAdminClient/)
  })
})

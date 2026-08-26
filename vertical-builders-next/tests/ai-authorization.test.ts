import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { availableTools, executeTool, toolNames, type ToolContext } from '../lib/ops/ai/tools'
import type { UserRole } from '../lib/ops/types'

/**
 * ============================================================================
 * THE AI AUTHORIZATION BOUNDARY
 * ----------------------------------------------------------------------------
 * These are the tests that matter most in Phase 3. Everything else is about
 * quality; these are about whether the assistant can be turned into a way
 * around the permission model.
 * ============================================================================
 */

/**
 * A Supabase stand-in that records what was asked for and returns nothing.
 *
 * The real RLS enforcement is verified against PostgreSQL separately. What is
 * being tested here is the layer above it: whether a tool is offered and
 * executed at all for a given role.
 */
function fakeSupabase() {
  const calls: string[] = []
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of [
    'select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'gt', 'gte', 'lte',
    'ilike', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = chain
  }
  // Awaiting the builder resolves to an empty result set.
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null })
  return {
    client: {
      from(table: string) { calls.push(table); return builder },
    } as never,
    calls,
  }
}

const ctxFor = (role: UserRole, settings = { costs_visible_to_pm: true, profit_visible_to_pm: false }): ToolContext => ({
  supabase: fakeSupabase().client,
  userId: '00000000-0000-4000-a000-000000000001',
  role,
  settings,
})

const FINANCIAL_TOOLS = ['get_unpaid_invoices', 'get_job_cost_summary', 'get_profit_summary']

describe('the tool list offered to the model is built from the role', () => {
  it('offers an admin everything', () => {
    const names = availableTools(ctxFor('admin')).map(t => t.name)
    for (const tool of FINANCIAL_TOOLS) expect(names).toContain(tool)
  })

  it('never offers the auditor a financial tool', () => {
    const names = availableTools(ctxFor('read_only')).map(t => t.name)
    for (const tool of FINANCIAL_TOOLS) {
      expect(names, `read_only was offered ${tool}`).not.toContain(tool)
    }
    // It keeps the compliance tools the role exists for.
    expect(names).toContain('get_subcontractor_compliance')
    expect(names).toContain('get_expiring_policies')
    expect(names).toContain('get_audit_readiness')
  })

  it('follows the project-manager settings, not the role alone', () => {
    const bothOn = availableTools(ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: true }))
      .map(t => t.name)
    expect(bothOn).toContain('get_job_cost_summary')
    expect(bothOn).toContain('get_profit_summary')

    const costsOnly = availableTools(ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: false }))
      .map(t => t.name)
    expect(costsOnly).toContain('get_job_cost_summary')
    expect(costsOnly).not.toContain('get_profit_summary')

    const neither = availableTools(ctxFor('project_manager', { costs_visible_to_pm: false, profit_visible_to_pm: false }))
      .map(t => t.name)
    expect(neither).not.toContain('get_job_cost_summary')
    expect(neither).not.toContain('get_profit_summary')
  })
})

describe('the executor refuses even if the model invents a tool name', () => {
  it('rejects an unknown tool rather than guessing at a near match', async () => {
    const result = await executeTool(ctxFor('admin'), 'get_all_the_money', {})
    expect(result.ok).toBe(false)
    expect(result.denied).toMatch(/no tool called/i)
  })

  it('rejects an empty tool name', async () => {
    expect((await executeTool(ctxFor('admin'), '', {})).ok).toBe(false)
  })

  it('refuses a financial tool for the auditor even when called directly', async () => {
    // This is the scenario that matters: the model was never shown the tool,
    // but suppose it produced the name anyway (hallucination, or a prompt
    // injection in a note telling it to). The executor still says no.
    for (const tool of FINANCIAL_TOOLS) {
      const result = await executeTool(ctxFor('read_only'), tool, { projectId: '00000000-0000-4000-d000-000000000001' })
      expect(result.ok, `${tool} should be refused for read_only`).toBe(false)
      expect(result.denied).toMatch(/not available to your account|does not have access/i)
      expect(result.data).toBeUndefined()
    }
  })

  it('refuses a profit query for a PM whose profit visibility is off', async () => {
    const result = await executeTool(
      ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: false }),
      'get_profit_summary',
      { projectId: '00000000-0000-4000-d000-000000000001' },
    )
    expect(result.ok).toBe(false)
    expect(result.denied).toMatch(/not available/i)
  })

  it('allows the same query once the setting is on', async () => {
    const result = await executeTool(
      ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: true }),
      'get_profit_summary',
      { projectId: '00000000-0000-4000-d000-000000000001' },
    )
    // The fake returns no project, so the tool declines on data grounds — but
    // NOT on permission grounds, which is what this asserts.
    expect(result.denied ?? '').not.toMatch(/not available to your account/i)
  })

  it('rejects a malformed id instead of passing it to a query', async () => {
    const result = await executeTool(ctxFor('admin'), 'get_job_cost_summary', {
      projectId: "'; drop table job_costs; --",
    })
    expect(result.ok).toBe(false)
    expect(result.denied).toMatch(/valid job id/i)
  })

  it('rejects a malformed vendor id on the compliance tool', async () => {
    const result = await executeTool(ctxFor('admin'), 'get_subcontractor_compliance', { vendorId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
  })
})

describe('no tool can write', () => {
  it('every tool name reads — none is named for a mutation', () => {
    for (const name of toolNames()) {
      expect(name, `${name} looks like a mutation`).not.toMatch(
        /^(create|update|delete|insert|set|apply|send|approve|record|void|refund|mark)_/,
      )
    }
  })
})

describe('the AI layer cannot bypass RLS — enforced by module structure', () => {
  const aiDir = join(process.cwd(), 'lib/ops/ai')

  it('no file under lib/ops/ai imports the service-role client', () => {
    for (const file of readdirSync(aiDir).filter(f => f.endsWith('.ts'))) {
      const source = readFileSync(join(aiDir, file), 'utf8')
      // Match import statements, not prose — these files document the rule in
      // their own comments, and a comment mentioning the name is the opposite
      // of a violation.
      const imports = source.split('\n').filter(l => /^\s*import\s/.test(l)).join('\n')
      expect(imports, `${file} imports the admin client`).not.toMatch(/createSupabaseAdminClient|supabase\/admin/)
      expect(source, `${file} references the service role key`).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
    }
  })

  it('the assistant route uses the user-scoped client, not the admin client', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/ops/assistant/route.ts'), 'utf8')
    const imports = route.split('\n').filter(l => /^\s*import\s/.test(l)).join('\n')
    expect(imports).toMatch(/createSupabaseServerClient/)
    expect(imports).not.toMatch(/createSupabaseAdminClient/)
  })

  it('the assistant route resolves the role server-side and never reads it from the body', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/ops/assistant/route.ts'), 'utf8')
    // The request schema is strict and has exactly three keys.
    expect(route).toMatch(/message:\s*z\.string/)
    expect(route).toMatch(/\.strict\(\)/)
    expect(route).not.toMatch(/body\.role|parsedBody\.role|body\.userId/)
    expect(route).toMatch(/role:\s*user\.role/)
  })

  it('no AI module contains raw SQL for execution', () => {
    for (const file of readdirSync(aiDir).filter(f => f.endsWith('.ts'))) {
      const source = readFileSync(join(aiDir, file), 'utf8')
      expect(source, `${file} appears to build SQL`).not.toMatch(/\.rpc\(|execute_sql|SELECT .* FROM /i)
    }
  })
})

describe('the estimate price boundary is untouched by Phase 3', () => {
  it('lib/ops/estimating/ai.ts still enforces pricebook-only pricing', () => {
    const source = readFileSync(join(process.cwd(), 'lib/ops/estimating/ai.ts'), 'utf8')
    expect(source).toMatch(/export function sanitizeResult/)
    expect(source).toMatch(/item\?\.default_unit_price_cents/)
    expect(source).toMatch(/needsReview/)
  })

  it('no Phase 3 module imports or re-exports the estimate sanitiser', () => {
    const aiDir = join(process.cwd(), 'lib/ops/ai')
    for (const file of readdirSync(aiDir).filter(f => f.endsWith('.ts'))) {
      const source = readFileSync(join(aiDir, file), 'utf8')
      const imports = source.split('\n').filter(l => /^\s*import\s/.test(l)).join('\n')
      expect(imports, `${file} reaches into the estimate module`).not.toMatch(/estimating\/ai/)
    }
  })
})

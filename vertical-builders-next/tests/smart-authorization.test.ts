import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { availableCommands, helpResponse, runSmartOps, type SmartOpsContext } from '../lib/ops/smart/router'
import type { UserRole } from '../lib/ops/types'

/**
 * ============================================================================
 * SMART OPS AUTHORIZATION
 * ----------------------------------------------------------------------------
 * Smart Ops is a second door into the same data. If it were built without the
 * permission checks the Copilot has, it would be a way around them — the exact
 * failure the Phase 3 change order was written to prevent.
 *
 * So the same boundary is asserted again here, from the other side: the
 * auditor's financial questions, the project manager's configurable settings,
 * and the structural rule that nothing under lib/ops/smart may reach the
 * service-role client.
 * ============================================================================
 */

/** A Supabase stand-in that records tables touched and returns nothing. */
function fakeSupabase() {
  const tables: string[] = []
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of [
    'select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'gt', 'gte', 'lte',
    'ilike', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = chain
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null })
  return {
    client: { from(table: string) { tables.push(table); return builder } } as never,
    tables,
  }
}

function ctxFor(
  role: UserRole,
  settings = { costs_visible_to_pm: true, profit_visible_to_pm: false },
): SmartOpsContext & { tables: string[] } {
  const fake = fakeSupabase()
  return {
    supabase: fake.client,
    userId: '00000000-0000-4000-a000-000000000001',
    userName: 'Test User',
    role,
    settings,
    tables: fake.tables,
  }
}

describe('the advertised command list follows the role', () => {
  it('offers an admin the financial commands', () => {
    const examples = availableCommands(ctxFor('admin')).map(c => c.example).join(' | ')
    expect(examples).toMatch(/unpaid invoices/i)
    expect(examples).toMatch(/job cost/i)
    expect(examples).toMatch(/profit/i)
  })

  it('never advertises a financial command to the auditor', () => {
    const examples = availableCommands(ctxFor('read_only')).map(c => c.example).join(' | ')
    expect(examples).not.toMatch(/unpaid invoices/i)
    expect(examples).not.toMatch(/job cost/i)
    expect(examples).not.toMatch(/profit/i)
    // It keeps everything the auditor's job actually needs.
    expect(examples).toMatch(/audit readiness/i)
    expect(examples).toMatch(/missing paperwork/i)
    expect(examples).toMatch(/expiring/i)
  })

  it('follows the project-manager settings, not the role alone', () => {
    const both = availableCommands(ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: true }))
      .map(c => c.example).join(' | ')
    expect(both).toMatch(/job cost/i)
    expect(both).toMatch(/profit/i)

    const costsOnly = availableCommands(ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: false }))
      .map(c => c.example).join(' | ')
    expect(costsOnly).toMatch(/job cost/i)
    expect(costsOnly).not.toMatch(/profit on/i)

    const neither = availableCommands(ctxFor('project_manager', { costs_visible_to_pm: false, profit_visible_to_pm: false }))
      .map(c => c.example).join(' | ')
    expect(neither).not.toMatch(/job cost/i)
    expect(neither).not.toMatch(/profit on/i)
  })

  it('the help card only lists commands the account can actually run', () => {
    const help = helpResponse(ctxFor('read_only'))
    expect(JSON.stringify(help.items)).not.toMatch(/profit|job cost|unpaid invoices/i)
  })
})

describe('the auditor cannot get financial data through Smart Ops', () => {
  it('refuses gross profit, and does not query job_costs to find out', async () => {
    const ctx = ctxFor('read_only')
    const { response } = await runSmartOps(ctx, 'what is the gross profit on the Miller job')
    expect(response?.intent).toBe('job_profit')
    expect(response?.summary).toMatch(/not available to your account/i)
    // The permission gate runs before anything is looked up, so the auditor's
    // question never becomes a query against the financial tables at all.
    expect(ctx.tables).not.toContain('job_costs')
    expect(ctx.tables).not.toContain('projects')
  })

  it('refuses job costs the same way', async () => {
    const ctx = ctxFor('read_only')
    const { response } = await runSmartOps(ctx, 'job cost for the Miller residence')
    expect(response?.summary).toMatch(/not available to your account/i)
    expect(ctx.tables).not.toContain('job_costs')
  })

  it('refuses receivables', async () => {
    const ctx = ctxFor('read_only')
    const { response } = await runSmartOps(ctx, 'show unpaid invoices')
    expect(response?.intent).toBe('unpaid_invoices')
    expect(response?.summary).toMatch(/not available|does not have access/i)
    expect(response?.items ?? []).toHaveLength(0)
  })

  it('leaves receivables out of the auditor’s attention summary entirely', async () => {
    const ctx = ctxFor('read_only')
    const { response } = await runSmartOps(ctx, 'what needs my attention today')
    expect(JSON.stringify(response)).not.toMatch(/unpaid invoice|overdue invoice/i)
    expect(ctx.tables).not.toContain('invoices')
  })

  it('still answers the compliance questions the auditor exists to ask', async () => {
    const ctx = ctxFor('read_only')
    for (const question of ['what is my audit readiness', 'who is missing paperwork', 'show insurance expiring in 45 days']) {
      const { response } = await runSmartOps(ctx, question)
      expect(response, question).not.toBeNull()
      expect(response?.summary, question).not.toMatch(/not available to your account/i)
    }
  })
})

describe('the project manager gate is the settings, not the role', () => {
  it('refuses profit when profit visibility is off', async () => {
    const ctx = ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: false })
    const { response } = await runSmartOps(ctx, 'profit on the Miller residence')
    expect(response?.summary).toMatch(/not available to your account/i)
  })

  it('gets past the permission gate once the setting is on', async () => {
    const ctx = ctxFor('project_manager', { costs_visible_to_pm: true, profit_visible_to_pm: true })
    const { response } = await runSmartOps(ctx, 'profit on the Miller residence')
    // The fake returns no rows, so it declines on data grounds — but NOT on
    // permission grounds, which is what this asserts.
    expect(response?.summary).not.toMatch(/not available to your account/i)
  })
})

describe('Smart Ops cannot write, send or decide', () => {
  const smartDir = join(process.cwd(), 'lib/ops/smart')
  const files = readdirSync(smartDir).filter(f => f.endsWith('.ts'))

  it('no module performs a mutation', () => {
    for (const file of files) {
      const source = readFileSync(join(smartDir, file), 'utf8')
      expect(source, `${file} performs a write`).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/)
    }
  })

  it('no module imports the service-role client or reads the key', () => {
    for (const file of files) {
      const source = readFileSync(join(smartDir, file), 'utf8')
      const imports = source.split('\n').filter(l => /^\s*import\s/.test(l)).join('\n')
      expect(imports, `${file} imports the admin client`).not.toMatch(/createSupabaseAdminClient|supabase\/admin/)
      expect(source, `${file} references the service role key`).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
    }
  })

  it('no module builds SQL', () => {
    for (const file of files) {
      const source = readFileSync(join(smartDir, file), 'utf8')
      expect(source, `${file} appears to build SQL`).not.toMatch(/\.rpc\(|execute_sql|SELECT .* FROM /i)
    }
  })

  it('no module can send email or reach an arbitrary URL', () => {
    for (const file of files) {
      const source = readFileSync(join(smartDir, file), 'utf8')
      expect(source, `${file} sends mail`).not.toMatch(/resend|sendEmail|nodemailer/i)
      expect(source, `${file} fetches a URL`).not.toMatch(/\bfetch\s*\(/)
    }
  })

  it('never sets a compliance status, a pipeline stage or a payment', () => {
    for (const file of files) {
      const source = readFileSync(join(smartDir, file), 'utf8')
      expect(source, file).not.toMatch(/compliance_status\s*:/)
      expect(source, file).not.toMatch(/pipeline_stage\s*:\s*['"]/)
      expect(source, file).not.toMatch(/amount_paid_cents\s*:/)
    }
  })

  it('the Smart Ops server actions never write a business record', () => {
    const source = readFileSync(join(process.cwd(), 'app/ops/actions/smart.ts'), 'utf8')
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/)
    // logAiRun is the one exception, and it writes telemetry, not business data.
    expect(source).toMatch(/logAiRun/)
  })

  it('every href Smart Ops returns comes from the application’s own route map', async () => {
    const ctx = ctxFor('admin')
    for (const question of [
      'what needs my attention today', 'show insurance expiring in 45 days',
      'who is missing paperwork', 'which leads need follow-up', 'show open estimates',
    ]) {
      const { response } = await runSmartOps(ctx, question)
      for (const item of response?.items ?? []) {
        if (item.href) expect(item.href, `${question} → ${item.href}`).toMatch(/^\/ops\//)
      }
      for (const action of response?.suggestedActions ?? []) {
        if (action.href) expect(action.href, action.label).toMatch(/^\/ops\//)
      }
    }
  })

  it('a suggested follow-up command is itself a supported command', async () => {
    const ctx = ctxFor('admin')
    const { parseIntent } = await import('../lib/ops/smart/intents')
    for (const question of ['show insurance expiring in 45 days', 'who is missing paperwork', 'what is my audit readiness']) {
      const { response } = await runSmartOps(ctx, question)
      for (const action of response?.suggestedActions ?? []) {
        if (action.command) {
          expect(parseIntent(action.command), `"${action.command}" is offered but not understood`).not.toBeNull()
        }
      }
    }
  })
})

describe('templates are drafts, never sends', () => {
  it('says nothing has been sent', async () => {
    const ctx = ctxFor('admin')
    const { response } = await runSmartOps(ctx, 'give me a COI renewal template')
    expect(response?.intent).toBe('template')
    expect(response?.copyText).toBeTruthy()
    expect((response?.notices ?? []).join(' ')).toMatch(/nothing has been sent/i)
  })
})

describe('an unrecognised question is not answered', () => {
  it('returns null so the caller can decide, rather than inventing a reply', async () => {
    const ctx = ctxFor('admin')
    const { response, match } = await runSmartOps(ctx, 'why did the Henderson job go over budget')
    expect(response).toBeNull()
    expect(match).toBeNull()
  })
})

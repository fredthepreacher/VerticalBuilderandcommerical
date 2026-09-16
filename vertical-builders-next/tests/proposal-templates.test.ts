import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  proposalTemplateSchema, proposalTemplateLineSchema,
  FORBIDDEN_TEMPLATE_FIELDS, TEMPLATE_HEADER_FIELDS,
} from '../lib/ops/validations/proposal-template'
import { estimateLineSchema } from '../lib/ops/validations/estimate'

/**
 * ============================================================================
 * PROPOSAL TEMPLATES
 * ----------------------------------------------------------------------------
 * Two properties carry the whole feature, and both are easy to break by
 * accident later:
 *
 *   1. BLANK STAYS BLANK. A template line with no rate must arrive on the
 *      estimate with an empty rate box. If it ever defaults to 0, a customer
 *      gets a proposal quoting $0.00 for a roof.
 *
 *   2. NO CUSTOMER PII. Templates are shared and reused. If one carries a
 *      customer's address across, the next customer sees it.
 * ============================================================================
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ---------------------------------------------------------------------------
// Optional pricing
// ---------------------------------------------------------------------------

describe('a template may carry no pricing at all', () => {
  it('accepts a line with only a description and a unit', () => {
    // The client's actual case: "Tile roof replacement, SQ, measure it later".
    const parsed = proposalTemplateLineSchema.safeParse({
      description: 'Tile roof replacement', unit: 'SQ',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.default_quantity).toBeNull()
    expect(parsed.success && parsed.data.default_unit_price_cents).toBeNull()
  })

  it('keeps a blank rate NULL rather than turning it into zero', () => {
    // Zero is a price. Null is "not decided yet". Conflating them puts $0.00
    // on a customer's proposal.
    const parsed = proposalTemplateLineSchema.parse({
      description: 'Tear-off and haul away', unit: 'SQ',
      default_quantity: '', default_unit_price_cents: '',
    })
    expect(parsed.default_unit_price_cents).toBeNull()
    expect(parsed.default_quantity).toBeNull()
    expect(parsed.default_unit_price_cents).not.toBe(0)
  })

  it('still accepts a rate when the company does have a standing price', () => {
    const parsed = proposalTemplateLineSchema.parse({
      description: 'Permit fee', unit: 'EA', default_quantity: '1', default_unit_price_cents: '450',
    })
    expect(parsed.default_unit_price_cents).toBe(45_000)
    expect(parsed.default_quantity).toBe(1)
  })

  it('does not require a price book item', () => {
    const parsed = proposalTemplateLineSchema.parse({ description: 'Custom flashing detail' })
    expect(parsed.pricebook_item_id).toBeNull()
  })

  it('accepts a whole template with no prices anywhere', () => {
    const parsed = proposalTemplateSchema.safeParse({
      name: 'Tile Roof Proposal',
      service_type: 'Roofing',
      scope_summary: 'Full tile roof replacement including tear-off.',
      lines: [
        { description: 'Tear-off existing tile', unit: 'SQ' },
        { description: 'Underlayment', unit: 'SQ' },
        { description: 'Tile roof replacement', unit: 'SQ' },
      ],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.lines).toHaveLength(3)
    expect(parsed.success && parsed.data.lines.every(l => l.default_unit_price_cents === null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

describe('template naming', () => {
  it('requires a name', () => {
    const parsed = proposalTemplateSchema.safeParse({ name: '', lines: [] })
    expect(parsed.success).toBe(false)
    expect(parsed.success === false && parsed.error.issues[0].message).toMatch(/give the template a name/i)
  })

  it('rejects a name that is only whitespace', () => {
    expect(proposalTemplateSchema.safeParse({ name: '   ', lines: [] }).success).toBe(false)
  })

  it('refuses a name containing a customer email or phone', () => {
    // A template named "john@example.com roof" is a specific job somebody saved
    // by mistake, and it is about to be reused for a different customer.
    for (const name of ['john@example.com', 'Roof for john@example.com', 'Smith 941-555-0100']) {
      const parsed = proposalTemplateSchema.safeParse({ name, lines: [] })
      expect(parsed.success, `"${name}" was accepted`).toBe(false)
    }
  })

  it('accepts the names the client actually uses', () => {
    for (const name of [
      'Tile Roof Proposal', 'Roof Cleaning Proposal', 'Shingle Roof Proposal', 'Repair Proposal',
    ]) {
      expect(proposalTemplateSchema.safeParse({ name, lines: [] }).success, name).toBe(true)
    }
  })

  it('is not fooled by a version number that looks like a phone number', () => {
    expect(proposalTemplateSchema.safeParse({ name: 'Tile Roof v2', lines: [] }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// No PII
// ---------------------------------------------------------------------------

describe('a template can never carry customer data', () => {
  it('drops every forbidden field rather than storing it', () => {
    const withPii: Record<string, unknown> = { name: 'Tile Roof Proposal', lines: [] }
    for (const field of FORBIDDEN_TEMPLATE_FIELDS) withPii[field] = 'leaked'

    const parsed = proposalTemplateSchema.safeParse(withPii)
    // `.strict()` refuses unknown keys outright — a louder failure than
    // silently dropping them, which is what we want during development.
    expect(parsed.success).toBe(false)
  })

  it('the schema accepts exactly the proposal fields and nothing else', () => {
    const parsed = proposalTemplateSchema.parse({
      name: 'X', description: 'd', service_type: 'Roofing',
      scope_summary: 's', customer_notes: 'c', lines: [],
    })
    for (const field of TEMPLATE_HEADER_FIELDS) {
      expect(Object.keys(parsed), `${field} is missing`).toContain(field)
    }
    for (const field of FORBIDDEN_TEMPLATE_FIELDS) {
      expect(Object.keys(parsed), `${field} leaked in`).not.toContain(field)
    }
  })

  it('a template line has no customer-specific field either', () => {
    const parsed = proposalTemplateLineSchema.parse({ description: 'X' })
    for (const field of ['estimate_id', 'contact_id', 'lead_id', 'line_total_cents']) {
      expect(Object.keys(parsed), `${field} leaked in`).not.toContain(field)
    }
  })

  it('the save-from-estimate action selects proposal fields by name, not by exclusion', () => {
    // Subtractive copying leaks whatever field somebody adds to estimates next
    // year. This asserts the additive shape.
    const action = read('app/ops/actions/proposal-templates.ts')
    const select = action.slice(action.indexOf("from('estimates')"), action.indexOf("from('estimates')") + 400)
    expect(select).toMatch(/select\('id, service_type, scope_summary, customer_notes'\)/)
    for (const forbidden of ['contact_id', 'lead_id', 'project_id', 'property_address', 'estimate_number']) {
      expect(select, `${forbidden} is being read`).not.toMatch(new RegExp(`\\b${forbidden}\\b`))
    }
  })

  it('the line copy takes no customer identifiers either', () => {
    const action = read('app/ops/actions/proposal-templates.ts')
    const select = action.slice(action.indexOf("from('estimate_line_items')"))
      .slice(0, 300)
    expect(select).not.toMatch(/estimate_id,/)
  })
})

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

describe('applying a template', () => {
  const builder = read('components/ops/EstimateBuilder.tsx')

  it('replaces the line items and the proposal prose', () => {
    expect(builder).toMatch(/if \(template\.service_type\) setServiceType/)
    expect(builder).toMatch(/if \(template\.scope_summary\) setScope/)
    expect(builder).toMatch(/if \(template\.customer_notes\) setCustomerNotes/)
    expect(builder).toMatch(/setLines\(template\.lines\.length/)
  })

  it('never touches the client or the property', () => {
    // The single most damaging thing a template could do: overwrite whose job
    // this is, or where it is.
    const apply = builder.slice(builder.indexOf('function applyTemplate'), builder.indexOf('function move'))
    for (const field of [
      'lead_id', 'contact_id', 'project_id', 'property_address', 'city', 'state', 'zip',
    ]) {
      expect(apply, `applyTemplate writes ${field}`).not.toMatch(new RegExp(`${field}\\s*[:=]`))
    }
  })

  it('confirms before wiping work the operator has already done', () => {
    const apply = builder.slice(builder.indexOf('function applyTemplate'), builder.indexOf('function move'))
    expect(apply).toMatch(/const hasWork = lines\.some/)
    expect(apply).toMatch(/This will replace the current proposal line items/)
    expect(apply).toMatch(/Client and property information will not change/)
  })

  it('does not confirm when there is nothing to lose', () => {
    const apply = builder.slice(builder.indexOf('function applyTemplate'), builder.indexOf('function move'))
    expect(apply).toMatch(/if \(hasWork && !window\.confirm/)
  })

  it('carries a blank default across as a blank box', () => {
    const apply = builder.slice(builder.indexOf('function applyTemplate'), builder.indexOf('function move'))
    expect(apply).toMatch(/line\.default_quantity === null \? '' :/)
    expect(apply).toMatch(/line\.default_unit_price_cents === null\s*\?\s*'' :/)
  })

  it('reads the template and never writes it', () => {
    // Using a template must not change it, or two people building estimates
    // would edit each other's wording.
    const action = read('app/ops/actions/proposal-templates.ts')
    const load = action.slice(action.indexOf('export async function loadTemplateForEstimateAction'))
    expect(load).toMatch(/loadProposalTemplate/)
    expect(load).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/)
  })

  it('records where a line came from', () => {
    const apply = builder.slice(builder.indexOf('function applyTemplate'), builder.indexOf('function move'))
    expect(apply).toMatch(/source: 'template'/)
  })

  it('the estimate schema accepts the template source', () => {
    const parsed = estimateLineSchema.safeParse({ description: 'X', source: 'template' })
    expect(parsed.success).toBe(true)
  })

  it('and still accepts every source it accepted before', () => {
    for (const source of ['manual', 'pricebook', 'ai', 'measurement', 'import']) {
      expect(estimateLineSchema.safeParse({ description: 'X', source }).success, source).toBe(true)
    }
  })

  it('still rejects an invented source', () => {
    expect(estimateLineSchema.safeParse({ description: 'X', source: 'magic' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Independence
// ---------------------------------------------------------------------------

describe('templates and estimates are independent', () => {
  const service = read('lib/ops/services/proposal-templates.ts')

  it('duplicating produces a real copy, not a reference', () => {
    const dup = service.slice(service.indexOf('export async function duplicateProposalTemplate'))
    expect(dup).toMatch(/loadProposalTemplate/)
    expect(dup).toMatch(/saveProposalTemplate/)
    expect(dup).toMatch(/\(copy\)/)
  })

  it('archiving is soft and leaves estimates alone', () => {
    const archive = service.slice(service.indexOf('export async function archiveProposalTemplate'))
    expect(archive).toMatch(/archived_at/)
    expect(archive).not.toMatch(/\.delete\s*\(/)
    expect(archive).not.toMatch(/estimate_line_items/)
  })

  it('nothing in the template service reaches into estimates', () => {
    // Editing a template must never rewrite a proposal already sent.
    expect(service).not.toMatch(/from\('estimates'\)/)
    expect(service).not.toMatch(/from\('estimate_line_items'\)/)
  })
})

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe('permissions', () => {
  const action = read('app/ops/actions/proposal-templates.ts')

  it('every write requires pricebookManage — admin/office only', () => {
    for (const fn of [
      'saveProposalTemplateAction', 'duplicateProposalTemplateAction',
      'archiveProposalTemplateAction', 'saveEstimateAsTemplateAction',
    ]) {
      const body = action.slice(action.indexOf(`export async function ${fn}`))
        .slice(0, 400)
      expect(body, `${fn} is not gated`).toMatch(/requireCapability\('pricebookManage'\)/)
    }
  })

  it('read_only does not hold pricebookManage', () => {
    const permissions = read('lib/ops/auth/permissions.ts')
    const line = permissions.split('\n').find(l => l.includes('pricebookManage:')) ?? ''
    expect(line).not.toMatch(/read_only/)
    expect(line).not.toMatch(/project_manager/)
  })

  it('loading a template for an estimate needs only estimatesCreate', () => {
    // A project manager builds estimates, so they must be able to apply a
    // template even though they cannot edit one.
    const load = action.slice(action.indexOf('export async function loadTemplateForEstimateAction'))
    expect(load).toMatch(/requireCapability\('estimatesCreate'\)/)
  })

  it('the templates page is readable by anyone who can see estimates', () => {
    const page = read('app/ops/(app)/estimates/templates/page.tsx')
    expect(page).toMatch(/user\.can\('estimatesView'\)/)
    expect(page).toMatch(/user\.can\('pricebookManage'\)/)
  })
})

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('migration 0014', () => {
  const sql = read('supabase/migrations/0014_proposal_templates.sql')

  it('is additive — nothing is dropped or rewritten', () => {
    expect(sql).not.toMatch(/drop table/i)
    expect(sql).not.toMatch(/drop column/i)
    expect(sql).not.toMatch(/truncate/i)
    expect(sql).not.toMatch(/delete from/i)
    expect(sql).not.toMatch(/update public\.estimate/i)
  })

  it('makes both pricing columns nullable', () => {
    expect(sql).toMatch(/default_quantity numeric check/)
    expect(sql).toMatch(/default_unit_price_cents bigint check/)
    expect(sql).not.toMatch(/default_quantity numeric not null/)
    expect(sql).not.toMatch(/default_unit_price_cents bigint not null/)
  })

  it('enables and forces RLS on both tables', () => {
    expect(sql).toMatch(/enable row level security/)
    expect(sql).toMatch(/force  row level security/)
  })

  it('reads for anyone signed in, writes for staff only', () => {
    expect(sql).toMatch(/for select to authenticated using \(public\.can_read\(\)\)/)
    expect(sql).toMatch(/using \(public\.is_staff\(\)\) with check \(public\.is_staff\(\)\)/)
  })

  it('blocks anon', () => {
    expect(sql).toMatch(/revoke all[\s\S]{0,160}from anon/)
    expect(sql).not.toMatch(/grant[^\n]*to anon/i)
  })

  it('widens the estimate source check without narrowing it', () => {
    const check = sql.slice(sql.indexOf('estimate_line_items_source_check'))
    for (const source of ['manual', 'pricebook', 'ai', 'measurement', 'import', 'template']) {
      expect(check, `${source} was dropped`).toContain(`'${source}'`)
    }
  })

  it('does not touch leads, invoices, compliance or measurements', () => {
    for (const table of [
      'leads', 'invoices', 'insurance_certificates', 'vendors', 'roof_measurements', 'projects',
    ]) {
      expect(sql, `0014 alters ${table}`).not.toMatch(new RegExp(`alter table public\\.${table}\\b`))
    }
  })

  it('does not delete a template when its price book item goes away', () => {
    expect(sql).toMatch(/pricebook_item_id uuid references public\.pricebook_items\(id\) on delete set null/)
  })
})

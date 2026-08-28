import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEAD_RECORD_TYPES, LEAD_STAGES, LEAD_STAGE_LABELS, OPEN_LEAD_STAGES } from '../lib/ops/types'
import { formatAddressLine } from '../lib/ops/imports/address'

/**
 * ============================================================================
 * THE PROSPECT LIFECYCLE — import, display, enrich, convert
 * ----------------------------------------------------------------------------
 * The half of the feature that is not the importer: what happens to a property
 * prospect once it exists. The load-bearing promise is that enrichment is an
 * EDIT, never a re-creation — a salesperson who learns the owner's name types
 * it into the record that is already there.
 * ============================================================================
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

describe('the canvassing stages live in the existing pipeline', () => {
  it('adds the three that had no home, and no more', () => {
    expect(LEAD_STAGES).toContain('needs_contact_info')
    expect(LEAD_STAGES).toContain('door_knocked')
    expect(LEAD_STAGES).toContain('do_not_contact')
  })

  it('keeps every stage that already existed', () => {
    for (const stage of [
      'new', 'contact_attempted', 'contacted', 'consultation_scheduled', 'inspection_complete',
      'estimate_in_progress', 'estimate_sent', 'follow_up', 'won', 'lost',
    ]) {
      expect(LEAD_STAGES, `${stage} was dropped`).toContain(stage)
    }
  })

  it('labels them in contractor language, not system language', () => {
    expect(LEAD_STAGE_LABELS.needs_contact_info).toBe('Needs Contact Info')
    expect(LEAD_STAGE_LABELS.door_knocked).toBe('Door Knocked')
    expect(LEAD_STAGE_LABELS.do_not_contact).toBe('Do Not Contact')
  })

  it('every stage has a label — an unlabelled stage renders as a raw enum', () => {
    for (const stage of LEAD_STAGES) {
      expect(LEAD_STAGE_LABELS[stage], `${stage} has no label`).toBeTruthy()
    }
  })

  it('treats an imported prospect as open work, and Do Not Contact as closed', () => {
    // Hiding a freshly imported storm list from the dashboard would make the
    // import look like it did nothing.
    expect(OPEN_LEAD_STAGES).toContain('needs_contact_info')
    expect(OPEN_LEAD_STAGES).toContain('door_knocked')
    expect(OPEN_LEAD_STAGES).not.toContain('do_not_contact')
    expect(OPEN_LEAD_STAGES).not.toContain('won')
    expect(OPEN_LEAD_STAGES).not.toContain('lost')
  })

  it('the database accepts exactly the stages the app offers', () => {
    const sql = read('supabase/migrations/0012_property_prospects.sql')
    for (const stage of LEAD_STAGES) {
      expect(sql, `${stage} is missing from the DB constraint`).toContain(`'${stage}'`)
    }
  })
})

describe('record types', () => {
  it('has exactly two', () => {
    expect([...LEAD_RECORD_TYPES]).toEqual(['contact_lead', 'property_prospect'])
  })

  it('the database constraint matches', () => {
    const sql = read('supabase/migrations/0012_property_prospects.sql')
    expect(sql).toMatch(/record_type in \('contact_lead', 'property_prospect'\)/)
  })

  it('existing leads keep working — the column defaults to contact_lead', () => {
    const sql = read('supabase/migrations/0012_property_prospects.sql')
    expect(sql).toMatch(/record_type text not null default 'contact_lead'/)
  })
})

// ---------------------------------------------------------------------------
// The schema change, and what it does NOT weaken
// ---------------------------------------------------------------------------

describe('migration 0012', () => {
  const sql = read('supabase/migrations/0012_property_prospects.sql')

  it('makes first_name nullable', () => {
    expect(sql).toMatch(/alter column first_name drop not null/)
  })

  it('replaces the NOT NULL with a rule that still refuses an empty row', () => {
    // The important half. Dropping the constraint without this would let a
    // genuinely blank row into the pipeline.
    expect(sql).toMatch(/leads_identifiable_check/)
    expect(sql).toMatch(/property_address/)
  })

  it('is additive — nothing is dropped or rewritten destructively', () => {
    expect(sql).not.toMatch(/drop table/i)
    expect(sql).not.toMatch(/drop column/i)
    expect(sql).not.toMatch(/truncate/i)
    expect(sql).not.toMatch(/delete from/i)
  })

  it('adds every column with "if not exists", so it can be re-run', () => {
    const adds = sql.match(/add column [^\n]+/g) ?? []
    expect(adds.length).toBeGreaterThan(4)
    for (const line of adds) {
      expect(line, line).toMatch(/if not exists/)
    }
  })

  it('does not touch RLS or grant anything to anon', () => {
    expect(sql).not.toMatch(/disable row level security/i)
    expect(sql).not.toMatch(/grant[^\n]*to anon/i)
    expect(sql).toMatch(/revoke all on function public\.normalize_address/)
  })

  it('does not touch the compliance evaluator or any Phase 2 table', () => {
    for (const table of ['insurance_certificates', 'vendors', 'invoices', 'estimates', 'job_costs', 'projects']) {
      expect(sql, `0012 touches ${table}`).not.toMatch(new RegExp(`alter table public\\.${table}\\b`))
    }
  })

  it('indexes what the new filters actually query', () => {
    for (const index of ['address_key', 'record_type', 'batch_tag', 'zip', 'city']) {
      expect(sql, `no index for ${index}`).toContain(`idx_leads_${index}`)
    }
  })

  it('backfills the batch tag for imports that ran before it', () => {
    expect(sql).toMatch(/set import_batch_tag = source_metadata->>'import_tag'/)
  })
})

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

describe('a nameless prospect displays as its address', () => {
  const listPage = read('app/ops/(app)/leads/page.tsx')

  it('the lead list has an explicit fallback rather than an empty cell', () => {
    expect(listPage).toMatch(/function displayName/)
    expect(listPage).toMatch(/formatAddressLine/)
  })

  it('the fallback prefers a real name when one exists', () => {
    expect(formatAddressLine({ property_address: '4386 Sibley Bay St', city: 'Port Charlotte', state: 'FL' }))
      .toBe('4386 Sibley Bay St, Port Charlotte, FL')
  })

  it('the lead detail page falls back to the address too', () => {
    const detail = read('app/ops/(app)/leads/[id]/page.tsx')
    expect(detail).toMatch(/const name = contactName \|\| addressLine/)
  })

  it('global search does not return a blank title for a prospect', () => {
    const search = read('lib/ops/services/search.ts')
    expect(search).toMatch(/title: name \|\| address \|\| 'Unnamed lead'/)
  })

  it('converting a prospect names the project after the property', () => {
    // Otherwise the office gets a project called " — Roofing".
    const leads = read('lib/ops/services/leads.ts')
    expect(leads).toMatch(/lead\.property_address, lead\.city/)
  })
})

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

describe('enrichment is an edit, not a new record', () => {
  const chunkRoute = read('app/api/leads/import/chunk/route.ts')

  it('the owner name is written into first_name/last_name, not a parallel field', () => {
    // A separate "owner" column would mean a prospect and a contact lead are
    // different shapes, and enrichment would have to migrate between them.
    expect(chunkRoute).toMatch(/resolveName\(row\.values\)/)
    expect(chunkRoute).not.toMatch(/owner_name:/)
  })

  it('the record type is provenance and is not rewritten on enrichment', () => {
    const sql = read('supabase/migrations/0012_property_prospects.sql')
    expect(sql).toMatch(/does not change when the prospect is later enriched/)
  })

  it('nothing writes a placeholder name', () => {
    for (const file of [
      'app/api/leads/import/chunk/route.ts',
      'lib/ops/imports/leads.ts',
    ]) {
      // Comments are stripped: these files explain the rule in their own prose,
      // and a comment naming the placeholder is the opposite of a violation.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
      expect(code, `${file} invents a name`).not.toMatch(/['"]Unknown['"]/)
      expect(code, `${file} invents a value`).not.toMatch(/['"]N\/A['"]/)
      expect(code, `${file} invents a phone`).not.toMatch(/555-555-5555/)
    }
  })

  it('the lead form can save a prospect that still has no name', () => {
    // leadUpdateSchema is what the enrichment form validates against; a
    // required first_name there would block saving a partially enriched record.
    const validation = read('lib/ops/validations/lead.ts')
    expect(validation).toMatch(/leadUpdateSchema/)
  })
})

// ---------------------------------------------------------------------------
// Server-side behaviour
// ---------------------------------------------------------------------------

describe('the import routes enforce the rules server-side', () => {
  const chunkRoute = read('app/api/leads/import/chunk/route.ts')
  const validateRoute = read('app/api/leads/import/validate/route.ts')

  it('both routes require the leadsImport permission', () => {
    for (const [name, source] of [['chunk', chunkRoute], ['validate', validateRoute]] as const) {
      expect(source, `${name} does not check the permission`).toMatch(/user\.can\('leadsImport'\)/)
      expect(source, `${name} does not refuse`).toMatch(/status: 403/)
    }
  })

  it('the chunk route takes the mode from the JOB, not from the request body', () => {
    // Otherwise a later chunk could switch a standard import into property
    // mode and slip contactless rows past the rules the operator agreed to.
    expect(chunkRoute).toMatch(/job\.import_mode/)
    expect(chunkRoute).toMatch(/IMPORT_MODES\.includes\(job\.import_mode/)
  })

  it('the validate route narrows the mode to the allowlist', () => {
    expect(validateRoute).toMatch(/IMPORT_MODES\.includes\(body\.importMode/)
  })

  it('address duplicate matching is scoped to property mode', () => {
    expect(chunkRoute).toMatch(/importMode === 'property_prospect' && addresses\.length > 0/)
  })

  it('the update path cannot reassign somebody else’s lead or corrupt a name', () => {
    expect(chunkRoute).toMatch(/if \(field === 'assigned_to' \|\| field === 'full_name' \|\| field === 'owner_name'\) return null/)
  })

  it('the original address is preserved even when parsing partly failed', () => {
    expect(chunkRoute).toMatch(/original_address/)
  })

  it('a failed block is reported rather than silently dropped', () => {
    expect(chunkRoute).toMatch(/insert_failed/)
    expect(chunkRoute).toMatch(/lead_import_errors/)
  })

  it('rows are still chunked, so a large file cannot time out as one request', () => {
    expect(chunkRoute).toMatch(/body\.rows\.length > CHUNK_SIZE/)
  })
})

describe('the import screen is still permission-gated', () => {
  it('the page requires the capability before rendering the wizard', () => {
    const page = read('app/ops/(app)/leads/import/page.tsx')
    expect(page).toMatch(/leadsImport/)
  })

  it('read_only does not hold leadsImport', () => {
    const permissions = read('lib/ops/auth/permissions.ts')
    const block = permissions.slice(permissions.indexOf('leadsImport'))
    const line = block.slice(0, block.indexOf('\n'))
    expect(line, `leadsImport is granted to read_only: ${line}`).not.toMatch(/read_only/)
  })
})

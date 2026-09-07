import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from '../lib/ops/auth/permissions'
import { LEAD_STAGES } from '../lib/ops/types'
import { ACTION_LABELS } from '../lib/ops/services/activity'

/**
 * ============================================================================
 * SPAM LEAD REMOVAL
 * ----------------------------------------------------------------------------
 * "Remove" here means archive. The row stays, its history stays, and everything
 * attached to it stays. The tests are mostly about what must NOT happen:
 *
 *   · no hard delete, ever
 *   · no cascade into contacts, projects, estimates, invoices, notes, documents
 *   · a converted lead is refused outright — it is the origin of a real job
 *   · read_only and project_manager cannot do it
 * ============================================================================
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const crm = read('app/ops/actions/crm.ts')
const spam = crm.slice(crm.indexOf('export async function removeLeadAsSpam'))
const restore = crm.slice(crm.indexOf('export async function restoreLead'))
const removeOnly = crm.slice(
  crm.indexOf('export async function removeLeadAsSpam'),
  crm.indexOf('export async function restoreLead'),
)

// ---------------------------------------------------------------------------
// Soft, never hard
// ---------------------------------------------------------------------------

describe('removal is an archive, not a delete', () => {
  it('sets archived_at rather than deleting the row', () => {
    expect(removeOnly).toMatch(/archived_at: now/)
    expect(removeOnly).not.toMatch(/\.delete\s*\(/)
  })

  it('records why, so the archive is explicable months later', () => {
    expect(removeOnly).toMatch(/lost_reason: 'Spam'/)
    expect(removeOnly).toMatch(/spam_removed: true/)
    expect(removeOnly).toMatch(/spam_removed_at/)
    expect(removeOnly).toMatch(/spam_removed_by/)
  })

  it('merges into source_metadata instead of overwriting it', () => {
    // The lead's import batch, UTM attribution and address provenance all live
    // in that column. Replacing it would quietly destroy the audit trail.
    expect(removeOnly).toMatch(/\.\.\.\(\(lead\.source_metadata \?\? \{\}\) as Record<string, unknown>\)/)
  })

  it('moves the lead to a stage that means "do not work this"', () => {
    expect(removeOnly).toMatch(/pipeline_stage: 'do_not_contact'/)
    expect(LEAD_STAGES).toContain('do_not_contact')
  })

  it('remembers the stage it came from, so Restore is not a guess', () => {
    expect(removeOnly).toMatch(/stage_before_spam: lead\.pipeline_stage/)
    expect(restore).toMatch(/metadata\.stage_before_spam/)
  })

  it('touches only the leads table', () => {
    for (const table of ['contacts', 'projects', 'invoices', 'notes', 'documents', 'estimate_line_items']) {
      expect(removeOnly, `spam removal touches ${table}`).not.toMatch(new RegExp(`from\\('${table}'\\)`))
    }
  })

  it('counts linked estimates but never modifies them', () => {
    expect(removeOnly).toMatch(/from\('estimates'\)\.select\('id', \{ count: 'exact', head: true \}\)/)
    expect(removeOnly).not.toMatch(/from\('estimates'\)[\s\S]{0,120}\.(update|delete)\(/)
  })

  it('tells the operator their estimates were kept', () => {
    expect(removeOnly).toMatch(/attached to it were kept/)
  })
})

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

describe('a converted lead is protected', () => {
  it('is refused before anything is written', () => {
    expect(removeOnly).toMatch(/if \(lead\.converted_contact_id \|\| lead\.converted_project_id\)/)
    expect(removeOnly).toMatch(/cannot be removed as spam/)
  })

  it('the refusal explains what to do instead', () => {
    expect(removeOnly).toMatch(/Open the project or customer instead/)
  })

  it('the check comes before the update, not after', () => {
    const guard = removeOnly.indexOf('converted_contact_id ||')
    const update = removeOnly.indexOf('.update({')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(update)
  })

  it('the button is hidden for a converted lead as well', () => {
    const button = read('components/ops/RemoveSpamLeadButton.tsx')
    expect(button).toMatch(/if \(converted\) return null/)
  })
})

describe('an already-removed lead is refused', () => {
  it('cannot be removed twice', () => {
    expect(removeOnly).toMatch(/if \(lead\.archived_at\) return failure/)
  })

  it('and an active lead cannot be restored', () => {
    expect(restore).toMatch(/if \(!lead\.archived_at\) return failure/)
  })
})

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe('permissions', () => {
  it('both actions are admin/office only, matching the existing archive policy', () => {
    for (const [name, body] of [['remove', removeOnly], ['restore', restore]] as const) {
      expect(body, `${name} is not gated`).toMatch(/user\.role !== 'admin' && user\.role !== 'office'/)
      expect(body, `${name} does not refuse`).toMatch(/Only an owner\/admin or office user/)
    }
  })

  it('project_manager and read_only cannot reach it', () => {
    // Asserted against the role strings the guard actually compares, so a
    // widened guard fails this test rather than passing silently.
    expect(removeOnly).not.toMatch(/'project_manager'/)
    expect(removeOnly).not.toMatch(/'read_only'/)
  })

  it('read_only cannot create estimates either, so the quick action is hidden from them', () => {
    expect(CAPABILITIES.estimatesCreate).not.toContain('read_only')
    expect(CAPABILITIES.estimatesCreate).toContain('project_manager')
  })

  it('the UI only renders the danger action for admin/office', () => {
    const detail = read('app/ops/(app)/leads/[id]/page.tsx')
    expect(detail).toMatch(/user\.role === 'admin' \|\| user\.role === 'office'/)
  })
})

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

describe('audit trail', () => {
  it('logs the removal with the stage it came from', () => {
    expect(removeOnly).toMatch(/action: 'lead\.spam_removed'/)
    expect(removeOnly).toMatch(/previous_stage: lead\.pipeline_stage/)
  })

  it('logs the restore', () => {
    expect(restore).toMatch(/action: 'lead\.restored'/)
  })

  it('does not log the lead’s own content', () => {
    // A spam lead's body text is not activity-log material.
    const metadata = removeOnly.slice(removeOnly.indexOf('metadata: { previous_stage'))
      .slice(0, 200)
    expect(metadata).not.toMatch(/first_name|email|phone|property_address|project_description/)
  })

  it('both actions have a human-readable label', () => {
    expect(ACTION_LABELS['lead.spam_removed']).toBe('Lead removed as spam')
    expect(ACTION_LABELS['lead.restored']).toBe('Lead restored from the archive')
  })
})

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

describe('recovery', () => {
  const list = read('app/ops/(app)/leads/page.tsx')

  it('archived leads are hidden by default', () => {
    expect(list).toMatch(/query\.is\('archived_at', null\)/)
  })

  it('but reachable through an Archived view', () => {
    expect(list).toMatch(/const showArchived = searchParams\.show === 'archived'/)
    expect(list).toMatch(/query\.not\('archived_at', 'is', null\)/)
    expect(list).toMatch(/'\/ops\/leads\?show=archived'/)
  })

  it('the Archived view is offered only to the roles that can restore', () => {
    expect(list).toMatch(/user\.role === 'admin' \|\| user\.role === 'office'/)
  })

  it('restore clears the archive and the spam markers', () => {
    expect(restore).toMatch(/archived_at: null/)
    expect(restore).toMatch(/lost_reason: null/)
    expect(restore).toMatch(/delete metadata\.spam_removed/)
    expect(restore).toMatch(/delete metadata\.stage_before_spam/)
  })

  it('restore falls back to New rather than inventing a stage', () => {
    expect(restore).toMatch(/: 'new'/)
  })

  it('the archived lead page explains that nothing was deleted', () => {
    const detail = read('app/ops/(app)/leads/[id]/page.tsx')
    expect(detail).toMatch(/Nothing was deleted/)
  })
})

// ---------------------------------------------------------------------------
// The confirmation
// ---------------------------------------------------------------------------

describe('the confirmation is a sentence, not a red icon', () => {
  const button = read('components/ops/RemoveSpamLeadButton.tsx')

  it('asks before acting', () => {
    expect(button).toMatch(/Remove this lead as spam\?/)
    expect(button).toMatch(/const \[confirming, setConfirming\] = useState\(false\)/)
  })

  it('says what will and will not happen', () => {
    expect(button).toMatch(/disappear from the active pipeline/)
    expect(button).toMatch(/audit history will be retained/)
    expect(button).toMatch(/notes, documents, estimates — is kept/)
    expect(button).toMatch(/restore it/)
  })

  it('offers Cancel first', () => {
    const actions = button.slice(button.indexOf('ops-confirm-actions'))
    expect(actions.indexOf('Cancel')).toBeLessThan(actions.indexOf('Remove as spam'))
  })

  it('is a labelled button, not an unexplained bin', () => {
    expect(button).toMatch(/Remove as spam/)
    expect(button).not.toMatch(/Trash2/)
  })

  it('works without hover — it is a tap target on a phone', () => {
    expect(button).toMatch(/onClick=/)
    expect(button).not.toMatch(/onMouseOver|:hover/)
  })
})

// ---------------------------------------------------------------------------
// Import and duplicate detection are unaffected
// ---------------------------------------------------------------------------

describe('archived spam does not disturb the importer', () => {
  it('duplicate lookups still exclude archived leads, so spam cannot block a real re-import', () => {
    // If a spam lead kept matching on its email, re-importing that address as a
    // genuine customer would be silently skipped as a duplicate.
    const validate = read('app/api/leads/import/validate/route.ts')
    const chunk = read('app/api/leads/import/chunk/route.ts')
    for (const [name, source] of [['validate', validate], ['chunk', chunk]] as const) {
      const lookups = source.match(/from\('leads'\)[\s\S]{0,220}?\.is\('archived_at', null\)/g) ?? []
      expect(lookups.length, `${name} has an unfiltered duplicate lookup`).toBeGreaterThan(0)
    }
  })

  it('the address key index also ignores archived rows', () => {
    const sql = read('supabase/migrations/0012_property_prospects.sql')
    expect(sql).toMatch(/idx_leads_address_key[\s\S]{0,120}archived_at is null/)
  })

  it('spam removal does not touch the import batch tag or the address key', () => {
    expect(removeOnly).not.toMatch(/import_batch_tag/)
    expect(removeOnly).not.toMatch(/address_key/)
    expect(removeOnly).not.toMatch(/property_address:/)
  })

  it('nothing mass-marks imported leads as spam', () => {
    // No migration and no importer path may set this in bulk.
    for (const file of [
      'supabase/migrations/0014_proposal_templates.sql',
      'app/api/leads/import/chunk/route.ts',
    ]) {
      expect(read(file), `${file} sets spam`).not.toMatch(/spam_removed/)
    }
  })
})

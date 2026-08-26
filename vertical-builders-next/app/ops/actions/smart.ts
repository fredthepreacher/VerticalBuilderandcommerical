'use server'

import { requireUser, requireCapability } from '@/lib/ops/auth/require-user'
import { can } from '@/lib/ops/auth/permissions'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { getSettings } from '@/lib/ops/services/settings'
import { logAiRun } from '@/lib/ops/services/ai-runs'
import { collectAuditFacts, collectDashboardFacts } from '@/lib/ops/smart/facts'
import { buildSmartAuditBrief, buildSmartDashboardBrief } from '@/lib/ops/smart/briefs'
import { parseLeadNotes } from '@/lib/ops/smart/lead-parser'
import { failure, handleUnexpected, str, success, type ActionState } from '@/lib/ops/actions-shared'

/**
 * ============================================================================
 * SMART OPS SERVER ACTIONS — deterministic, zero provider cost
 * ----------------------------------------------------------------------------
 * Everything in this file runs entirely inside the application: a query, a
 * calculation, a template. Nothing here imports the AI provider, and a test
 * asserts that, which is what makes "works with no OpenAI key" a property of
 * the code rather than a claim in a README.
 *
 * Like the AI actions, nothing here writes an operational record. The lead
 * parser returns a draft for the ordinary form; the briefs are read-only.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export async function generateSmartDashboardBriefAction(): Promise<ActionState> {
  try {
    const user = await requireUser()
    const supabase = createSupabaseServerClient()

    // Receivables are excluded for any account that cannot see them — the
    // query does not run, so the numbers cannot reach the response at all.
    const includeFinancial = can(user.role, 'invoicesView') && user.role !== 'read_only'
    const facts = await collectDashboardFacts(supabase, { includeFinancial })
    const brief = buildSmartDashboardBrief(facts, user.profile.full_name || user.email)

    await logAiRun(supabase, {
      userId: user.id,
      feature: 'smart_brief',
      mode: 'smart_ops',
      outputSummary: { bullets: brief.bullets.length, includeFinancial },
    })

    return success('Brief ready.', {
      brief: JSON.stringify(brief),
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return handleUnexpected('smart-dashboard-brief', error)
  }
}

export async function generateSmartAuditBriefAction(
  period: { start: string; end: string } | null,
): Promise<ActionState> {
  try {
    const user = await requireUser()
    const supabase = createSupabaseServerClient()

    const facts = await collectAuditFacts(supabase, period)
    const brief = buildSmartAuditBrief(facts)

    await logAiRun(supabase, {
      userId: user.id,
      feature: 'smart_audit_brief',
      mode: 'smart_ops',
      outputSummary: {
        blockers: brief.criticalBlockers.length,
        expiring: brief.expiringSoon.length,
        needsReview: brief.needsHumanReview.length,
      },
    })

    return success('Brief ready.', { brief: JSON.stringify(brief) })
  } catch (error) {
    return handleUnexpected('smart-audit-brief', error)
  }
}

// ---------------------------------------------------------------------------
// Built-in lead extraction
// ---------------------------------------------------------------------------

export async function structureLeadWithSmartOpsAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const notes = str(form, 'notes') ?? ''
    if (notes.trim().length < 5) {
      return failure('Paste your notes first.')
    }

    const parsed = parseLeadNotes(notes)
    const supabase = createSupabaseServerClient()
    await logAiRun(supabase, {
      userId: user.id,
      feature: 'smart_lead_parse',
      mode: 'smart_ops',
      entityType: 'lead',
      inputRefs: { noteChars: notes.length },
      outputSummary: { found: parsed.found.length },
    })

    const message = parsed.found.length
      ? `Found ${parsed.found.join(', ')} — check every field before saving.`
      : 'Nothing could be read automatically. Your notes have been kept in the description.'

    // A draft for the ordinary form. Nothing is saved here.
    return success(message, { draft: JSON.stringify(parsed) })
  } catch (error) {
    return handleUnexpected('smart-lead-parse', error)
  }
}

// ---------------------------------------------------------------------------
// Settings visibility helper
// ---------------------------------------------------------------------------

/** Whether the caller's account may see receivables in a brief. */
export async function smartBriefIncludesFinancial(): Promise<boolean> {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  await getSettings(supabase)
  return can(user.role, 'invoicesView') && user.role !== 'read_only'
}

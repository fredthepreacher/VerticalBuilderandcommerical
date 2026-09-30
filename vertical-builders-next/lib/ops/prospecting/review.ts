import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '../services/activity'
import type { ProspectStatus, ScreeningDecision } from './constants'

/**
 * ============================================================================
 * REVIEW DECISIONS — persist + audit + optimistic concurrency
 * ----------------------------------------------------------------------------
 * Each decision maps to an existing status + screening_decision, records who
 * decided it and when, bumps a version, and logs to the shared activity log. The
 * version is the concurrency guard: the console sends the version it read, and a
 * write whose version no longer matches is refused so two reviewers cannot
 * silently overwrite each other. Nothing is hard-deleted — reopening returns a
 * prospect to the queue, it does not erase the history.
 * ============================================================================
 */

export type ReviewAction =
  | 'approve'
  | 'reject_new_roof'
  | 'reject_wrong_roof_type'
  | 'reject_duplicate'
  | 'reject_bad_address'
  | 'reject_not_opportunity'
  | 'manual_measurement'
  | 'follow_up'

interface ActionSpec {
  status: ProspectStatus
  decision: ScreeningDecision
  label: string
}

export const REVIEW_ACTIONS: Record<ReviewAction, ActionSpec> = {
  approve:                { status: 'qualified',                     decision: 'qualify',               label: 'Approved' },
  reject_new_roof:        { status: 'disqualified_new_roof',         decision: 'reject_new_roof',       label: 'Rejected — recent/new roof' },
  reject_wrong_roof_type: { status: 'disqualified_wrong_roof_type',  decision: 'reject_wrong_roof_type',label: 'Rejected — wrong roof type' },
  reject_duplicate:       { status: 'duplicate',                     decision: 'reject_duplicate',      label: 'Rejected — duplicate' },
  reject_bad_address:     { status: 'disqualified_bad_address',      decision: 'reject_bad_address',    label: 'Rejected — bad address' },
  reject_not_opportunity: { status: 'disqualified_not_opportunity',  decision: 'reject_not_opportunity',label: 'Rejected — not an opportunity' },
  manual_measurement:     { status: 'manual_measurement_required',   decision: 'manual_measurement',    label: 'Manual measurement requested' },
  follow_up:              { status: 'follow_up',                     decision: 'needs_follow_up',       label: 'Flagged for follow-up' },
}

export interface ReviewResult {
  ok: boolean
  conflict?: boolean
  error?: string
  status?: ProspectStatus
  reviewVersion?: number
}

/**
 * Applies a review decision under optimistic concurrency. `expectedVersion` is
 * the review_version the operator's console last saw.
 */
export async function reviewProspect(
  supabase: SupabaseClient,
  input: { prospectId: string; action: ReviewAction; note?: string | null; expectedVersion: number; userId: string },
): Promise<ReviewResult> {
  const spec = REVIEW_ACTIONS[input.action]
  if (!spec) return { ok: false, error: 'Unknown review action.' }

  const { data: current } = await supabase
    .from('roof_prospects')
    .select('id, review_version, status, converted_lead_id')
    .eq('id', input.prospectId)
    .maybeSingle()
  if (!current) return { ok: false, error: 'Prospect not found.' }

  // A prospect already converted to a lead should not be silently re-decided.
  if (current.converted_lead_id && spec.status !== 'qualified') {
    return { ok: false, error: 'This prospect has already become a CRM lead and cannot be rejected here.' }
  }

  if ((current.review_version as number) !== input.expectedVersion) {
    return { ok: false, conflict: true, error: 'Someone else updated this prospect. Reloaded to show their decision.' }
  }

  const nextVersion = (current.review_version as number) + 1
  const { error } = await supabase
    .from('roof_prospects')
    .update({
      status: spec.status,
      screening_decision: spec.decision,
      review_note: input.note?.slice(0, 2000) ?? null,
      reviewed_by: input.userId,
      reviewed_at: new Date().toISOString(),
      review_version: nextVersion,
    })
    .eq('id', input.prospectId)
    .eq('review_version', input.expectedVersion) // concurrency guard at the DB, too
  if (error) {
    console.error('[review] update failed', error)
    return { ok: false, error: 'The decision could not be saved.' }
  }

  await logActivity(supabase, {
    action: 'prospecting.reviewed', entityType: 'roof_prospect', entityId: input.prospectId,
    actorUserId: input.userId, metadata: { decision: input.action, status: spec.status, note: input.note ?? undefined },
  })

  return { ok: true, status: spec.status, reviewVersion: nextVersion }
}

/** Reopens a reviewed prospect back into the queue. History is preserved (audit log). */
export async function reopenProspect(
  supabase: SupabaseClient,
  input: { prospectId: string; expectedVersion: number; userId: string },
): Promise<ReviewResult> {
  const { data: current } = await supabase
    .from('roof_prospects').select('id, review_version, converted_lead_id').eq('id', input.prospectId).maybeSingle()
  if (!current) return { ok: false, error: 'Prospect not found.' }
  if (current.converted_lead_id) {
    return { ok: false, error: 'This prospect already became a CRM lead; reopening it here is not allowed.' }
  }
  if ((current.review_version as number) !== input.expectedVersion) {
    return { ok: false, conflict: true, error: 'Someone else updated this prospect.' }
  }
  const nextVersion = (current.review_version as number) + 1
  const { error } = await supabase
    .from('roof_prospects')
    .update({ status: 'review_required', screening_decision: null, reviewed_by: null, reviewed_at: null, review_version: nextVersion })
    .eq('id', input.prospectId).eq('review_version', input.expectedVersion)
  if (error) return { ok: false, error: 'Could not reopen the prospect.' }
  await logActivity(supabase, {
    action: 'prospecting.reopened', entityType: 'roof_prospect', entityId: input.prospectId, actorUserId: input.userId,
  })
  return { ok: true, status: 'review_required', reviewVersion: nextVersion }
}

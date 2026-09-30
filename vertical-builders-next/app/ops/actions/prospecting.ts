'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCapability } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { saveCampaign, archiveCampaign } from '@/lib/ops/prospecting/campaigns'
import { campaignSchema } from '@/lib/ops/validations/prospecting'
import { reviewProspect, reopenProspect, type ReviewAction } from '@/lib/ops/prospecting/review'
import { enterManualMeasurement } from '@/lib/ops/prospecting/manual-measurement'
import { failure, handleUnexpected, str, bool, strList, success, zodToState, type ActionState } from '@/lib/ops/actions-shared'

/**
 * ============================================================================
 * ROOF PROSPECTING ACTIONS
 * ----------------------------------------------------------------------------
 * Campaign configuration is `prospectingManage` (admin/office) — the same tier
 * that manages the pricebook and lead imports, because a campaign decides how
 * imported county data is priced and mailed. read_only and project managers
 * cannot reach these.
 *
 * The actual import writes go through the chunked API routes, not a server
 * action, so they can stream progress and stay resumable — the same design the
 * lead importer uses.
 * ============================================================================
 */

const PROSPECTING_PATH = '/ops/prospecting'

function parseCampaignForm(form: FormData) {
  const num = (key: string) => {
    const v = str(form, key)
    return v === undefined ? undefined : v
  }
  return {
    name: str(form, 'name') ?? '',
    county: str(form, 'county'),
    data_source: str(form, 'data_source'),
    roof_types: strList(form, 'roof_types'),
    permit_date_from: str(form, 'permit_date_from'),
    permit_date_to: str(form, 'permit_date_to'),
    min_roof_age_years: num('min_roof_age_years'),
    waste_rule_type: str(form, 'waste_rule_type') ?? 'percent',
    waste_rule_value: num('waste_rule_value'),
    waste_min_squares: num('waste_min_squares'),
    pricebook_service_type: str(form, 'pricebook_service_type'),
    proposal_template_id: str(form, 'proposal_template_id'),
    default_batch_size: num('default_batch_size'),
    mail_tag: str(form, 'mail_tag'),
    active: form.get('active') === null ? true : bool(form, 'active'),
  }
}

export async function saveCampaignAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requireCapability('prospectingManage')
  } catch {
    return failure('Your role does not allow managing prospecting campaigns.')
  }

  const parsed = campaignSchema.safeParse(parseCampaignForm(form))
  if (!parsed.success) return zodToState(parsed.error)

  const campaignId = str(form, 'campaign_id')
  let id: string
  try {
    const supabase = createSupabaseServerClient()
    const result = await saveCampaign(supabase, parsed.data, { userId: user.id, campaignId })
    id = result.id
  } catch (error) {
    return handleUnexpected('saveCampaign', error)
  }

  revalidatePath(PROSPECTING_PATH)
  revalidatePath(`${PROSPECTING_PATH}/campaigns`)
  redirect(`${PROSPECTING_PATH}/campaigns/${id}?saved=1`)
}

export async function archiveCampaignAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requireCapability('prospectingManage')
  } catch {
    return failure('Your role does not allow managing prospecting campaigns.')
  }
  const id = str(form, 'campaign_id')
  if (!id) return failure('No campaign specified.')

  try {
    const supabase = createSupabaseServerClient()
    await archiveCampaign(supabase, id, { userId: user.id })
  } catch (error) {
    return handleUnexpected('archiveCampaign', error)
  }
  revalidatePath(PROSPECTING_PATH)
  revalidatePath(`${PROSPECTING_PATH}/campaigns`)
  return success('Campaign archived.')
}

// ============================================================================
// Phase 3A — review, manual measurement, reopen
// ============================================================================

export async function reviewProspectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try { user = await requireCapability('prospectingManage') }
  catch { return failure('Your role does not allow reviewing prospects.') }

  const prospectId = str(form, 'prospect_id')
  const action = str(form, 'action') as ReviewAction | undefined
  const note = str(form, 'note')
  const expectedVersion = Number(str(form, 'expected_version') ?? '')
  if (!prospectId || !action) return failure('Missing prospect or decision.')
  if (!Number.isInteger(expectedVersion)) return failure('Missing review version.')

  try {
    const supabase = createSupabaseServerClient()
    const result = await reviewProspect(supabase, { prospectId, action, note: note ?? null, expectedVersion, userId: user.id })
    if (!result.ok) {
      return result.conflict
        ? { ...failure(result.error ?? 'Conflict.'), data: { conflict: true } }
        : failure(result.error ?? 'The decision could not be saved.')
    }
    revalidatePath(`${PROSPECTING_PATH}/review`)
    return success('Saved.', { status: result.status, reviewVersion: result.reviewVersion })
  } catch (error) {
    return handleUnexpected('reviewProspect', error)
  }
}

export async function reopenProspectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try { user = await requireCapability('prospectingManage') }
  catch { return failure('Your role does not allow reviewing prospects.') }
  const prospectId = str(form, 'prospect_id')
  const expectedVersion = Number(str(form, 'expected_version') ?? '')
  if (!prospectId || !Number.isInteger(expectedVersion)) return failure('Missing prospect or version.')
  try {
    const supabase = createSupabaseServerClient()
    const result = await reopenProspect(supabase, { prospectId, expectedVersion, userId: user.id })
    if (!result.ok) return failure(result.error ?? 'Could not reopen.')
    revalidatePath(`${PROSPECTING_PATH}/review`)
    return success('Reopened.', { status: result.status, reviewVersion: result.reviewVersion })
  } catch (error) {
    return handleUnexpected('reopenProspect', error)
  }
}

export async function enterManualMeasurementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try { user = await requireCapability('measurementsCreate') }
  catch { return failure('Your role does not allow entering measurements.') }
  const prospectId = str(form, 'prospect_id')
  if (!prospectId) return failure('Missing prospect.')
  const squaresRaw = str(form, 'squares')
  const sqftRaw = str(form, 'sqft')
  const squares = squaresRaw ? Number(squaresRaw) : null
  const sqft = sqftRaw ? Number(sqftRaw) : null
  if ((squares == null || !Number.isFinite(squares)) && (sqft == null || !Number.isFinite(sqft))) {
    return failure('Enter roof squares or square footage.')
  }
  try {
    const supabase = createSupabaseServerClient()
    const result = await enterManualMeasurement(supabase, { prospectId, squares, sqft, note: str(form, 'note') ?? null, userId: user.id })
    if (!result.ok) return failure(result.error ?? 'The measurement could not be saved.')
    revalidatePath(`${PROSPECTING_PATH}/review`)
    return success('Measurement saved.', { finalSquares: result.finalSquares, status: result.status })
  } catch (error) {
    return handleUnexpected('enterManualMeasurement', error)
  }
}

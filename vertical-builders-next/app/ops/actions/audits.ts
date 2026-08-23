'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCapability } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { logActivity } from '@/lib/ops/services/activity'
import { buildAuditPackage } from '@/lib/ops/services/audits'
import { auditCycleSchema, auditFilterSchema } from '@/lib/ops/validations/audit'
import {
  failure, handleUnexpected, str, strList, success, zodToState, type ActionState,
} from '@/lib/ops/actions-shared'

export async function saveAuditCycle(
  cycleId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('manageAuditCycles')
    const supabase = createSupabaseServerClient()

    const parsed = auditCycleSchema.safeParse({
      name: str(form, 'name') ?? '',
      audit_period_start: str(form, 'audit_period_start') ?? '',
      audit_period_end: str(form, 'audit_period_end') ?? '',
      due_date: str(form, 'due_date') ?? '',
      status: str(form, 'status') ?? 'draft',
      notes: str(form, 'notes') ?? '',
    })
    if (!parsed.success) return zodToState(parsed.error)

    if (cycleId) {
      const { error } = await supabase.from('audit_cycles').update(parsed.data).eq('id', cycleId)
      if (error) return failure('The audit cycle could not be saved.')
      revalidatePath(`/ops/audits/${cycleId}`)
      return success('Audit cycle saved.')
    }

    const { data, error } = await supabase.from('audit_cycles')
      .insert({ ...parsed.data, created_by: user.id }).select('id').single()
    if (error || !data) return failure('The audit cycle could not be created.')

    await logActivity(supabase, {
      action: 'audit.cycle_created', entityType: 'audit_cycle', entityId: data.id, actorUserId: user.id,
      metadata: { name: parsed.data.name, period: `${parsed.data.audit_period_start}..${parsed.data.audit_period_end}` },
    })

    revalidatePath('/ops/audits')
    redirect(`/ops/audits/${data.id}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveAuditCycle', error)
  }
}

/**
 * Generates a NEW audit package. Never overwrites a previous one — each run
 * writes a new object and a new audit_exports row so a package handed to an
 * auditor months ago still downloads exactly as it did then.
 */
export async function generateAuditPackage(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('generateAuditPackage')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()

    const auditCycleId = str(form, 'audit_cycle_id')
    if (!auditCycleId) return failure('Audit cycle is required.')

    const filters = auditFilterSchema.parse({
      projectIds: strList(form, 'project_ids'),
      vendorIds: strList(form, 'vendor_ids'),
      trades: strList(form, 'trades'),
      vendorStatuses: strList(form, 'vendor_statuses'),
      complianceStatuses: strList(form, 'compliance_statuses'),
      coverageTypes: strList(form, 'coverage_types'),
      includeDocuments: form.get('include_documents') !== null,
    })

    const result = await buildAuditPackage(supabase, admin, {
      auditCycleId, filters, actorUserId: user.id,
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath(`/ops/audits/${auditCycleId}`)
    return success(
      `Package generated: ${result.summary!.vendorsIncluded} subcontractor(s), ` +
      `${result.summary!.policyLinesIncluded} policy line(s), ${result.summary!.documentsIncluded} document(s).` +
      (result.warnings?.length ? ` Notes: ${result.warnings.join(' ')}` : ''),
      { exportId: result.exportId!, filename: result.filename! },
    )
  } catch (error) {
    return handleUnexpected('generateAuditPackage', error)
  }
}

function isRedirect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
}

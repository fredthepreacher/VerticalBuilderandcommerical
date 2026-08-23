'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireCapability } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { logActivity } from '@/lib/ops/services/activity'
import { createCertificate, reviewCertificate } from '@/lib/ops/services/certificates'
import { refreshAllVendors, refreshVendorCompliance } from '@/lib/ops/services/compliance'
import { uploadDocument } from '@/lib/ops/services/documents'
import { getSettings } from '@/lib/ops/services/settings'
import {
  assignVendorToProject, requestRenewal, revokeUploadToken, unassignVendorFromProject,
} from '@/lib/ops/services/vendors'
import { certificateSchema, waiverSchema } from '@/lib/ops/validations/certificate'
import { vendorSchema } from '@/lib/ops/validations/vendor'
import { COVERAGE_TYPES, type CoverageType, type DocumentType } from '@/lib/ops/types'
import {
  failure, handleUnexpected, str, strList, success, zodToState, type ActionState,
} from '@/lib/ops/actions-shared'

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export async function saveVendor(
  vendorId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()

    const parsed = vendorSchema.safeParse({
      legal_name: str(form, 'legal_name') ?? '',
      dba: str(form, 'dba'),
      vendor_type: str(form, 'vendor_type') ?? 'subcontractor',
      primary_trade: str(form, 'primary_trade'),
      trades: strList(form, 'trades'),
      status: str(form, 'status') ?? 'pending',
      contact_first_name: str(form, 'contact_first_name'),
      contact_last_name: str(form, 'contact_last_name'),
      email: str(form, 'email') ?? '',
      phone: str(form, 'phone'),
      secondary_contact: str(form, 'secondary_contact'),
      address: str(form, 'address'),
      city: str(form, 'city'),
      state: str(form, 'state'),
      zip: str(form, 'zip'),
      ein_last4: str(form, 'ein_last4') ?? '',
      license_number: str(form, 'license_number'),
      license_type: str(form, 'license_type'),
      license_expiration_date: str(form, 'license_expiration_date') ?? '',
      w9_status: str(form, 'w9_status') ?? 'missing',
      default_requirement_template_id: str(form, 'default_requirement_template_id') ?? '',
      notes: str(form, 'notes'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    if (vendorId) {
      const { error } = await supabase.from('vendors').update(parsed.data).eq('id', vendorId)
      if (error) return failure('The subcontractor could not be saved.')
      await logActivity(supabase, {
        action: 'record.updated', entityType: 'vendor', entityId: vendorId, actorUserId: user.id,
      })
      // Trade or template changes can change which requirements apply.
      await refreshVendorCompliance(supabase, vendorId)
      revalidatePath(`/ops/subcontractors/${vendorId}`)
      revalidatePath('/ops/compliance')
      return success('Subcontractor saved.')
    }

    const { data, error } = await supabase.from('vendors').insert(parsed.data).select('id').single()
    if (error || !data) return failure('The subcontractor could not be created.')
    await logActivity(supabase, {
      action: 'record.created', entityType: 'vendor', entityId: data.id, actorUserId: user.id,
    })
    await refreshVendorCompliance(supabase, data.id as string)
    revalidatePath('/ops/subcontractors')
    redirect(`/ops/subcontractors/${data.id}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveVendor', error)
  }
}

export async function assignVendor(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('assignVendorToProject')
    const supabase = createSupabaseServerClient()
    const projectId = str(form, 'project_id')
    const vendorId = str(form, 'vendor_id')
    if (!projectId || !vendorId) return failure('Choose a subcontractor first.')

    const result = await assignVendorToProject(supabase, {
      projectId, vendorId,
      scopeOfWork: str(form, 'scope_of_work') ?? null,
      startDate: str(form, 'start_date') ?? null,
      endDate: str(form, 'end_date') ?? null,
      actorUserId: user.id,
    })
    if (!result.ok) return failure(result.error!)
    revalidatePath(`/ops/projects/${projectId}`)
    revalidatePath(`/ops/subcontractors/${vendorId}`)
    return success('Subcontractor assigned to the project.')
  } catch (error) {
    return handleUnexpected('assignVendor', error)
  }
}

export async function unassignVendor(projectId: string, vendorId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('assignVendorToProject')
    const supabase = createSupabaseServerClient()
    await unassignVendorFromProject(supabase, { projectId, vendorId, actorUserId: user.id })
    revalidatePath(`/ops/projects/${projectId}`)
    return success('Subcontractor removed from the project.')
  } catch (error) {
    return handleUnexpected('unassignVendor', error)
  }
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

/**
 * Manual COI entry — the workflow that must work with no AI key at all.
 * File upload, certificate header, and one or more coverage lines in one save.
 */
export async function saveCertificate(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('uploadDocuments')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()
    const settings = await getSettings(supabase)

    const vendorId = str(form, 'vendor_id')
    if (!vendorId) return failure('Choose a subcontractor first.')

    // 1. coverage lines
    const policies = parsePolicyLines(form)
    if (policies.length === 0) {
      return failure('Add at least one coverage line — a certificate with no policy rows cannot be evaluated.')
    }

    const parsed = certificateSchema.safeParse({
      vendor_id: vendorId,
      issue_date: str(form, 'issue_date') ?? '',
      received_at: str(form, 'received_at') ?? '',
      broker_name: str(form, 'broker_name'),
      broker_contact_name: str(form, 'broker_contact_name'),
      broker_email: str(form, 'broker_email') ?? '',
      broker_phone: str(form, 'broker_phone'),
      named_insured: str(form, 'named_insured'),
      certificate_holder: str(form, 'certificate_holder'),
      source: str(form, 'source') ?? 'admin_upload',
      reviewer_notes: str(form, 'reviewer_notes'),
      project_ids: strList(form, 'project_ids'),
      policies,
    })
    if (!parsed.success) return zodToState(parsed.error)

    // 2. optional source document
    let documentId: string | null = null
    const file = form.get('certificate_file')
    if (file instanceof File && file.size > 0) {
      const upload = await uploadDocument(admin, {
        file,
        entityType: 'vendor',
        entityId: vendorId,
        documentType: 'coi',
        documentDate: parsed.data.issue_date ?? null,
        expirationDate: earliestExpiration(policies),
        uploadedBy: user.id,
        maxBytes: settings.max_upload_mb * 1024 * 1024,
      })
      if (!upload.ok) return failure(upload.error!)
      documentId = upload.document!.id
    }

    // 3. the certificate itself (creates a new version, never overwrites)
    const replaces = str(form, 'replaces_certificate_id') ?? null
    const result = await createCertificate(
      supabase,
      { ...parsed.data, document_id: documentId },
      user.id,
      { replacesCertificateId: replaces },
    )
    if (!result.ok) return failure(result.error!)

    revalidatePath(`/ops/subcontractors/${vendorId}`)
    revalidatePath('/ops/compliance')
    revalidatePath('/ops/dashboard')
    redirect(`/ops/subcontractors/${vendorId}?tab=insurance&saved=1`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveCertificate', error)
  }
}

export async function reviewCertificateAction(
  certificateId: string,
  decision: 'approved' | 'rejected',
  notes: string | null,
): Promise<ActionState> {
  try {
    const user = await requireCapability('reviewCertificate')
    const supabase = createSupabaseServerClient()
    const result = await reviewCertificate(supabase, {
      certificateId, decision, notes, actorUserId: user.id,
    })
    if (!result.ok) return failure(result.error!)
    revalidatePath('/ops/compliance')
    revalidatePath('/ops/dashboard')
    return success(decision === 'approved' ? 'Certificate approved.' : 'Certificate rejected.')
  } catch (error) {
    return handleUnexpected('reviewCertificate', error)
  }
}

// ---------------------------------------------------------------------------
// Waivers (documented exceptions)
// ---------------------------------------------------------------------------

export async function addWaiver(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('approveWaiver')
    const supabase = createSupabaseServerClient()

    const parsed = waiverSchema.safeParse({
      vendor_id: str(form, 'vendor_id') ?? '',
      project_id: str(form, 'project_id') ?? '',
      coverage_type: str(form, 'coverage_type'),
      requirement_id: str(form, 'requirement_id') ?? '',
      reason: str(form, 'reason') ?? '',
      expires_at: str(form, 'expires_at') ?? '',
    })
    if (!parsed.success) return zodToState(parsed.error)

    const { error } = await supabase.from('compliance_waivers').insert({
      ...parsed.data,
      approved_by: user.id,
    })
    if (error) return failure('The exception could not be saved.')

    await logActivity(supabase, {
      action: 'waiver.added',
      entityType: 'vendor',
      entityId: parsed.data.vendor_id,
      actorUserId: user.id,
      metadata: {
        coverage_type: parsed.data.coverage_type ?? 'all',
        reason: parsed.data.reason,
        expires_at: parsed.data.expires_at ?? null,
      },
    })

    await refreshVendorCompliance(supabase, parsed.data.vendor_id)
    revalidatePath(`/ops/subcontractors/${parsed.data.vendor_id}`)
    revalidatePath('/ops/compliance')
    return success('Exception recorded. The underlying gap is still shown in the requirement matrix.')
  } catch (error) {
    return handleUnexpected('addWaiver', error)
  }
}

export async function revokeWaiver(waiverId: string, vendorId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('approveWaiver')
    const supabase = createSupabaseServerClient()
    // Revoked, not deleted — the exception and its removal both stay on record.
    await supabase.from('compliance_waivers')
      .update({ revoked_at: new Date().toISOString() }).eq('id', waiverId)
    await logActivity(supabase, {
      action: 'waiver.revoked', entityType: 'vendor', entityId: vendorId,
      actorUserId: user.id, metadata: { waiver_id: waiverId },
    })
    await refreshVendorCompliance(supabase, vendorId)
    revalidatePath(`/ops/subcontractors/${vendorId}`)
    return success('Exception revoked.')
  } catch (error) {
    return handleUnexpected('revokeWaiver', error)
  }
}

// ---------------------------------------------------------------------------
// Renewals
// ---------------------------------------------------------------------------

export async function requestRenewalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('requestRenewal')
    const supabase = createSupabaseServerClient()
    const vendorId = str(form, 'vendor_id')
    if (!vendorId) return failure('Subcontractor is required.')

    const result = await requestRenewal(supabase, {
      vendorId,
      actorUserId: user.id,
      requestedDocumentType: str(form, 'requested_document_type') ?? 'coi',
      message: str(form, 'message') ?? null,
      baseUrl: await resolveBaseUrl(),
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath(`/ops/subcontractors/${vendorId}`)
    const note =
      result.emailStatus === 'sent' ? 'Email sent to the subcontractor.'
      : result.emailStatus === 'failed' ? 'The email could not be delivered — copy the link below and send it yourself.'
      : 'No email was sent (email is not configured, or the vendor has no address on file). Copy the link below.'
    return success(note, { uploadUrl: result.uploadUrl!, expiresAt: result.expiresAt! })
  } catch (error) {
    return handleUnexpected('requestRenewal', error)
  }
}

export async function revokeUploadLink(tokenId: string, vendorId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('requestRenewal')
    const supabase = createSupabaseServerClient()
    await revokeUploadToken(supabase, tokenId, user.id)
    revalidatePath(`/ops/subcontractors/${vendorId}`)
    return success('Upload link revoked.')
  } catch (error) {
    return handleUnexpected('revokeUploadLink', error)
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function uploadVendorDocument(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('uploadDocuments')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()
    const settings = await getSettings(supabase)

    const entityType = (str(form, 'entity_type') ?? 'vendor') as 'vendor' | 'project' | 'contact'
    const entityId = str(form, 'entity_id')
    const documentType = (str(form, 'document_type') ?? 'other') as DocumentType
    const file = form.get('file')

    if (!entityId) return failure('Missing record reference.')
    if (!(file instanceof File) || file.size === 0) return failure('Choose a file to upload.')

    const upload = await uploadDocument(admin, {
      file, entityType, entityId, documentType,
      documentDate: str(form, 'document_date') ?? null,
      expirationDate: str(form, 'expiration_date') ?? null,
      description: str(form, 'description') ?? null,
      uploadedBy: user.id,
      maxBytes: settings.max_upload_mb * 1024 * 1024,
    })
    if (!upload.ok) return failure(upload.error!)

    await logActivity(supabase, {
      action: 'document.uploaded',
      entityType,
      entityId,
      actorUserId: user.id,
      metadata: { document_type: documentType, filename: upload.document!.original_filename },
    })

    revalidatePath(`/ops/${entityType === 'vendor' ? 'subcontractors' : `${entityType}s`}/${entityId}`)
    revalidatePath('/ops/documents')
    return success('Document uploaded.')
  } catch (error) {
    return handleUnexpected('uploadVendorDocument', error)
  }
}

// ---------------------------------------------------------------------------
// Recalculate
// ---------------------------------------------------------------------------

export async function recalculateCompliance(vendorId?: string): Promise<ActionState> {
  try {
    await requireCapability('writeRecords')
    const supabase = createSupabaseServerClient()
    if (vendorId) {
      await refreshVendorCompliance(supabase, vendorId)
      revalidatePath(`/ops/subcontractors/${vendorId}`)
      return success('Compliance recalculated.')
    }
    const count = await refreshAllVendors(supabase)
    revalidatePath('/ops/compliance')
    revalidatePath('/ops/dashboard')
    return success(`Recalculated ${count} subcontractor${count === 1 ? '' : 's'}.`)
  } catch (error) {
    return handleUnexpected('recalculateCompliance', error)
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * The COI form posts repeatable rows named policy[0][coverage_type] etc.
 * This collects them back into an array in index order.
 */
function parsePolicyLines(form: FormData): Record<string, unknown>[] {
  const indexes = new Set<number>()
  for (const key of Array.from(form.keys())) {
    const m = /^policy\[(\d+)]\[/.exec(key)
    if (m) indexes.add(Number(m[1]))
  }

  const lines: Record<string, unknown>[] = []
  for (const i of Array.from(indexes).sort((a, b) => a - b)) {
    const get = (field: string) => {
      const v = form.get(`policy[${i}][${field}]`)
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
    }
    const coverage = get('coverage_type')
    if (!coverage || !(COVERAGE_TYPES as readonly string[]).includes(coverage)) continue

    // A row with no dates and no carrier is an untouched blank row — skip it.
    if (!get('effective_date') && !get('expiration_date') && !get('carrier') && !get('policy_number')) continue

    lines.push({
      coverage_type: coverage as CoverageType,
      carrier: get('carrier'),
      naic: get('naic'),
      policy_number: get('policy_number'),
      effective_date: get('effective_date') ?? '',
      expiration_date: get('expiration_date') ?? '',
      additional_insured: form.get(`policy[${i}][additional_insured]`) === 'on',
      waiver_of_subrogation: form.get(`policy[${i}][waiver_of_subrogation]`) === 'on',
      primary_noncontributory: form.get(`policy[${i}][primary_noncontributory]`) === 'on',
      claims_made: form.get(`policy[${i}][claims_made]`) === 'on',
      occurrence_form: form.get(`policy[${i}][occurrence_form]`) === 'on',
      notes: get('notes'),
      limits: {
        each_occurrence: get('each_occurrence'),
        general_aggregate: get('general_aggregate'),
        products_completed_ops_aggregate: get('products_completed_ops_aggregate'),
        damage_to_rented_premises: get('damage_to_rented_premises'),
        med_exp: get('med_exp'),
        personal_adv_injury: get('personal_adv_injury'),
        combined_single_limit: get('combined_single_limit'),
        aggregate: get('umbrella_aggregate'),
        el_each_accident: get('el_each_accident'),
        el_disease_each_employee: get('el_disease_each_employee'),
        el_disease_policy_limit: get('el_disease_policy_limit'),
        statutory: form.get(`policy[${i}][statutory]`) === 'on',
      },
    })
  }
  return lines
}

function earliestExpiration(policies: Record<string, unknown>[]): string | null {
  const dates = policies
    .map(p => p.expiration_date)
    .filter((d): d is string => typeof d === 'string' && d.length >= 10)
    .sort()
  return dates[0] ?? null
}

/** Absolute origin for links we hand to vendors, derived from the live request. */
async function resolveBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_CRM_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured
  const h = headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

function isRedirect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
}



import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDate } from '../utils/dates'
import { generateUploadToken } from '../utils/tokens'
import { logActivity } from './activity'
import {
  officeEmail,
  recordNotification,
  renewalRequestEmail,
  sendEmail,
} from './notifications'
import { getSettings } from './settings'

/**
 * Vendor-side workflows: renewal requests and project assignment.
 */

export interface RenewalRequestResult {
  ok: boolean
  uploadUrl?: string
  expiresAt?: string
  emailStatus?: 'sent' | 'skipped' | 'failed'
  error?: string
}

/**
 * "Request Updated COI".
 *
 * Creates a single-purpose token, emails the vendor a link if Resend is
 * configured, and always returns the URL so the office can copy and paste it
 * into their own email or a text message. The link works either way.
 */
export async function requestRenewal(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    actorUserId: string
    requestedDocumentType?: string
    message?: string | null
    baseUrl: string
  },
): Promise<RenewalRequestResult> {
  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, legal_name, email, contact_first_name')
    .eq('id', params.vendorId)
    .maybeSingle()

  if (!vendor) return { ok: false, error: 'Subcontractor not found.' }

  const settings = await getSettings(supabase)
  const { token, hash } = generateUploadToken()
  const expiresAt = new Date(Date.now() + settings.upload_token_ttl_days * 86_400_000)

  const { error } = await supabase.from('upload_tokens').insert({
    token_hash: hash,
    vendor_id: params.vendorId,
    requested_document_type: params.requestedDocumentType ?? 'coi',
    message: params.message ?? null,
    expires_at: expiresAt.toISOString(),
    created_by: params.actorUserId,
  })

  if (error) {
    console.error('[vendors] could not create upload token', error)
    return { ok: false, error: 'The renewal link could not be created.' }
  }

  const uploadUrl = `${params.baseUrl.replace(/\/$/, '')}/upload/coi/${token}`

  let emailStatus: RenewalRequestResult['emailStatus'] = 'skipped'
  if (vendor.email) {
    const body = renewalRequestEmail({
      vendorName: vendor.legal_name as string,
      contactName: (vendor.contact_first_name as string | null) ?? null,
      uploadUrl,
      expiresOn: formatDate(expiresAt),
      requested: params.requestedDocumentType === 'coi' || !params.requestedDocumentType
        ? 'certificate of insurance'
        : params.requestedDocumentType.replace(/_/g, ' '),
      note: params.message ?? null,
      officePhone: settings.company_phone,
    })
    const outcome = await sendEmail({
      to: vendor.email as string,
      subject: body.subject,
      text: body.text,
      html: body.html,
      replyTo: officeEmail(),
    })
    emailStatus = outcome.status === 'sent' ? 'sent' : outcome.status === 'failed' ? 'failed' : 'skipped'
    await recordNotification(supabase, {
      vendorId: params.vendorId,
      notificationType: 'renewal_request',
      recipient: vendor.email as string,
      outcome,
    })
  }

  await logActivity(supabase, {
    action: 'renewal.requested',
    entityType: 'vendor',
    entityId: params.vendorId,
    actorUserId: params.actorUserId,
    // The token itself is never logged — only that a request happened.
    metadata: {
      requested: params.requestedDocumentType ?? 'coi',
      expires_at: expiresAt.toISOString(),
      email_status: emailStatus,
      emailed_to: (vendor.email as string | null) ?? null,
    },
  })

  return { ok: true, uploadUrl, expiresAt: expiresAt.toISOString(), emailStatus }
}

export async function revokeUploadToken(
  supabase: SupabaseClient,
  tokenId: string,
  actorUserId: string,
): Promise<void> {
  const { data } = await supabase
    .from('upload_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .select('vendor_id')
    .maybeSingle()

  await logActivity(supabase, {
    action: 'renewal.link_revoked',
    entityType: 'vendor',
    entityId: (data?.vendor_id as string | undefined) ?? null,
    actorUserId,
    metadata: { upload_token_id: tokenId },
  })
}

export async function assignVendorToProject(
  supabase: SupabaseClient,
  params: {
    projectId: string
    vendorId: string
    scopeOfWork?: string | null
    startDate?: string | null
    endDate?: string | null
    actorUserId: string
  },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('project_vendors').upsert(
    {
      project_id: params.projectId,
      vendor_id: params.vendorId,
      scope_of_work: params.scopeOfWork ?? null,
      start_date: params.startDate ?? null,
      end_date: params.endDate ?? null,
      active: true,
    },
    { onConflict: 'project_id,vendor_id' },
  )

  if (error) {
    console.error('[vendors] assignment failed', error)
    return { ok: false, error: 'The subcontractor could not be assigned to this project.' }
  }

  await logActivity(supabase, {
    action: 'vendor.assigned_to_project',
    entityType: 'project',
    entityId: params.projectId,
    actorUserId: params.actorUserId,
    metadata: { vendor_id: params.vendorId, scope: params.scopeOfWork ?? null },
  })

  return { ok: true }
}

export async function unassignVendorFromProject(
  supabase: SupabaseClient,
  params: { projectId: string; vendorId: string; actorUserId: string },
): Promise<void> {
  // Deactivated, not deleted — the assignment is part of the audit record of
  // who worked on which job during a period.
  await supabase
    .from('project_vendors')
    .update({ active: false, end_date: new Date().toISOString().slice(0, 10) })
    .eq('project_id', params.projectId)
    .eq('vendor_id', params.vendorId)

  await logActivity(supabase, {
    action: 'vendor.unassigned_from_project',
    entityType: 'project',
    entityId: params.projectId,
    actorUserId: params.actorUserId,
    metadata: { vendor_id: params.vendorId },
  })
}

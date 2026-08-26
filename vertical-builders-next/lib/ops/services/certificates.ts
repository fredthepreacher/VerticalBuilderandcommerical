import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanLimits, type CertificateInput } from '../validations/certificate'
import { logActivity } from './activity'
import { refreshVendorCompliance } from './compliance'

/**
 * Certificate lifecycle.
 *
 * The single most important rule in this file: a renewal NEVER overwrites the
 * previous certificate. It creates a new version and marks the old one
 * `replaced`. Six-month audits ask "what was on file in March?", and that
 * question is unanswerable if renewals destroy history.
 */

export interface SaveCertificateResult {
  ok: boolean
  certificateId?: string
  error?: string
}

export async function createCertificate(
  supabase: SupabaseClient,
  input: CertificateInput,
  actorUserId: string | null,
  opts: { replacesCertificateId?: string | null; source?: CertificateInput['source'] } = {},
): Promise<SaveCertificateResult> {
  // Version number = newest version for this vendor + 1
  const { data: latest } = await supabase
    .from('insurance_certificates')
    .select('version')
    .eq('vendor_id', input.vendor_id)
    .order('version', { ascending: false })
    .limit(1)

  const version = ((latest?.[0]?.version as number | undefined) ?? 0) + 1

  const { data: certificate, error } = await supabase
    .from('insurance_certificates')
    .insert({
      vendor_id: input.vendor_id,
      document_id: input.document_id ?? null,
      received_at: input.received_at || new Date().toISOString(),
      issue_date: input.issue_date ?? null,
      broker_name: input.broker_name ?? null,
      broker_contact_name: input.broker_contact_name ?? null,
      broker_email: input.broker_email ?? null,
      broker_phone: input.broker_phone ?? null,
      named_insured: input.named_insured ?? null,
      certificate_holder: input.certificate_holder ?? 'Vertical Builders & Commercial',
      source: opts.source ?? input.source ?? 'admin_upload',
      review_status: 'needs_review',
      reviewer_notes: input.reviewer_notes ?? null,
      replaced_certificate_id: opts.replacesCertificateId ?? null,
      version,
    })
    .select('id')
    .single()

  if (error || !certificate) {
    console.error('[certificates] insert failed', error)
    return { ok: false, error: 'The certificate could not be saved.' }
  }

  const certificateId = certificate.id as string

  const policyRows = input.policies.map(p => ({
    certificate_id: certificateId,
    coverage_type: p.coverage_type,
    carrier: p.carrier ?? null,
    naic: p.naic ?? null,
    policy_number: p.policy_number ?? null,
    effective_date: p.effective_date ?? null,
    expiration_date: p.expiration_date ?? null,
    limits_json: cleanLimits(p.limits as Record<string, unknown>),
    additional_insured: p.additional_insured ?? false,
    waiver_of_subrogation: p.waiver_of_subrogation ?? false,
    primary_noncontributory: p.primary_noncontributory ?? false,
    claims_made: p.claims_made ?? null,
    occurrence_form: p.occurrence_form ?? null,
    notes: p.notes ?? null,
  }))

  const { error: policyError } = await supabase.from('insurance_policies').insert(policyRows)
  if (policyError) {
    console.error('[certificates] policy lines failed', policyError)
    return { ok: false, error: 'The certificate saved but its coverage lines did not. Please review it.' }
  }

  if (input.project_ids?.length) {
    await supabase.from('certificate_projects').insert(
      input.project_ids.map(project_id => ({ certificate_id: certificateId, project_id })),
    )
  }

  // Mark the superseded certificate historical — never delete it.
  if (opts.replacesCertificateId) {
    await supabase
      .from('insurance_certificates')
      .update({ review_status: 'replaced' })
      .eq('id', opts.replacesCertificateId)
    await logActivity(supabase, {
      action: 'certificate.replaced',
      entityType: 'insurance_certificate',
      entityId: opts.replacesCertificateId,
      actorUserId,
      metadata: { replaced_by: certificateId },
    })
  }

  await logActivity(supabase, {
    action: 'coi.uploaded',
    entityType: 'vendor',
    entityId: input.vendor_id,
    actorUserId,
    metadata: {
      certificate_id: certificateId,
      version,
      coverage_lines: input.policies.length,
      source: opts.source ?? input.source ?? 'admin_upload',
    },
  })

  await refreshVendorCompliance(supabase, input.vendor_id)
  return { ok: true, certificateId }
}

export async function reviewCertificate(
  supabase: SupabaseClient,
  params: {
    certificateId: string
    decision: 'approved' | 'rejected'
    notes?: string | null
    actorUserId: string
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data: certificate } = await supabase
    .from('insurance_certificates')
    .select('id, vendor_id, review_status')
    .eq('id', params.certificateId)
    .maybeSingle()

  if (!certificate) return { ok: false, error: 'Certificate not found.' }

  const { error } = await supabase
    .from('insurance_certificates')
    .update({
      review_status: params.decision,
      reviewed_by: params.actorUserId,
      reviewed_at: new Date().toISOString(),
      reviewer_notes: params.notes ?? null,
    })
    .eq('id', params.certificateId)

  if (error) {
    console.error('[certificates] review failed', error)
    return { ok: false, error: 'The review could not be saved.' }
  }

  // When a certificate is approved, any earlier approved certificate for the
  // same vendor becomes historical. Nothing is deleted; it just stops counting
  // as the current paperwork.
  if (params.decision === 'approved') {
    await supabase
      .from('insurance_certificates')
      .update({ review_status: 'replaced' })
      .eq('vendor_id', certificate.vendor_id)
      .eq('review_status', 'approved')
      .neq('id', params.certificateId)

    await supabase
      .from('vendors')
      .update({ last_reviewed_at: new Date().toISOString() })
      .eq('id', certificate.vendor_id)
  }

  await logActivity(supabase, {
    action: 'certificate.reviewed',
    entityType: 'insurance_certificate',
    entityId: params.certificateId,
    actorUserId: params.actorUserId,
    metadata: { decision: params.decision, vendor_id: certificate.vendor_id },
  })

  const evaluation = await refreshVendorCompliance(supabase, certificate.vendor_id as string)

  await supabase.from('compliance_reviews').insert({
    vendor_id: certificate.vendor_id,
    status: evaluation?.status ?? 'needs_review',
    results_json: evaluation ? (JSON.parse(JSON.stringify(evaluation)) as object) : {},
    reviewed_by: params.actorUserId,
    notes: params.notes ?? null,
  })

  return { ok: true }
}

/** Policy lines whose expiration falls inside a window. Drives reminders + dashboard. */
export interface ExpiringPolicy {
  policy_id: string
  certificate_id: string
  vendor_id: string
  vendor_name: string
  vendor_email: string | null
  coverage_type: string
  carrier: string | null
  policy_number: string | null
  expiration_date: string
  days_out: number
}

export async function findExpiringPolicies(
  supabase: SupabaseClient,
  windowDays: number,
  opts: { includeExpired?: boolean } = {},
): Promise<ExpiringPolicy[]> {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const horizon = new Date(today.getTime() + windowDays * 86_400_000).toISOString().slice(0, 10)
  const floor = opts.includeExpired
    ? new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10)
    : todayIso

  const { data } = await supabase
    .from('insurance_policies')
    .select(
      'id, certificate_id, coverage_type, carrier, policy_number, expiration_date,' +
      'insurance_certificates!inner(id, vendor_id, review_status, vendors!inner(id, legal_name, email, status, archived_at))',
    )
    .gte('expiration_date', floor)
    .lte('expiration_date', horizon)
    .in('insurance_certificates.review_status', ['approved', 'needs_review'])
    .order('expiration_date', { ascending: true })

  const rows: ExpiringPolicy[] = []
  for (const row of (data ?? []) as unknown as RawExpiringRow[]) {
    const cert = row.insurance_certificates
    const vendor = cert?.vendors
    if (!vendor || vendor.archived_at || vendor.status === 'inactive') continue
    const expiration = new Date(row.expiration_date + 'T00:00:00Z')
    rows.push({
      policy_id: row.id,
      certificate_id: row.certificate_id,
      vendor_id: vendor.id,
      vendor_name: vendor.legal_name,
      vendor_email: vendor.email,
      coverage_type: row.coverage_type,
      carrier: row.carrier,
      policy_number: row.policy_number,
      expiration_date: row.expiration_date,
      days_out: Math.round((expiration.getTime() - Date.UTC(
        today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(),
      )) / 86_400_000),
    })
  }
  return rows
}

interface RawExpiringRow {
  id: string
  certificate_id: string
  coverage_type: string
  carrier: string | null
  policy_number: string | null
  expiration_date: string
  insurance_certificates: {
    id: string
    vendor_id: string
    review_status: string
    vendors: {
      id: string
      legal_name: string
      email: string | null
      status: string
      archived_at: string | null
    } | null
  } | null
}

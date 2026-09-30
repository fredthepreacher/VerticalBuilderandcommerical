import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Activity log.
 *
 * Rules:
 *   - never store secrets, tokens, file bytes or full document contents
 *   - never let a logging failure break the operation being logged
 */

export type ActivityAction =
  | 'record.created'
  | 'record.updated'
  | 'record.archived'
  | 'status.changed'
  | 'lead.received'
  | 'lead.converted'
  | 'vendor.assigned_to_project'
  | 'vendor.unassigned_from_project'
  | 'coi.uploaded'
  | 'certificate.reviewed'
  | 'certificate.replaced'
  | 'policy.edited'
  | 'waiver.added'
  | 'waiver.revoked'
  | 'renewal.requested'
  | 'renewal.link_revoked'
  | 'document.uploaded'
  | 'document.downloaded'
  | 'document.archived'
  | 'audit.cycle_created'
  | 'audit.package_generated'
  | 'settings.updated'
  | 'requirements.updated'
  | 'estimate.created'
  | 'estimate.ai_generated'
  | 'estimate.sent'
  | 'estimate.approved'
  | 'estimate.declined'
  | 'estimate.batch_exported'
  | 'estimate.converted_to_job'
  | 'lead_import.started'
  | 'lead_import.completed'
  | 'lead_import.failed'
  | 'roof_measurement.requested'
  | 'roof_measurement.completed'
  | 'roof_measurement.failed'
  | 'project.schedule_changed'
  | 'project.photo_uploaded'
  | 'client.converted_to_job'
  | 'ai.copilot_query'
  | 'ai.lead_structured'
  | 'ai.lead_enriched'
  | 'ai.coi_extracted'
  | 'ai.coi_extraction_applied'
  | 'ai.coi_extraction_rejected'
  | 'ai.audit_brief_generated'
  | 'proposal_template.created'
  | 'proposal_template.updated'
  | 'proposal_template.archived'
  | 'proposal_template.restored'
  | 'proposal_template.applied'
  | 'lead.spam_removed'
  | 'lead.restored'
  | 'subcontractor.agreement_uploaded'
  | 'subcontractor.agreement_status_changed'
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.voided'
  | 'payment.pending'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.manual_recorded'
  | 'job_cost.created'
  | 'job_cost.updated'
  | 'job_cost.deleted'
  | 'pricebook.updated'
  | 'reminder.sent'
  | 'prospecting.campaign_created'
  | 'prospecting.campaign_updated'
  | 'prospecting.campaign_archived'
  | 'prospecting.import_started'
  | 'prospecting.import_completed'

export interface ActivityInput {
  action: ActivityAction
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
  actorUserId?: string | null
  actorLabel?: string | null
}

export async function logActivity(
  supabase: SupabaseClient,
  input: ActivityInput,
): Promise<void> {
  try {
    await supabase.from('activity_log').insert({
      actor_user_id: input.actorUserId ?? null,
      actor_label: input.actorLabel ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      metadata_json: sanitizeMetadata(input.metadata ?? {}),
    })
  } catch (error) {
    // A broken audit trail is bad; a broken save because of a broken audit
    // trail is worse. Surface it in the server log and carry on.
    console.error('[activity] failed to write log entry', input.action, error)
  }
}

const FORBIDDEN_KEYS =
  /token|secret|password|service_role|apikey|api_key|authorization|card|cvv|iban|routing|account_number|client_secret/i

function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_KEYS.test(key)) continue
    if (value === undefined) continue
    if (typeof value === 'string' && value.length > 500) {
      out[key] = value.slice(0, 500) + '…'
    } else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 50)
    } else if (typeof value === 'object') {
      out[key] = JSON.parse(JSON.stringify(value))
    }
  }
  return out
}

export const ACTION_LABELS: Record<string, string> = {
  'record.created': 'Record created',
  'record.updated': 'Record updated',
  'record.archived': 'Record archived',
  'status.changed': 'Status changed',
  'lead.received': 'Website lead received',
  'lead.converted': 'Lead converted to customer + project',
  'vendor.assigned_to_project': 'Subcontractor assigned to project',
  'vendor.unassigned_from_project': 'Subcontractor removed from project',
  'coi.uploaded': 'Certificate of insurance uploaded',
  'certificate.reviewed': 'Certificate reviewed',
  'certificate.replaced': 'Certificate replaced by a renewal',
  'policy.edited': 'Policy line edited',
  'waiver.added': 'Compliance exception granted',
  'waiver.revoked': 'Compliance exception revoked',
  'renewal.requested': 'Renewal requested from vendor',
  'renewal.link_revoked': 'Vendor upload link revoked',
  'document.uploaded': 'Document uploaded',
  'document.downloaded': 'Document downloaded',
  'document.archived': 'Document archived',
  'audit.cycle_created': 'Audit cycle created',
  'audit.package_generated': 'Audit package generated',
  'settings.updated': 'Settings updated',
  'requirements.updated': 'Insurance requirements updated',
  'estimate.created': 'Estimate created',
  'estimate.ai_generated': 'AI draft generated',
  'estimate.sent': 'Estimate sent',
  'estimate.approved': 'Estimate approved',
  'estimate.declined': 'Estimate declined',
  'estimate.batch_exported': 'Estimates exported as PDFs',
  'estimate.converted_to_job': 'Estimate converted to a job',
  'lead_import.started': 'Lead import started',
  'lead_import.completed': 'Lead import completed',
  'lead_import.failed': 'Lead import failed',
  'roof_measurement.requested': 'Roof measurement requested',
  'roof_measurement.completed': 'Roof measurement recorded',
  'roof_measurement.failed': 'Roof measurement failed',
  'project.schedule_changed': 'Job schedule changed',
  'project.photo_uploaded': 'Project photo uploaded',
  'client.converted_to_job': 'Job created from client',
  'ai.copilot_query': 'AI assistant query',
  'ai.lead_structured': 'Lead drafted from notes by AI',
  'ai.lead_enriched': 'Lead summarised by AI',
  'ai.coi_extracted': 'COI analysed by AI',
  'ai.coi_extraction_applied': 'AI-extracted COI applied after human review',
  'ai.coi_extraction_rejected': 'AI COI extraction rejected',
  'ai.audit_brief_generated': 'AI audit brief generated',
  'proposal_template.created': 'Proposal template created',
  'proposal_template.updated': 'Proposal template updated',
  'proposal_template.archived': 'Proposal template archived',
  'proposal_template.restored': 'Proposal template restored',
  'proposal_template.applied': 'Proposal template applied to an estimate',
  'lead.spam_removed': 'Lead removed as spam',
  'lead.restored': 'Lead restored from the archive',
  'subcontractor.agreement_uploaded': 'Subcontractor agreement uploaded',
  'subcontractor.agreement_status_changed': 'Subcontractor agreement status changed',
  'invoice.created': 'Invoice created',
  'invoice.sent': 'Invoice sent',
  'invoice.voided': 'Invoice voided',
  'payment.pending': 'Payment started',
  'payment.succeeded': 'Payment received',
  'payment.failed': 'Payment failed',
  'payment.refunded': 'Payment refunded',
  'payment.manual_recorded': 'Payment recorded manually',
  'job_cost.created': 'Job cost added',
  'job_cost.updated': 'Job cost updated',
  'job_cost.deleted': 'Job cost removed',
  'pricebook.updated': 'Pricebook updated',
  'reminder.sent': 'Expiration reminder sent',
  'prospecting.campaign_created': 'Prospecting campaign created',
  'prospecting.campaign_updated': 'Prospecting campaign updated',
  'prospecting.campaign_archived': 'Prospecting campaign archived',
  'prospecting.import_started': 'Prospect import started',
  'prospecting.import_completed': 'Prospect import completed',
}

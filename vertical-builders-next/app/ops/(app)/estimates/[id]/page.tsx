import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, ExternalLink } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { loadPricebook } from '@/lib/ops/services/estimates'
import { listProposalTemplates } from '@/lib/ops/services/proposal-templates'
import { getSettings } from '@/lib/ops/services/settings'
import { isAiConfigured } from '@/lib/ops/estimating/ai'
import { describeProviderConfig } from '@/lib/ops/measurements/provider'
import {
  ESTIMATE_STATUS_LABELS, type Estimate, type EstimateLineItem, type RoofMeasurement,
} from '@/lib/ops/types'
import { formatDate, formatDateTime } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import EstimateBuilder, { AiDraftPanel, type BuilderLine } from '@/components/ops/EstimateBuilder'
import MeasurementPanel from '@/components/ops/MeasurementPanel'
import EstimatePhotos from '@/components/ops/EstimatePhotos'
import EstimateStatusActions from '@/components/ops/EstimateStatusActions'
import SaveProposalTemplateButton from '@/components/ops/SaveProposalTemplateButton'
import { Badge } from '@/components/ops/StatusBadge'

export const dynamic = 'force-dynamic'

export default async function EstimateDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('estimatesView')) notFound()

  const supabase = createSupabaseServerClient()

  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, estimate_line_items(*), contacts(id, first_name, last_name, company_name, email)')
    .eq('id', params.id)
    .maybeSingle()

  if (!estimate) notFound()

  const settings = await getSettings(supabase)

  const [{ data: clients }, { data: staff }, pricebook, templates, { data: measurements }, { data: photos }] =
    await Promise.all([
      supabase.from('contacts').select('id, first_name, last_name, company_name')
        .is('archived_at', null).order('last_name').limit(500),
      supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
      loadPricebook(supabase, { serviceType: estimate.service_type as string | null }),
      listProposalTemplates(supabase),
      supabase.from('roof_measurements').select('*')
        .eq('estimate_id', params.id).order('created_at', { ascending: false }),
      supabase.from('estimate_photos')
        .select('id, caption, photo_type, customer_visible, sort_order, document_id, documents(original_filename, mime_type)')
        .eq('estimate_id', params.id).order('sort_order'),
    ])

  const lines = ((estimate.estimate_line_items ?? []) as EstimateLineItem[])
    .sort((a, b) => a.sort_order - b.sort_order)

  const builderLines: BuilderLine[] = lines.map((line, index) => ({
    key: index + 1,
    id: line.id,
    category: line.category ?? '',
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit,
    unitPrice: line.unit_price_cents ? String(line.unit_price_cents / 100) : '',
    pricebookItemId: line.pricebook_item_id ?? '',
    source: line.source,
    aiGenerated: line.ai_generated,
    needsReview: line.needs_review,
    reviewed: false,
    notes: line.notes ?? '',
  }))

  const contact = Array.isArray(estimate.contacts) ? estimate.contacts[0] : estimate.contacts
  const aiMeta = (estimate.ai_metadata_json ?? {}) as {
    warnings?: string[]; assumptions?: string[]; model?: string; generatedAt?: string
  }

  const address = [estimate.property_address, estimate.city, estimate.state]
    .filter(Boolean).join(', ')

  const providerState = describeProviderConfig(settings.roof_measurement_provider)
  const status = estimate.status as Estimate['status']
  const unreviewed = lines.filter(l => l.needs_review).length

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/estimates">Estimates</Link> / {estimate.estimate_number}
          </div>
          <h1>{estimate.title}</h1>
          <p className="ops-sub">
            <Badge tone={status === 'approved' || status === 'converted' ? 'ok' : status === 'ai_draft' ? 'warn' : 'neutral'}>
              {ESTIMATE_STATUS_LABELS[status]}
            </Badge>
            <span style={{ marginLeft: 8 }}>
              {formatCents(estimate.total_cents as number)} ·{' '}
              {contact
                ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name
                : 'No client linked'}
              {estimate.valid_until ? ` · valid to ${formatDate(estimate.valid_until)}` : ''}
            </span>
          </p>
        </div>
        <div className="ops-page-actions">
          <a className="ops-btn" href={`/api/estimates/${params.id}/pdf?disposition=inline`}
            target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" /> Preview
          </a>
          <a className="ops-btn" href={`/api/estimates/${params.id}/pdf`} rel="noopener">
            <Download aria-hidden="true" /> PDF
          </a>
          <EstimateStatusActions
            estimateId={params.id}
            status={status}
            unreviewedLines={unreviewed}
            canSend={user.can('estimatesSend')}
            canConvert={user.can('estimatesConvert')}
            convertedProjectId={estimate.converted_project_id as string | null}
            projectManagers={(staff ?? []).map(s => ({
              id: s.id as string, label: (s.full_name as string) || (s.email as string),
            }))}
          />
        </div>
      </div>

      {estimate.converted_project_id && (
        <div className="ops-banner ok">
          <div>
            <strong>Converted to a job</strong>
            This estimate is locked as the record of what was quoted.
          </div>
          <div className="ops-banner-actions">
            <Link className="ops-btn ops-btn-sm" href={`/ops/projects/${estimate.converted_project_id}`}>
              Open the job
            </Link>
          </div>
        </div>
      )}

      <div className="ops-detail">
        <div>
          <EstimateBuilder
            estimate={{
              id: estimate.id as string,
              title: estimate.title as string,
              status,
              contact_id: estimate.contact_id as string | null,
              lead_id: estimate.lead_id as string | null,
              project_id: estimate.project_id as string | null,
              property_address: estimate.property_address as string | null,
              city: estimate.city as string | null,
              state: estimate.state as string | null,
              zip: estimate.zip as string | null,
              service_type: estimate.service_type as string | null,
              scope_summary: estimate.scope_summary as string | null,
              discount_cents: estimate.discount_cents as number,
              tax_percent: estimate.tax_percent as number,
              valid_until: estimate.valid_until as string | null,
              customer_notes: estimate.customer_notes as string | null,
              internal_notes: estimate.internal_notes as string | null,
              assigned_to: estimate.assigned_to as string | null,
              lines: builderLines,
            }}
            clients={(clients ?? []).map(c => ({
              id: c.id as string,
              label: [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string) || 'Unnamed',
            }))}
            staff={(staff ?? []).map(s => ({
              id: s.id as string, label: (s.full_name as string) || (s.email as string),
            }))}
            pricebook={pricebook}
            taxEnabled={settings.estimate_tax_enabled}
            templates={templates.map(t => ({
              id: t.id, name: t.name, service_type: t.service_type, line_count: t.line_count,
            }))}
          />
        </div>

        <div className="ops-stack">
          {user.can('pricebookManage') && lines.length > 0 && (
            <section className="ops-card">
              <div className="ops-card-head"><h2>Reuse this proposal</h2></div>
              <div className="ops-card-body">
                <p className="ops-hint" style={{ marginBottom: 10 }}>
                  Happy with how this one reads? Save its wording as a template and start the next
                  one from it.
                </p>
                <SaveProposalTemplateButton
                  estimateId={params.id}
                  suggestedName={(estimate.service_type as string | null)
                    ? `${estimate.service_type} Proposal` : undefined}
                />
              </div>
            </section>
          )}

          {user.can('aiGenerate') && (
            <AiDraftPanel
              estimateId={params.id}
              aiConfigured={isAiConfigured()}
              hasLines={lines.length > 0}
              warnings={aiMeta.warnings ?? []}
              assumptions={aiMeta.assumptions ?? []}
            />
          )}

          <MeasurementPanel
            estimateId={params.id}
            address={address || 'Address not recorded'}
            measurements={(measurements ?? []) as RoofMeasurement[]}
            providerState={providerState}
            canOrder={user.can('measurementsOrder')}
            canCreate={user.can('measurementsCreate')}
          />

          <EstimatePhotos
            estimateId={params.id}
            photos={((photos ?? []) as unknown as RawPhoto[]).map(p => {
              const doc = Array.isArray(p.documents) ? p.documents[0] : p.documents
              return {
                id: p.id,
                documentId: p.document_id,
                caption: p.caption,
                photoType: p.photo_type,
                customerVisible: p.customer_visible,
                filename: doc?.original_filename ?? 'Photo',
              }
            })}
            canUpload={user.can('estimatesEdit')}
          />

          {aiMeta.model && (
            <section className="ops-card">
              <div className="ops-card-head"><h2>AI draft provenance</h2></div>
              <div className="ops-card-body">
                <dl className="ops-deflist">
                  <dt>Model</dt><dd>{aiMeta.model}</dd>
                  <dt>Generated</dt>
                  <dd>{aiMeta.generatedAt ? formatDateTime(aiMeta.generatedAt) : '—'}</dd>
                </dl>
                <p className="ops-hint" style={{ marginTop: 10 }}>
                  Recorded so an estimate can be traced back to how it was produced. Reasoning is
                  not stored — only the model, version and the warnings it raised.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}

interface RawPhoto {
  id: string
  document_id: string
  caption: string | null
  photo_type: string
  customer_visible: boolean
  sort_order: number
  documents: { original_filename: string; mime_type: string | null }
    | { original_filename: string; mime_type: string | null }[] | null
}

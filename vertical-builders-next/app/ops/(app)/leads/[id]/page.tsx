import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, FileText, Mail, Phone } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { formatAddressLine } from '@/lib/ops/imports/address'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { ACTION_LABELS } from '@/lib/ops/services/activity'
import { SERVICE_TYPES } from '@/lib/ops/constants'
import { formatDate, formatDateTime } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import LeadForm, { type LeadFormValues } from '@/components/ops/LeadForm'
import NotesPanel from '@/components/ops/NotesPanel'
import LeadAiAssist from '@/components/ops/LeadAiAssist'
import { isOpsAiConfigured } from '@/lib/ops/ai/provider'
import ConvertLeadButton from '@/components/ops/ConvertLeadButton'
import RemoveSpamLeadButton from '@/components/ops/RemoveSpamLeadButton'
import { LeadStageBadge } from '@/components/ops/StatusBadge'

export const dynamic = 'force-dynamic'

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()

  const { data: lead } = await supabase.from('leads').select('*').eq('id', params.id).maybeSingle()
  if (!lead) notFound()

  const converted = Boolean(lead.converted_contact_id || lead.converted_project_id)
  const archived = Boolean(lead.archived_at)

  const [{ data: staff }, { data: notes }, { data: activity }, { data: estimates }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
    supabase.from('notes').select('id, body, created_at, profiles:created_by(full_name, email)')
      .eq('entity_type', 'lead').eq('entity_id', params.id).order('created_at', { ascending: false }),
    supabase.from('activity_log').select('id, action, created_at, actor_label, metadata_json')
      .eq('entity_type', 'lead').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(25),
    supabase.from('estimates')
      .select('id, estimate_number, title, status, total_cents')
      .eq('lead_id', params.id).is('archived_at', null)
      .order('created_at', { ascending: false }).limit(10),
  ])

  // A property prospect has no name until somebody knocks on the door, so the
  // address is the heading. Once an owner name is added it takes over — same
  // record, no duplicate, no change of record type.
  const contactName = [lead.first_name, lead.last_name].filter(Boolean).join(' ')
    || (lead.company_name as string | null) || ''
  const addressLine = formatAddressLine(lead as {
    property_address?: string | null; city?: string | null; state?: string | null; zip?: string | null
  })
  const name = contactName || addressLine || 'Unnamed lead'
  const isProspect = lead.record_type === 'property_prospect'
  const meta = (lead.source_metadata ?? {}) as Record<string, string>

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/leads">Leads</Link> / {name}</div>
          <h1>{name}</h1>
          <p className="ops-sub">
            <LeadStageBadge stage={lead.pipeline_stage} />{' '}
            {isProspect && <span className="ops-mode-badge" style={{ marginLeft: 6 }}>Property prospect</span>}
            <span style={{ marginLeft: 8 }}>
              Received {formatDateTime(lead.created_at)} from {lead.source}
              {lead.source_page ? ` (${lead.source_page})` : ''}
            </span>
          </p>
          {isProspect && (
            <p className="ops-hint" style={{ marginTop: 6 }}>
              {contactName ? addressLine : 'No owner details yet.'}
              {lead.stop_number ? ` · Stop ${lead.stop_number}` : ''}
              {lead.import_batch_tag ? (
                <> · <Link href={`/ops/leads?batch=${encodeURIComponent(lead.import_batch_tag as string)}`}>
                  {lead.import_batch_tag as string}
                </Link></>
              ) : null}
              {meta.needs_review_reason ? ` · Needs review: ${meta.needs_review_reason}` : ''}
            </p>
          )}
        </div>
        <div className="ops-page-actions">
          {lead.phone && <a className="ops-btn" href={`tel:${String(lead.phone).replace(/\D/g, '')}`}><Phone aria-hidden="true" /> Call</a>}
          {lead.email && <a className="ops-btn" href={`mailto:${lead.email}`}><Mail aria-hidden="true" /> Email</a>}

          {/* The client's daily loop starts here. No conversion to a customer
              or a project is required first — a property prospect with no name
              can be quoted from its address alone. */}
          {user.can('estimatesCreate') && !archived && (
            <Link className="ops-btn ops-btn-primary" href={`/ops/estimates/new?lead=${lead.id}`}>
              <FileText aria-hidden="true" /> Create estimate
            </Link>
          )}

          {lead.converted_project_id ? (
            <Link className="ops-btn ops-btn-dark" href={`/ops/projects/${lead.converted_project_id}`}>
              Open project <ArrowRight aria-hidden="true" />
            </Link>
          ) : (
            !archived && <ConvertLeadButton leadId={lead.id} />
          )}
        </div>
      </div>

      {archived && (
        <div className="ops-banner warn">
          <div>
            <strong>Removed from the pipeline</strong>
            {lead.lost_reason === 'Spam'
              ? 'This lead was removed as spam. Nothing was deleted — its history, notes and any estimates are still here.'
              : 'This lead is archived. Nothing was deleted; its history is still here.'}
          </div>
          <div className="ops-banner-actions">
            {(user.role === 'admin' || user.role === 'office') && (
              <RemoveSpamLeadButton leadId={lead.id} archived converted={converted} />
            )}
          </div>
        </div>
      )}

      {lead.converted_project_id && (
        <div className="ops-banner ok">
          <div>
            <strong>Converted</strong>
            This lead became a customer and a project. Its history stays here for the record.
          </div>
          <div className="ops-banner-actions">
            <Link className="ops-btn ops-btn-sm" href={`/ops/contacts/${lead.converted_contact_id}`}>Customer</Link>
            <Link className="ops-btn ops-btn-sm" href={`/ops/projects/${lead.converted_project_id}`}>Project</Link>
          </div>
        </div>
      )}

      <div className="ops-detail">
        <div>
          <LeadForm
            lead={lead as LeadFormValues}
            staff={(staff ?? []).map(s => ({ id: s.id as string, label: (s.full_name as string) || (s.email as string) }))}
            serviceTypes={[...SERVICE_TYPES]}
          />

          {user.can('writeRecords') && (
            <div style={{ marginTop: 16 }}>
              <LeadAiAssist leadId={lead.id as string} configured={isOpsAiConfigured()} />
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <NotesPanel
              entityType="lead"
              entityId={lead.id}
              notes={(notes ?? []).map(n => ({
                id: n.id as string,
                body: n.body as string,
                created_at: n.created_at as string,
                author: authorName(n),
              }))}
            />
          </div>
        </div>

        <div className="ops-stack">
          {/* Estimates first: this is what the client is here to do. */}
          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Estimates</h2>
              {user.can('estimatesCreate') && !archived && (
                <div className="ops-card-actions">
                  <Link className="ops-btn ops-btn-sm" href={`/ops/estimates/new?lead=${lead.id}`}>
                    <FileText aria-hidden="true" /> New
                  </Link>
                </div>
              )}
            </div>
            <div className="ops-card-body">
              {(estimates ?? []).length === 0 ? (
                <p className="ops-hint">
                  Nothing quoted yet.{' '}
                  {user.can('estimatesCreate') && !archived
                    ? 'Create one straight from here — no need to convert the lead first.'
                    : ''}
                </p>
              ) : (
                <ul className="ops-linklist">
                  {(estimates ?? []).map(e => (
                    <li key={e.id as string}>
                      <Link href={`/ops/estimates/${e.id}`}>
                        {(e.estimate_number as string | null) ?? 'Estimate'} — {e.title as string}
                      </Link>
                      <span className="ops-sub2">
                        {String(e.status).replace(/_/g, ' ')} · {formatCents(e.total_cents as number)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="ops-card">
            <div className="ops-card-head"><h2>Where this came from</h2></div>
            <div className="ops-card-body">
              <dl className="ops-deflist">
                <dt>Source</dt><dd style={{ textTransform: 'capitalize' }}>{lead.source}</dd>
                <dt>Landing page</dt><dd>{lead.source_page ?? '—'}</dd>
                <dt>UTM source</dt><dd>{meta.utm_source ?? '—'}</dd>
                <dt>UTM medium</dt><dd>{meta.utm_medium ?? '—'}</dd>
                <dt>UTM campaign</dt><dd>{meta.utm_campaign ?? '—'}</dd>
                <dt>Referrer</dt><dd style={{ wordBreak: 'break-all', fontSize: '.78rem' }}>{meta.referrer ?? '—'}</dd>
                <dt>Received</dt><dd>{formatDateTime(lead.created_at)}</dd>
                <dt>Last contacted</dt><dd>{lead.last_contacted_at ? formatDateTime(lead.last_contacted_at) : 'Not yet'}</dd>
                <dt>Follow-up due</dt><dd>{lead.next_follow_up_at ? formatDate(lead.next_follow_up_at) : '—'}</dd>
              </dl>
            </div>
          </section>

          <section className="ops-card">
            <div className="ops-card-head"><h2>Activity</h2></div>
            <div className="ops-card-body">
              {(activity ?? []).length === 0 ? (
                <p className="ops-hint">Nothing logged yet.</p>
              ) : (
                <ul className="ops-timeline">
                  {(activity ?? []).map(a => (
                    <li key={a.id}>
                      <span className="tl-dot" />
                      <span className="tl-body">
                        <strong>{ACTION_LABELS[a.action as string] ?? a.action}</strong>
                        <span>{formatDateTime(a.created_at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Last in the column on purpose: a destructive action should not sit
              where somebody is aiming for something else. */}
          {(user.role === 'admin' || user.role === 'office') && !archived && !converted && (
            <section className="ops-card">
              <div className="ops-card-head"><h2>Not a real lead?</h2></div>
              <div className="ops-card-body">
                <p className="ops-hint" style={{ marginBottom: 10 }}>
                  Removing it as spam takes it out of the pipeline. Nothing is deleted — the record,
                  its history and anything attached to it are kept, and you can restore it later.
                </p>
                <RemoveSpamLeadButton leadId={lead.id} archived={false} converted={converted} />
              </div>
            </section>
          )}

          {converted && (user.role === 'admin' || user.role === 'office') && (
            <p className="ops-hint">
              This lead became a customer or a job, so it cannot be removed as spam.
            </p>
          )}
        </div>
      </div>
    </>
  )
}

function authorName(note: unknown): string {
  const profile = (note as { profiles?: { full_name?: string | null; email?: string | null } | null }).profiles
  return profile?.full_name || profile?.email || 'Someone'
}

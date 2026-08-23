import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AlertOctagon, AlertTriangle, CheckCircle2, Clock, FileUp, HelpCircle, ShieldOff,
} from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { evaluateVendorContext, loadVendorComplianceContext } from '@/lib/ops/services/compliance'
import { listDocuments } from '@/lib/ops/services/documents'
import { ACTION_LABELS } from '@/lib/ops/services/activity'
import {
  COMPLIANCE_LABELS, COVERAGE_LABELS, DOCUMENT_TYPE_LABELS,
  type ComplianceStatus, type DocumentType,
} from '@/lib/ops/types'
import { describeLimits } from '@/lib/ops/services/audits'
import { formatDate, formatDateTime } from '@/lib/ops/utils/dates'
import { formatBytes } from '@/lib/ops/utils/files'
import RequirementMatrix from '@/components/ops/RequirementMatrix'
import VendorForm, { type VendorFormValues } from '@/components/ops/VendorForm'
import NotesPanel from '@/components/ops/NotesPanel'
import DocumentUploader from '@/components/ops/DocumentUploader'
import AgreementPanel, { type AgreementRow, type AgreementStatus } from '@/components/ops/AgreementPanel'
import { Badge, ComplianceBadge } from '@/components/ops/StatusBadge'
import {
  AddWaiverButton, RecalculateButton, RequestRenewalButton, ReviewCertificateButtons, RevokeWaiverButton,
} from '@/components/ops/VendorActions'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Projects' },
  { key: 'insurance', label: 'Insurance / COIs' },
  { key: 'agreement', label: 'Agreement' },
  { key: 'documents', label: 'Documents' },
  { key: 'notes', label: 'Notes' },
  { key: 'activity', label: 'Activity' },
] as const

const HERO: Record<ComplianceStatus, { tone: string; Icon: typeof CheckCircle2; border: string; bg: string; color: string }> = {
  compliant:     { tone: 'ok',      Icon: CheckCircle2, border: '#c3e3d3', bg: '#e6f4ed', color: '#12724a' },
  expiring_soon: { tone: 'warn',    Icon: Clock,        border: '#efd9b3', bg: '#fdf1de', color: '#9a5b00' },
  needs_review:  { tone: 'info',    Icon: HelpCircle,   border: '#c6d8f0', bg: '#e9f0fb', color: '#1a56a8' },
  missing:       { tone: 'bad',     Icon: AlertOctagon, border: '#f2c9c6', bg: '#fdeceb', color: '#ad2216' },
  non_compliant: { tone: 'bad',     Icon: AlertTriangle,border: '#f2c9c6', bg: '#fdeceb', color: '#ad2216' },
  waived:        { tone: 'neutral', Icon: ShieldOff,    border: '#cfd6de', bg: '#eef1f4', color: '#5c6773' },
}

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { tab?: string; saved?: string }
}) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const tab = (TABS.find(t => t.key === searchParams.tab)?.key ?? 'overview') as (typeof TABS)[number]['key']

  const ctx = await loadVendorComplianceContext(supabase, params.id, { includeHistorical: true })
  if (!ctx) notFound()

  const vendor = ctx.vendor
  // Current paperwork only for the headline: replaced/rejected certificates are
  // history, not the answer to "can they work today".
  const liveCtx = {
    ...ctx,
    policies: ctx.certificates
      .filter(c => ['approved', 'needs_review'].includes(c.review_status))
      .flatMap(c => c.insurance_policies ?? []),
  }
  const evaluation = evaluateVendorContext(liveCtx, {})

  const [{ data: assignments }, { data: templates }, { data: notes }, { data: activity }, { data: tokens }, documents, { data: agreementRows }] =
    await Promise.all([
      supabase.from('project_vendors')
        .select('active, scope_of_work, start_date, end_date, projects(id, project_number, project_name, status)')
        .eq('vendor_id', params.id),
      supabase.from('insurance_requirement_templates').select('id, name').eq('active', true).order('name'),
      supabase.from('notes').select('id, body, created_at, profiles:created_by(full_name, email)')
        .eq('entity_type', 'vendor').eq('entity_id', params.id).order('created_at', { ascending: false }),
      supabase.from('activity_log').select('id, action, created_at, actor_label, metadata_json')
        .eq('entity_type', 'vendor').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('upload_tokens')
        .select('id, requested_document_type, expires_at, used_at, revoked_at, created_at')
        .eq('vendor_id', params.id).order('created_at', { ascending: false }).limit(5),
      listDocuments(supabase, { entityType: 'vendor', entityId: params.id }),
      supabase.from('subcontractor_agreements')
        .select('id, status, effective_date, expiration_date, signed_date, document_id, version, notes, created_at, documents(original_filename)')
        .eq('vendor_id', params.id).order('version', { ascending: false }),
    ])

  const agreements: AgreementRow[] = ((agreementRows ?? []) as unknown as RawAgreement[]).map(row => {
    const doc = Array.isArray(row.documents) ? row.documents[0] : row.documents
    return {
      id: row.id,
      status: row.status,
      effectiveDate: row.effective_date,
      expirationDate: row.expiration_date,
      signedDate: row.signed_date,
      documentId: row.document_id,
      filename: doc?.original_filename ?? null,
      version: row.version,
      notes: row.notes,
      createdAt: row.created_at,
    }
  })

  const projects = (assignments ?? []).flatMap(a => {
    const embedded = (a as unknown as { projects: unknown }).projects
    const list = (Array.isArray(embedded) ? embedded : embedded ? [embedded] : []) as
      { id: string; project_number: string; project_name: string; status: string }[]
    return list.map(p => ({ ...p, active: a.active as boolean, scope: a.scope_of_work as string | null,
      start: a.start_date as string | null, end: a.end_date as string | null }))
  })

  const hero = HERO[evaluation.status]
  const currentCerts = ctx.certificates.filter(c => ['approved', 'needs_review'].includes(c.review_status))
  const historicalCerts = ctx.certificates.filter(c => !['approved', 'needs_review'].includes(c.review_status))

  const href = (t: string) => `/ops/subcontractors/${params.id}?tab=${t}`

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/subcontractors">Subcontractors</Link> / {vendor.legal_name}
          </div>
          <h1>{vendor.legal_name}</h1>
          <p className="ops-sub">
            {vendor.dba && <>DBA {vendor.dba} · </>}
            {vendor.primary_trade ?? 'Trade not recorded'} ·{' '}
            <Badge tone={vendor.status === 'active' ? 'info' : vendor.status === 'blocked' ? 'bad' : 'neutral'}>
              {cap(vendor.status)}
            </Badge>
          </p>
        </div>
        <div className="ops-page-actions">
          <RecalculateButton vendorId={vendor.id} />
          {user.can('uploadDocuments') && (
            <Link className="ops-btn" href={`/ops/compliance/upload?vendor=${vendor.id}`}>
              <FileUp aria-hidden="true" /> Upload COI
            </Link>
          )}
          {user.can('approveWaiver') && (
            <AddWaiverButton
              vendorId={vendor.id}
              projects={projects.map(p => ({ id: p.id, label: `${p.project_number} ${p.project_name}` }))}
            />
          )}
          {user.can('requestRenewal') && (
            <RequestRenewalButton vendorId={vendor.id} vendorEmail={vendor.email} />
          )}
        </div>
      </div>

      {searchParams.saved && (
        <div className="ops-banner ok" role="status">
          <CheckCircle2 aria-hidden="true" />
          <div>Certificate saved. It is marked <strong>Needs review</strong> until someone approves it below.</div>
        </div>
      )}

      {/* --- compliance hero --------------------------------------------------- */}
      <div
        className="ops-compliance-hero"
        style={{ borderColor: hero.border, background: hero.bg }}
        role="status"
      >
        <span className="hero-mark" style={{ color: hero.color }} aria-hidden="true">
          <hero.Icon />
        </span>
        <span className="hero-text">
          <span className="hero-status" style={{ color: hero.color }}>
            {COMPLIANCE_LABELS[evaluation.status]}
          </span>
          <span className="hero-detail">{evaluation.summary}</span>
        </span>
        <span style={{ textAlign: 'right', fontSize: '.8rem', color: 'var(--ops-muted)' }}>
          {evaluation.earliestExpiration
            ? <>Earliest expiration <strong style={{ color: 'var(--ops-ink)' }}>{formatDate(evaluation.earliestExpiration)}</strong></>
            : 'No current expiration on file'}
          <br />
          Warning window: {evaluation.warningDays} days
        </span>
      </div>

      <nav className="ops-tabs" aria-label="Subcontractor sections">
        {TABS.map(t => (
          <Link key={t.key} href={href(t.key)} aria-current={tab === t.key ? 'page' : undefined}>
            {t.label}
            {t.key === 'insurance' && currentCerts.some(c => c.review_status === 'needs_review') && ' •'}
          </Link>
        ))}
      </nav>

      {/* ======================= OVERVIEW ======================= */}
      {tab === 'overview' && (
        <div className="ops-detail">
          <div style={{ maxWidth: 780 }}>
            <VendorForm
              vendor={vendor as VendorFormValues}
              templates={(templates ?? []).map(t => ({ id: t.id as string, name: t.name as string }))}
            />
          </div>
          <div className="ops-stack">
            <section className="ops-card">
              <div className="ops-card-head"><h2>At a glance</h2></div>
              <div className="ops-card-body">
                <dl className="ops-deflist">
                  <dt>Compliance</dt><dd><ComplianceBadge status={evaluation.status} /></dd>
                  <dt>Requirements</dt><dd>{evaluation.requirementCount} required coverage{evaluation.requirementCount === 1 ? '' : 's'}</dd>
                  <dt>Certificates</dt><dd>{ctx.certificates.length} on record ({historicalCerts.length} historical)</dd>
                  <dt>Documents</dt><dd>{documents.length}</dd>
                  <dt>Active projects</dt><dd>{projects.filter(p => p.active).length}</dd>
                  <dt>Last reviewed</dt><dd>{vendor.last_reviewed_at ? formatDate(vendor.last_reviewed_at) : 'Never'}</dd>
                  <dt>Last recalculated</dt><dd>{vendor.compliance_checked_at ? formatDateTime(vendor.compliance_checked_at) : '—'}</dd>
                </dl>
              </div>
            </section>

            {ctx.waivers.length > 0 && (
              <section className="ops-card">
                <div className="ops-card-head"><h2>Documented exceptions</h2></div>
                <div className="ops-card-body" style={{ display: 'grid', gap: 12 }}>
                  {ctx.waivers.map(w => (
                    <div key={w.id} style={{ borderBottom: '1px solid var(--ops-line)', paddingBottom: 10 }}>
                      <strong style={{ fontSize: '.82rem', color: 'var(--ops-ink)' }}>
                        {w.coverage_type ? COVERAGE_LABELS[w.coverage_type] : 'All coverages'}
                      </strong>
                      <p style={{ fontSize: '.82rem', marginTop: 3 }}>{w.reason}</p>
                      <p className="ops-hint">
                        Granted {formatDate(w.created_at)}
                        {w.expires_at ? ` · expires ${formatDate(w.expires_at)}` : ' · no expiry'}
                      </p>
                      {user.can('approveWaiver') && (
                        <div style={{ marginTop: 6 }}>
                          <RevokeWaiverButton waiverId={w.id} vendorId={vendor.id} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* ======================= PROJECTS ======================= */}
      {tab === 'projects' && (
        <div className="ops-card">
          <div className="ops-card-head"><h2>Projects</h2></div>
          {projects.length === 0 ? (
            <div className="ops-card-body">
              <p className="ops-hint">
                Not assigned to any project yet. Assign this subcontractor from a project’s
                Subcontractors tab.
              </p>
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr><th>Project</th><th>Scope</th><th>Start</th><th>End</th><th>Assignment</th></tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr key={p.id}>
                      <td data-label="Project" className="ops-cell-primary">
                        <Link className="ops-row-link" href={`/ops/projects/${p.id}`}>
                          {p.project_number} — {p.project_name}
                        </Link>
                      </td>
                      <td data-label="Scope">{p.scope ?? '—'}</td>
                      <td data-label="Start" className="nowrap">{p.start ? formatDate(p.start) : '—'}</td>
                      <td data-label="End" className="nowrap">{p.end ? formatDate(p.end) : '—'}</td>
                      <td data-label="Assignment">
                        <Badge tone={p.active ? 'info' : 'neutral'}>{p.active ? 'Active' : 'Ended'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======================= INSURANCE ======================= */}
      {tab === 'insurance' && (
        <div className="ops-stack">
          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Requirement matrix</h2>
              <div className="ops-card-actions">
                <span className="ops-hint">Evaluated {formatDate(evaluation.asOfDate)}</span>
              </div>
            </div>
            <RequirementMatrix checks={evaluation.checks} sources={evaluation.requirementSources} />
          </section>

          <section className="ops-card">
            <div className="ops-card-head">
              <h2>Current certificates</h2>
              <div className="ops-card-actions">
                <Link className="ops-btn ops-btn-sm ops-btn-primary" href={`/ops/compliance/upload?vendor=${vendor.id}`}>
                  <FileUp aria-hidden="true" /> Add certificate
                </Link>
              </div>
            </div>
            <div className="ops-card-body">
              {currentCerts.length === 0 ? (
                <p className="ops-hint">
                  No certificate on file. Upload the one they sent, or request a fresh one — either
                  way the coverage lines get entered so expirations can be tracked.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {currentCerts.map(cert => (
                    <CertificateCard key={cert.id} cert={cert} canReview={user.can('reviewCertificate')} />
                  ))}
                </div>
              )}
            </div>
          </section>

          {historicalCerts.length > 0 && (
            <section className="ops-card">
              <div className="ops-card-head">
                <h2>Historical certificates</h2>
                <div className="ops-card-actions">
                  <span className="ops-hint">Kept permanently — audits ask what was on file at the time</span>
                </div>
              </div>
              <div className="ops-card-body" style={{ display: 'grid', gap: 16 }}>
                {historicalCerts.map(cert => (
                  <CertificateCard key={cert.id} cert={cert} canReview={false} historical />
                ))}
              </div>
            </section>
          )}

          {(tokens ?? []).length > 0 && (
            <section className="ops-card">
              <div className="ops-card-head"><h2>Recent upload links</h2></div>
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead><tr><th>Requested</th><th>Created</th><th>Expires</th><th>State</th></tr></thead>
                  <tbody>
                    {(tokens ?? []).map(t => {
                      const expired = new Date(t.expires_at as string) < new Date()
                      return (
                        <tr key={t.id}>
                          <td data-label="Requested" className="ops-cell-primary">
                            {DOCUMENT_TYPE_LABELS[t.requested_document_type as DocumentType] ?? t.requested_document_type}
                          </td>
                          <td data-label="Created" className="nowrap">{formatDate(t.created_at)}</td>
                          <td data-label="Expires" className="nowrap">{formatDate(t.expires_at)}</td>
                          <td data-label="State">
                            {t.revoked_at ? <Badge tone="neutral">Revoked</Badge>
                              : expired ? <Badge tone="neutral">Expired</Badge>
                              : t.used_at ? <Badge tone="ok">Used {formatDate(t.used_at)}</Badge>
                              : <Badge tone="info">Active</Badge>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* ======================= DOCUMENTS ======================= */}
      {tab === 'agreement' && (
        <AgreementPanel
          vendorId={params.id}
          vendorName={vendor.legal_name}
          agreements={agreements}
          canManage={user.can('agreementsManage')}
        />
      )}

      {tab === 'documents' && (
        <div className="ops-detail">
          <section className="ops-card">
            <div className="ops-card-head"><h2>Documents on file</h2></div>
            {documents.length === 0 ? (
              <div className="ops-card-body"><p className="ops-hint">Nothing uploaded yet.</p></div>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead><tr><th>File</th><th>Type</th><th>Dated</th><th>Expires</th><th>Size</th><th /></tr></thead>
                  <tbody>
                    {documents.map(d => (
                      <tr key={d.id}>
                        <td data-label="File" className="ops-cell-primary">{d.original_filename}</td>
                        <td data-label="Type">{DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type}</td>
                        <td data-label="Dated" className="nowrap">{d.document_date ? formatDate(d.document_date) : '—'}</td>
                        <td data-label="Expires" className="nowrap">{d.expiration_date ? formatDate(d.expiration_date) : '—'}</td>
                        <td data-label="Size" className="nowrap">{formatBytes(d.size_bytes)}</td>
                        <td className="ops-actions">
                          <a className="ops-btn ops-btn-sm" href={`/api/documents/${d.id}/download`} rel="noopener">
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <DocumentUploader entityType="vendor" entityId={vendor.id} />
        </div>
      )}

      {/* ======================= NOTES ======================= */}
      {tab === 'notes' && (
        <div style={{ maxWidth: 720 }}>
          <NotesPanel
            entityType="vendor" entityId={vendor.id}
            notes={(notes ?? []).map(n => ({
              id: n.id as string, body: n.body as string, created_at: n.created_at as string,
              author: authorName(n),
            }))}
          />
        </div>
      )}

      {/* ======================= ACTIVITY ======================= */}
      {tab === 'activity' && (
        <div className="ops-card" style={{ maxWidth: 720 }}>
          <div className="ops-card-head"><h2>Activity</h2></div>
          <div className="ops-card-body">
            {(activity ?? []).length === 0 ? (
              <p className="ops-hint">Nothing logged yet.</p>
            ) : (
              <ul className="ops-timeline">
                {(activity ?? []).map(a => (
                  <li key={a.id}>
                    <span className={`tl-dot${String(a.action).startsWith('coi') ? ' accent' : ''}`} />
                    <span className="tl-body">
                      <strong>{ACTION_LABELS[a.action as string] ?? a.action}</strong>
                      <span>{formatDateTime(a.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function CertificateCard({
  cert,
  canReview,
  historical = false,
}: {
  cert: import('@/lib/ops/types').InsuranceCertificate
  canReview: boolean
  historical?: boolean
}) {
  const tone =
    cert.review_status === 'approved' ? 'ok'
    : cert.review_status === 'needs_review' ? 'warn'
    : cert.review_status === 'rejected' ? 'bad' : 'neutral'

  return (
    <article
      style={{
        border: '1px solid var(--ops-line)', borderRadius: 'var(--ops-r)',
        overflow: 'hidden', opacity: historical ? 0.92 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '11px 14px', background: 'var(--ops-raised)', borderBottom: '1px solid var(--ops-line)' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong style={{ fontSize: '.88rem', color: 'var(--ops-ink)' }}>
            Version {cert.version} · received {formatDate(cert.received_at)}
          </strong>
          <span className="ops-sub2">
            {cert.broker_name ?? 'Broker not recorded'}
            {cert.broker_email ? ` · ${cert.broker_email}` : ''}
            {' · '}
            {cert.source === 'vendor_portal' ? 'Uploaded by the vendor' : cert.source === 'admin_upload' ? 'Uploaded by the office' : 'Entered manually'}
          </span>
        </div>
        <Badge tone={tone as 'ok' | 'warn' | 'bad' | 'neutral'}>{cap(cert.review_status)}</Badge>
        {cert.document_id && (
          <a className="ops-btn ops-btn-sm" href={`/api/documents/${cert.document_id}/download`} rel="noopener">
            View source PDF
          </a>
        )}
      </div>

      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Coverage</th><th>Carrier</th><th>Policy #</th><th>Effective</th>
              <th>Expiration</th><th>Limits</th><th>AI</th><th>WOS</th><th>P/NC</th>
            </tr>
          </thead>
          <tbody>
            {(cert.insurance_policies ?? []).map(p => (
              <tr key={p.id}>
                <td>{COVERAGE_LABELS[p.coverage_type]}</td>
                <td>{p.carrier ?? '—'}</td>
                <td>{p.policy_number ?? '—'}</td>
                <td className="nowrap">{p.effective_date ? formatDate(p.effective_date) : '—'}</td>
                <td className="nowrap">{p.expiration_date ? formatDate(p.expiration_date) : '—'}</td>
                <td style={{ fontSize: '.76rem' }}>{describeLimits(p)}</td>
                <td>{p.additional_insured ? '✓' : '—'}</td>
                <td>{p.waiver_of_subrogation ? '✓' : '—'}</td>
                <td>{p.primary_noncontributory ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(canReview && cert.review_status === 'needs_review') && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--ops-line)' }}>
          <p className="ops-hint" style={{ marginBottom: 8 }}>
            Check the coverage lines above against the source document, then approve or reject.
            Approving supersedes the previous certificate; it does not delete it.
          </p>
          <ReviewCertificateButtons certificateId={cert.id} />
        </div>
      )}

      {cert.reviewer_notes && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--ops-line)', fontSize: '.8rem' }}>
          <strong>Reviewer notes:</strong> {cert.reviewer_notes}
        </div>
      )}
    </article>
  )
}

function authorName(note: unknown): string {
  const profile = (note as { profiles?: { full_name?: string | null; email?: string | null } | null }).profiles
  return profile?.full_name || profile?.email || 'Someone'
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}

interface RawAgreement {
  id: string
  status: AgreementStatus
  effective_date: string | null
  expiration_date: string | null
  signed_date: string | null
  document_id: string | null
  version: number
  notes: string | null
  created_at: string
  documents: { original_filename: string } | { original_filename: string }[] | null
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { canViewCosts, canViewProfit } from '@/lib/ops/auth/permissions'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { evaluateVendorContext, loadVendorComplianceContext } from '@/lib/ops/services/compliance'
import { listDocuments } from '@/lib/ops/services/documents'
import { loadProjectFinancials } from '@/lib/ops/services/invoices'
import { getSettings } from '@/lib/ops/services/settings'
import { calculateProfitability } from '@/lib/ops/finance/calc'
import { ACTION_LABELS } from '@/lib/ops/services/activity'
import {
  COMPLIANCE_DISCLAIMER, DOCUMENT_TYPE_LABELS, type ComplianceStatus, type ProjectStatus,
} from '@/lib/ops/types'
import { formatDate, formatDateTime } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import ProjectForm, { type ProjectFormValues } from '@/components/ops/ProjectForm'
import NotesPanel from '@/components/ops/NotesPanel'
import DocumentUploader from '@/components/ops/DocumentUploader'
import { AssignVendorForm, UnassignButton } from '@/components/ops/AssignVendorForm'
import ProjectPhotos, { type ProjectPhoto } from '@/components/ops/ProjectPhotos'
import JobFinancials from '@/components/ops/JobFinancials'
import type { CostCategory, InvoiceStatusValue, PhotoPhase } from '@/lib/ops/types'
import { Badge, ComplianceBadge, ProjectStatusBadge } from '@/components/ops/StatusBadge'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'subcontractors', label: 'Subcontractors' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'financials', label: 'Financials' },
  { key: 'photos', label: 'Photos' },
  { key: 'documents', label: 'Documents' },
  { key: 'notes', label: 'Notes' },
  { key: 'activity', label: 'Activity' },
] as const

const BLOCKING: ComplianceStatus[] = ['non_compliant', 'missing']

export default async function ProjectDetailPage({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { tab?: string; phase?: string }
}) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)
  const tab = TABS.find(t => t.key === searchParams.tab)?.key ?? 'overview'

  const showCosts = canViewCosts(user.role, settings)
  const showProfit = canViewProfit(user.role, settings)

  const { data: project } = await supabase
    .from('projects')
    .select('*, contacts(id, first_name, last_name, company_name, email, phone)')
    .eq('id', params.id).maybeSingle()
  if (!project) notFound()

  const [{ data: assignments }, { data: customers }, { data: staff }, { data: allVendors }, { data: notes }, { data: activity }, documents] =
    await Promise.all([
      supabase.from('project_vendors')
        .select('vendor_id, active, scope_of_work, start_date, end_date, vendors(id, legal_name, primary_trade, status, email)')
        .eq('project_id', params.id),
      supabase.from('contacts').select('id, first_name, last_name, company_name').is('archived_at', null).order('last_name').limit(500),
      supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
      supabase.from('vendors').select('id, legal_name, primary_trade, compliance_status')
        .is('archived_at', null).neq('status', 'blocked').order('legal_name'),
      supabase.from('notes').select('id, body, created_at, profiles:created_by(full_name, email)')
        .eq('entity_type', 'project').eq('entity_id', params.id).order('created_at', { ascending: false }),
      supabase.from('activity_log').select('id, action, created_at, actor_label')
        .eq('entity_type', 'project').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(40),
      listDocuments(supabase, { entityType: 'project', entityId: params.id }),
    ])

  const [financials, { data: photoRows }, { data: projectEstimates }] = await Promise.all([
    loadProjectFinancials(supabase, params.id, { includeCosts: showCosts }),
    supabase.from('project_photos')
      .select('id, phase, caption, taken_at, customer_visible, document_id, documents(original_filename)')
      .eq('project_id', params.id).order('taken_at', { ascending: false }).order('sort_order'),
    supabase.from('estimates')
      .select('id, estimate_number, title, status, total_cents')
      .or(`project_id.eq.${params.id},converted_project_id.eq.${params.id}`)
      .order('created_at', { ascending: false }),
  ])

  const profitability = calculateProfitability({
    contractAmountCents: financials.contractAmountCents,
    costs: financials.costs.map(c => ({ amountCents: c.amount_cents, category: c.category })),
    invoicedCents: financials.invoicedCents,
    paidCents: financials.paidCents,
  })

  const vendorNameById = new Map<string, string>(
    (allVendors ?? []).map(v => [v.id as string, v.legal_name as string]),
  )

  const photos: ProjectPhoto[] = ((photoRows ?? []) as unknown as RawProjectPhoto[]).map(row => {
    const doc = Array.isArray(row.documents) ? row.documents[0] : row.documents
    return {
      id: row.id,
      documentId: row.document_id,
      phase: row.phase,
      caption: row.caption,
      takenAt: row.taken_at,
      customerVisible: row.customer_visible,
      filename: doc?.original_filename ?? 'Photo',
    }
  })

  const assigned = (assignments ?? []).map(a => {
    const embedded = (a as unknown as { vendors: unknown }).vendors
    const vendor = (Array.isArray(embedded) ? embedded[0] : embedded) as
      { id: string; legal_name: string; primary_trade: string | null; status: string; email: string | null } | null
    return {
      vendor,
      active: a.active as boolean,
      scope: a.scope_of_work as string | null,
      start: a.start_date as string | null,
      end: a.end_date as string | null,
    }
  }).filter(a => a.vendor)

  // Compliance is evaluated in the context of THIS project, so a project-level
  // requirement override is honoured.
  const complianceRows = await Promise.all(
    assigned.filter(a => a.active).map(async a => {
      const ctx = await loadVendorComplianceContext(supabase, a.vendor!.id)
      if (!ctx) return null
      return { assignment: a, evaluation: evaluateVendorContext(ctx, { projectId: params.id }) }
    }),
  )
  const rows = complianceRows.filter(Boolean) as NonNullable<(typeof complianceRows)[number]>[]
  const blocked = rows.filter(r => BLOCKING.includes(r.evaluation.status))

  const customer = Array.isArray(project.contacts) ? project.contacts[0] : project.contacts
  const href = (t: string) => `/ops/projects/${params.id}?tab=${t}`

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/projects">Projects</Link> / {project.project_number}
          </div>
          <h1>{project.project_name}</h1>
          <p className="ops-sub">
            <ProjectStatusBadge status={project.status as ProjectStatus} />{' '}
            <span style={{ marginLeft: 8 }}>
              {project.jobsite_address ? `${project.jobsite_address}, ` : ''}{project.city ?? ''} ·{' '}
              {project.service_category ?? 'Category not set'}
            </span>
          </p>
        </div>
        <div className="ops-page-actions">
          {customer && (
            <Link className="ops-btn" href={`/ops/contacts/${customer.id}`}>Customer</Link>
          )}
          <Link className="ops-btn ops-btn-dark" href={href('compliance')}>Compliance</Link>
        </div>
      </div>

      {blocked.length > 0 && (
        <div className="ops-banner bad" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>
              {blocked.length} subcontractor{blocked.length === 1 ? '' : 's'} on this job should not be scheduled
            </strong>
            {blocked.map(b => b.assignment.vendor!.legal_name).join(', ')} —{' '}
            insurance is missing or does not meet the configured requirements.
          </div>
          <div className="ops-banner-actions">
            <Link className="ops-btn ops-btn-sm" href={href('compliance')}>Review</Link>
          </div>
        </div>
      )}

      <nav className="ops-tabs" aria-label="Project sections">
        {TABS.map(t => (
          <Link key={t.key} href={href(t.key)} aria-current={tab === t.key ? 'page' : undefined}>
            {t.label}{t.key === 'compliance' && blocked.length > 0 && ' •'}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="ops-detail">
          <div style={{ maxWidth: 820 }}>
            <ProjectForm
              project={project as ProjectFormValues}
              customers={(customers ?? []).map(c => ({
                id: c.id as string,
                label: [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string) || 'Unnamed',
              }))}
              staff={(staff ?? []).map(s => ({ id: s.id as string, label: (s.full_name as string) || (s.email as string) }))}
            />
          </div>
          <div className="ops-stack">
            <section className="ops-card">
              <div className="ops-card-head"><h2>Summary</h2></div>
              <div className="ops-card-body">
                <dl className="ops-deflist">
                  <dt>Project number</dt><dd>{project.project_number}</dd>
                  <dt>Customer</dt>
                  <dd>
                    {customer
                      ? <Link href={`/ops/contacts/${customer.id}`} style={{ color: 'var(--ops-accent)' }}>
                          {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name}
                        </Link>
                      : 'Not linked'}
                  </dd>
                  <dt>Estimate</dt><dd>{formatCents(project.estimate_amount_cents)}</dd>
                  <dt>Contract</dt><dd>{formatCents(project.contract_amount_cents)}</dd>
                  <dt>Permit</dt><dd>{project.permit_number ?? '—'} {project.permit_status ? `(${project.permit_status})` : ''}</dd>
                  <dt>Subcontractors</dt><dd>{assigned.filter(a => a.active).length} active</dd>
                  <dt>Documents</dt><dd>{documents.length}</dd>
                  <dt>Created</dt><dd>{formatDate(project.created_at)}</dd>
                </dl>
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === 'subcontractors' && (
        <div className="ops-detail">
          <section className="ops-card">
            <div className="ops-card-head"><h2>Assigned subcontractors</h2></div>
            {assigned.length === 0 ? (
              <div className="ops-card-body"><p className="ops-hint">Nobody assigned yet.</p></div>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead>
                    <tr><th>Subcontractor</th><th>Trade</th><th>Scope</th><th>Dates</th><th>Assignment</th><th /></tr>
                  </thead>
                  <tbody>
                    {assigned.map(a => (
                      <tr key={a.vendor!.id}>
                        <td data-label="Subcontractor" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/subcontractors/${a.vendor!.id}`}>
                            {a.vendor!.legal_name}
                          </Link>
                        </td>
                        <td data-label="Trade">{a.vendor!.primary_trade ?? '—'}</td>
                        <td data-label="Scope">{a.scope ?? '—'}</td>
                        <td data-label="Dates" className="nowrap">
                          {a.start ? formatDate(a.start) : '—'} → {a.end ? formatDate(a.end) : 'open'}
                        </td>
                        <td data-label="Assignment">
                          <Badge tone={a.active ? 'info' : 'neutral'}>{a.active ? 'Active' : 'Ended'}</Badge>
                        </td>
                        <td className="ops-actions">
                          {a.active && user.can('assignVendorToProject') && (
                            <UnassignButton projectId={params.id} vendorId={a.vendor!.id} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {user.can('assignVendorToProject') && (
            <AssignVendorForm
              projectId={params.id}
              vendors={(allVendors ?? [])
                .filter(v => !assigned.some(a => a.active && a.vendor!.id === v.id))
                .map(v => ({
                  id: v.id as string,
                  label: `${v.legal_name}${v.primary_trade ? ` — ${v.primary_trade}` : ''}`,
                  status: v.compliance_status as string,
                }))}
            />
          )}
        </div>
      )}

      {tab === 'compliance' && (
        <>
          <div className="ops-card">
            <div className="ops-card-head">
              <h2>Are the subs on this job cleared?</h2>
              <div className="ops-card-actions">
                <span className="ops-hint">Evaluated against this project’s requirements</span>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="ops-card-body">
                <p className="ops-hint">No active subcontractors on this project yet.</p>
              </div>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead>
                    <tr><th>Subcontractor</th><th>Trade</th><th>Status</th><th>Detail</th><th>Earliest expiration</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map(({ assignment, evaluation }) => (
                      <tr key={assignment.vendor!.id}>
                        <td data-label="Subcontractor" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/subcontractors/${assignment.vendor!.id}?tab=insurance`}>
                            {assignment.vendor!.legal_name}
                          </Link>
                        </td>
                        <td data-label="Trade">{assignment.vendor!.primary_trade ?? '—'}</td>
                        <td data-label="Status"><ComplianceBadge status={evaluation.status} /></td>
                        <td data-label="Detail" style={{ fontSize: '.8rem', color: 'var(--ops-muted)' }}>
                          {evaluation.summary}
                        </td>
                        <td data-label="Earliest expiration" className="nowrap">
                          {evaluation.earliestExpiration ? formatDate(evaluation.earliestExpiration) : '—'}
                        </td>
                        <td className="ops-actions">
                          <Link className="ops-btn ops-btn-sm" href={`/ops/subcontractors/${assignment.vendor!.id}?tab=insurance`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {rows.length > 0 && blocked.length === 0 && (
            <div className="ops-banner ok" style={{ marginTop: 16 }}>
              <CheckCircle2 aria-hidden="true" />
              <div>Every active subcontractor on this job has documentation on file that meets the configured requirements.</div>
            </div>
          )}
          <p className="ops-disclaimer">{COMPLIANCE_DISCLAIMER}</p>
        </>
      )}

      {tab === 'financials' && (
        <>
          <JobFinancials
            projectId={params.id}
            profitability={profitability}
            invoices={financials.invoices
              .filter(i => showCosts || i.status !== 'draft')
              .map(i => ({
                id: i.id,
                invoiceNumber: i.invoice_number,
                status: i.status as InvoiceStatusValue,
                issueDate: i.issue_date,
                totalCents: i.total_cents,
                paidCents: i.amount_paid_cents,
                balanceCents: i.balance_due_cents,
              }))}
            costs={financials.costs.map(c => ({
              id: c.id,
              category: c.category as CostCategory,
              description: c.description,
              amountCents: c.amount_cents,
              costDate: c.cost_date,
              vendorName: vendorNameById.get(c.vendor_id ?? '') ?? null,
              documentId: c.document_id,
            }))}
            vendors={(allVendors ?? []).map(v => ({
              id: v.id as string, label: v.legal_name as string,
            }))}
            canViewCosts={showCosts}
            canEditCosts={showCosts && user.can('costsEdit')}
            canViewProfit={showProfit}
            canCreateInvoice={user.can('invoicesCreate')}
            approvedEstimates={(projectEstimates ?? [])
              .filter(e => e.status === 'approved')
              .map(e => ({
                id: e.id as string,
                label: `${e.estimate_number} — ${(e.title as string) || 'Estimate'} · ${formatCents(e.total_cents as number)}`,
              }))}
          />
          {!showCosts && (
            <p className="ops-hint" style={{ marginTop: 12 }}>
              Job costs are hidden for your role. Invoices and payments are still shown because
              they are what the customer sees.
            </p>
          )}
        </>
      )}

      {tab === 'photos' && (
        <ProjectPhotos
          projectId={params.id}
          photos={photos}
          canUpload={user.can('photosUpload')}
          activePhase={searchParams.phase}
        />
      )}

      {tab === 'documents' && (
        <div className="ops-detail">
          <section className="ops-card">
            <div className="ops-card-head"><h2>Project documents</h2></div>
            {documents.length === 0 ? (
              <div className="ops-card-body"><p className="ops-hint">Nothing uploaded yet.</p></div>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table ops-table-cards">
                  <thead><tr><th>File</th><th>Type</th><th>Uploaded</th><th /></tr></thead>
                  <tbody>
                    {documents.map(d => (
                      <tr key={d.id}>
                        <td data-label="File" className="ops-cell-primary">{d.original_filename}</td>
                        <td data-label="Type">{DOCUMENT_TYPE_LABELS[d.document_type]}</td>
                        <td data-label="Uploaded" className="nowrap">{formatDate(d.uploaded_at)}</td>
                        <td className="ops-actions">
                          <a className="ops-btn ops-btn-sm" href={`/api/documents/${d.id}/download`}>Download</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <DocumentUploader entityType="project" entityId={params.id} defaultType="permit" />
        </div>
      )}

      {tab === 'notes' && (
        <div style={{ maxWidth: 720 }}>
          <NotesPanel
            entityType="project" entityId={params.id}
            notes={(notes ?? []).map(n => ({
              id: n.id as string, body: n.body as string, created_at: n.created_at as string,
              author: authorName(n),
            }))}
          />
        </div>
      )}

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
        </div>
      )}
    </>
  )
}

function authorName(note: unknown): string {
  const profile = (note as { profiles?: { full_name?: string | null; email?: string | null } | null }).profiles
  return profile?.full_name || profile?.email || 'Someone'
}

interface RawProjectPhoto {
  id: string
  document_id: string
  phase: PhotoPhase
  caption: string | null
  taken_at: string | null
  customer_visible: boolean
  documents: { original_filename: string } | { original_filename: string }[] | null
}

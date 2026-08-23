import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { listDocuments } from '@/lib/ops/services/documents'
import { formatDate, formatDateTime } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import { DOCUMENT_TYPE_LABELS, type ProjectStatus } from '@/lib/ops/types'
import ContactForm, { type ContactFormValues } from '@/components/ops/ContactForm'
import NotesPanel from '@/components/ops/NotesPanel'
import DocumentUploader from '@/components/ops/DocumentUploader'
import CreateJobButton from '@/components/ops/CreateJobButton'
import { ProjectStatusBadge } from '@/components/ops/StatusBadge'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Projects' },
  { key: 'documents', label: 'Documents' },
  { key: 'notes', label: 'Notes' },
] as const

export default async function ContactDetailPage({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { tab?: string }
}) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const tab = TABS.find(t => t.key === searchParams.tab)?.key ?? 'overview'

  const { data: contact } = await supabase.from('contacts').select('*').eq('id', params.id).maybeSingle()
  if (!contact) notFound()

  const [{ data: projects }, { data: leads }, { data: notes }, documents] = await Promise.all([
    supabase.from('projects')
      .select('id, project_number, project_name, status, start_date, contract_amount_cents')
      .eq('customer_id', params.id).order('created_at', { ascending: false }),
    supabase.from('leads').select('id, first_name, last_name, service_type, created_at')
      .eq('converted_contact_id', params.id),
    supabase.from('notes').select('id, body, created_at, profiles:created_by(full_name, email)')
      .eq('entity_type', 'contact').eq('entity_id', params.id).order('created_at', { ascending: false }),
    listDocuments(supabase, { entityType: 'contact', entityId: params.id }),
  ])

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name || 'Contact'
  const href = (t: string) => `/ops/contacts/${params.id}?tab=${t}`

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/contacts">Contacts</Link> / {name}</div>
          <h1>{name}</h1>
          <p className="ops-sub">
            {contact.company_name && `${contact.company_name} · `}
            {contact.city ?? 'City not recorded'} · added {formatDate(contact.created_at)}
          </p>
        </div>
        <div className="ops-page-actions">
          {contact.phone && <a className="ops-btn" href={`tel:${String(contact.phone).replace(/\D/g, '')}`}>Call</a>}
          {contact.email && <a className="ops-btn" href={`mailto:${contact.email}`}>Email</a>}
          <Link className="ops-btn" href={`/ops/projects/new?customer=${params.id}`}>New project…</Link>
          {user.can('writeRecords') && <CreateJobButton contactId={params.id} contactName={name} />}
        </div>
      </div>

      <nav className="ops-tabs" aria-label="Contact sections">
        {TABS.map(t => (
          <Link key={t.key} href={href(t.key)} aria-current={tab === t.key ? 'page' : undefined}>{t.label}</Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="ops-detail">
          <div style={{ maxWidth: 720 }}>
            <ContactForm contact={contact as ContactFormValues} />
          </div>
          <section className="ops-card">
            <div className="ops-card-head"><h2>History</h2></div>
            <div className="ops-card-body">
              <dl className="ops-deflist">
                <dt>Projects</dt><dd>{(projects ?? []).length}</dd>
                <dt>Originating leads</dt><dd>{(leads ?? []).length}</dd>
                <dt>Documents</dt><dd>{documents.length}</dd>
                <dt>Added</dt><dd>{formatDateTime(contact.created_at)}</dd>
              </dl>
              {(leads ?? []).length > 0 && (
                <ul style={{ marginTop: 14, display: 'grid', gap: 6 }}>
                  {(leads ?? []).map(l => (
                    <li key={l.id} style={{ fontSize: '.82rem' }}>
                      <Link href={`/ops/leads/${l.id}`} style={{ color: 'var(--ops-accent)' }}>
                        Lead · {l.service_type ?? 'Enquiry'} · {formatDate(l.created_at)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'projects' && (
        <div className="ops-card">
          <div className="ops-card-head"><h2>Projects</h2></div>
          {(projects ?? []).length === 0 ? (
            <div className="ops-card-body"><p className="ops-hint">No projects yet.</p></div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead><tr><th>Project</th><th>Status</th><th>Start</th><th>Contract</th></tr></thead>
                <tbody>
                  {(projects ?? []).map(p => (
                    <tr key={p.id}>
                      <td data-label="Project" className="ops-cell-primary">
                        <Link className="ops-row-link" href={`/ops/projects/${p.id}`}>
                          {p.project_number} — {p.project_name}
                        </Link>
                      </td>
                      <td data-label="Status"><ProjectStatusBadge status={p.status as ProjectStatus} /></td>
                      <td data-label="Start" className="nowrap">{p.start_date ? formatDate(p.start_date) : '—'}</td>
                      <td data-label="Contract" className="num">{formatCents(p.contract_amount_cents as number | null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="ops-detail">
          <section className="ops-card">
            <div className="ops-card-head"><h2>Documents</h2></div>
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
          <DocumentUploader entityType="contact" entityId={params.id} defaultType="contract" />
        </div>
      )}

      {tab === 'notes' && (
        <div style={{ maxWidth: 720 }}>
          <NotesPanel
            entityType="contact" entityId={params.id}
            notes={(notes ?? []).map(n => ({
              id: n.id as string, body: n.body as string, created_at: n.created_at as string,
              author: authorName(n),
            }))}
          />
        </div>
      )}
    </>
  )
}

function authorName(note: unknown): string {
  const profile = (note as { profiles?: { full_name?: string | null; email?: string | null } | null }).profiles
  return profile?.full_name || profile?.email || 'Someone'
}

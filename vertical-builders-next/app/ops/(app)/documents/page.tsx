import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType } from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'
import { formatBytes } from '@/lib/ops/utils/files'
import { Badge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; entity?: string; page?: string }
}) {
  await requireUser()
  const supabase = createSupabaseServerClient()
  const { q, type, entity } = searchParams
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('documents')
    .select('id, entity_type, entity_id, document_type, original_filename, size_bytes, document_date, expiration_date, uploaded_at, version', { count: 'exact' })
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false })

  if (type) query = query.eq('document_type', type)
  if (entity) query = query.eq('entity_type', entity)
  if (q) query = query.ilike('original_filename', `%${q.replace(/[%_,()]/g, ' ')}%`)

  const from = (page - 1) * PAGE_SIZE
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  const documents = data ?? []

  // Resolve the owning record names in one round trip per entity type.
  const vendorIds = documents.filter(d => d.entity_type === 'vendor').map(d => d.entity_id as string)
  const projectIds = documents.filter(d => d.entity_type === 'project').map(d => d.entity_id as string)
  const contactIds = documents.filter(d => d.entity_type === 'contact').map(d => d.entity_id as string)

  const [{ data: vendors }, { data: projects }, { data: contacts }] = await Promise.all([
    vendorIds.length ? supabase.from('vendors').select('id, legal_name').in('id', vendorIds) : { data: [] },
    projectIds.length ? supabase.from('projects').select('id, project_number, project_name').in('id', projectIds) : { data: [] },
    contactIds.length ? supabase.from('contacts').select('id, first_name, last_name, company_name').in('id', contactIds) : { data: [] },
  ])

  const nameFor = (entityType: string, id: string): { label: string; href: string | null } => {
    if (entityType === 'vendor') {
      const v = (vendors ?? []).find(x => x.id === id)
      return { label: (v?.legal_name as string) ?? 'Subcontractor', href: `/ops/subcontractors/${id}` }
    }
    if (entityType === 'project') {
      const p = (projects ?? []).find(x => x.id === id)
      return { label: p ? `${p.project_number} ${p.project_name}` : 'Project', href: `/ops/projects/${id}` }
    }
    if (entityType === 'contact') {
      const c = (contacts ?? []).find(x => x.id === id)
      return {
        label: c ? ([c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string)) : 'Contact',
        href: `/ops/contacts/${id}`,
      }
    }
    return { label: entityType, href: null }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Compliance</div>
          <h1>Document vault</h1>
          <p className="ops-sub">
            Every certificate, endorsement, W-9, license, permit and contract in one private store.
            Files are never public — each download is a short-lived signed link.
          </p>
        </div>
      </div>

      <div className="ops-card">
        <FilterBar action="/ops/documents" q={q} placeholder="Filename…"
          count={count !== null ? `${count} document${count === 1 ? '' : 's'}` : undefined}>
          <FilterSelect name="type" value={type} label="Type"
            options={DOCUMENT_TYPES.map(t => ({ value: t, label: DOCUMENT_TYPE_LABELS[t] }))} />
          <FilterSelect name="entity" value={entity} label="Attached to"
            options={[
              { value: 'vendor', label: 'Subcontractor' },
              { value: 'project', label: 'Project' },
              { value: 'contact', label: 'Contact' },
              { value: 'audit', label: 'Audit' },
            ]} />
        </FilterBar>

        {documents.length === 0 ? (
          <EmptyState
            title={q || type || entity ? 'No documents match' : 'The vault is empty'}
            message={
              q || type || entity
                ? 'Clear the filters to see everything.'
                : 'Upload a certificate from a subcontractor record, or ask a vendor to upload one through a secure link.'
            }
            actionLabel="Upload a COI"
            actionHref="/ops/compliance/upload"
          />
        ) : (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>File</th><th>Type</th><th>Attached to</th><th>Dated</th>
                    <th>Expires</th><th>Ver.</th><th>Size</th><th />
                  </tr>
                </thead>
                <tbody>
                  {documents.map(d => {
                    const owner = nameFor(d.entity_type as string, d.entity_id as string)
                    const expired = d.expiration_date && (d.expiration_date as string) < today
                    return (
                      <tr key={d.id}>
                        <td data-label="File" className="ops-cell-primary">{d.original_filename}</td>
                        <td data-label="Type">{DOCUMENT_TYPE_LABELS[d.document_type as DocumentType] ?? d.document_type}</td>
                        <td data-label="Attached to">
                          {owner.href
                            ? <Link href={owner.href} style={{ color: 'var(--ops-accent)' }}>{owner.label}</Link>
                            : owner.label}
                        </td>
                        <td data-label="Dated" className="nowrap">{d.document_date ? formatDate(d.document_date) : '—'}</td>
                        <td data-label="Expires" className="nowrap">
                          {d.expiration_date
                            ? <Badge tone={expired ? 'bad' : 'ok'}>{formatDate(d.expiration_date)}</Badge>
                            : '—'}
                        </td>
                        <td data-label="Version" className="num">{d.version}</td>
                        <td data-label="Size" className="nowrap">{formatBytes(d.size_bytes as number | null)}</td>
                        <td className="ops-actions">
                          <a className="ops-btn ops-btn-sm" href={`/api/documents/${d.id}/download`} rel="noopener">Download</a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/ops/documents" params={{ q, type, entity }} />
          </>
        )}
      </div>
    </>
  )
}

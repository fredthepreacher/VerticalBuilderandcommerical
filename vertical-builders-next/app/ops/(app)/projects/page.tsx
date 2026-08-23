import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import { ProjectStatusBadge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string }
}) {
  await requireUser()
  const supabase = createSupabaseServerClient()
  const { q, status } = searchParams
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('projects')
    .select(
      'id, project_number, project_name, status, city, service_category, start_date,' +
      'estimated_completion_date, contract_amount_cents, contacts(first_name, last_name, company_name)',
      { count: 'exact' },
    )
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (q) {
    const p = `%${q.replace(/[%_,()]/g, ' ')}%`
    query = query.or(`project_number.ilike.${p},project_name.ilike.${p},jobsite_address.ilike.${p},city.ilike.${p},permit_number.ilike.${p}`)
  }

  const from = (page - 1) * PAGE_SIZE
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  const projects = (data ?? []) as unknown as ProjectRow[]

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Sales</div>
          <h1>Projects</h1>
          <p className="ops-sub">
            Consultation through final walkthrough. Each project shows whether the subcontractors on
            it are cleared to work.
          </p>
        </div>
        <div className="ops-page-actions">
          <Link href="/ops/projects/new" className="ops-btn ops-btn-primary"><Plus aria-hidden="true" /> New project</Link>
        </div>
      </div>

      <div className="ops-card">
        <FilterBar action="/ops/projects" q={q} placeholder="Project number, name, address, permit…"
          count={count !== null ? `${count} project${count === 1 ? '' : 's'}` : undefined}>
          <FilterSelect name="status" value={status} label="Status"
            options={PROJECT_STATUSES.map(s => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))} />
        </FilterBar>

        {projects.length === 0 ? (
          <EmptyState
            title={q || status ? 'No projects match' : 'No projects yet'}
            message={
              q || status
                ? 'Clear the filters to see everything.'
                : 'Projects are created when you convert a lead, or you can start one directly.'
            }
            actionLabel="Create a project"
            actionHref="/ops/projects/new"
          />
        ) : (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>Project</th><th>Customer</th><th>Category</th><th>Status</th>
                    <th>Start</th><th>Est. completion</th><th className="num">Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => {
                    const customer = Array.isArray(p.contacts) ? p.contacts[0] : p.contacts
                    return (
                      <tr key={p.id}>
                        <td data-label="Project" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/projects/${p.id}`}>
                            {p.project_number} — {p.project_name}
                          </Link>
                          {p.city && <span className="ops-sub2">{p.city}</span>}
                        </td>
                        <td data-label="Customer">
                          {customer
                            ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || '—'
                            : '—'}
                        </td>
                        <td data-label="Category">{p.service_category ?? '—'}</td>
                        <td data-label="Status"><ProjectStatusBadge status={p.status} /></td>
                        <td data-label="Start" className="nowrap">{p.start_date ? formatDate(p.start_date) : '—'}</td>
                        <td data-label="Est. completion" className="nowrap">
                          {p.estimated_completion_date ? formatDate(p.estimated_completion_date) : '—'}
                        </td>
                        <td data-label="Contract" className="num">{formatCents(p.contract_amount_cents)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/ops/projects" params={{ q, status }} />
          </>
        )}
      </div>
    </>
  )
}

interface ProjectRow {
  id: string
  project_number: string
  project_name: string
  status: ProjectStatus
  city: string | null
  service_category: string | null
  start_date: string | null
  estimated_completion_date: string | null
  contract_amount_cents: number | null
  contacts:
    | { first_name: string | null; last_name: string | null; company_name: string | null }
    | { first_name: string | null; last_name: string | null; company_name: string | null }[]
    | null
}

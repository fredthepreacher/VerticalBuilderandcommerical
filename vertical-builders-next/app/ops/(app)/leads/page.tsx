import Link from 'next/link'
import { KanbanSquare, Plus, Table2 } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { LEAD_STAGES, LEAD_STAGE_LABELS, OPEN_LEAD_STAGES, type LeadStage } from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'
import { LeadStageBadge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

interface LeadRow {
  id: string
  first_name: string
  last_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  service_type: string | null
  customer_type: string | null
  pipeline_stage: LeadStage
  source: string
  created_at: string
  next_follow_up_at: string | null
  converted_project_id: string | null
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { q?: string; stage?: string; view?: string; page?: string }
}) {
  await requireUser()
  const supabase = createSupabaseServerClient()

  const q = searchParams.q?.trim()
  const stage = searchParams.stage
  const view = searchParams.view === 'kanban' ? 'kanban' : 'table'
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('leads')
    .select(
      'id, first_name, last_name, company_name, email, phone, city, service_type, customer_type,' +
      'pipeline_stage, source, created_at, next_follow_up_at, converted_project_id',
      { count: 'exact' },
    )
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (stage) query = query.eq('pipeline_stage', stage)
  if (q) {
    const p = `%${q.replace(/[%_,()]/g, ' ')}%`
    query = query.or(
      `first_name.ilike.${p},last_name.ilike.${p},company_name.ilike.${p},email.ilike.${p},phone.ilike.${p},property_address.ilike.${p},city.ilike.${p}`,
    )
  }

  const kanbanLimit = view === 'kanban' ? 400 : PAGE_SIZE
  const from = view === 'kanban' ? 0 : (page - 1) * PAGE_SIZE
  const { data, count, error } = await query.range(from, from + kanbanLimit - 1)
  const leads = (data ?? []) as unknown as LeadRow[]

  const otherView = view === 'kanban' ? 'table' : 'kanban'
  const viewHref = (v: string) => {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (stage) sp.set('stage', stage)
    if (v !== 'table') sp.set('view', v)
    const s = sp.toString()
    return `/ops/leads${s ? `?${s}` : ''}`
  }

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Sales</div>
          <h1>Leads</h1>
          <p className="ops-sub">
            Every enquiry from the public website lands here automatically, alongside anything the
            office adds by hand.
          </p>
        </div>
        <div className="ops-page-actions">
          <Link href={viewHref(otherView)} className="ops-btn">
            {otherView === 'kanban' ? <KanbanSquare aria-hidden="true" /> : <Table2 aria-hidden="true" />}
            {otherView === 'kanban' ? 'Kanban view' : 'Table view'}
          </Link>
          <Link href="/ops/leads/new" className="ops-btn ops-btn-primary"><Plus aria-hidden="true" /> New lead</Link>
        </div>
      </div>

      {error && (
        <div className="ops-banner bad" role="alert">
          <div>The lead list could not be loaded. Reload the page, or contact an administrator if it persists.</div>
        </div>
      )}

      <div className="ops-card">
        <FilterBar action="/ops/leads" q={q} placeholder="Name, email, phone, address…"
          count={count !== null ? `${count} lead${count === 1 ? '' : 's'}` : undefined}>
          <FilterSelect
            name="stage" value={stage} label="Stage"
            options={LEAD_STAGES.map(s => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
          />
          {view === 'kanban' && <input type="hidden" name="view" value="kanban" />}
        </FilterBar>

        {leads.length === 0 ? (
          <EmptyState
            title={q || stage ? 'No leads match those filters' : 'No leads yet'}
            message={
              q || stage
                ? 'Try clearing the filters, or search by phone number instead.'
                : 'Website enquiries appear here within seconds of being submitted. You can also add one manually.'
            }
            actionLabel="Add a lead"
            actionHref="/ops/leads/new"
          />
        ) : view === 'kanban' ? (
          <div className="ops-card-body">
            <div className="ops-kanban">
              {LEAD_STAGES.map(s => {
                const items = leads.filter(l => l.pipeline_stage === s)
                return (
                  <div className="ops-kanban-col" key={s}>
                    <h3>{LEAD_STAGE_LABELS[s]} <b>{items.length}</b></h3>
                    {items.map(l => (
                      <Link key={l.id} href={`/ops/leads/${l.id}`} className="ops-kanban-card">
                        <strong>{[l.first_name, l.last_name].filter(Boolean).join(' ')}</strong>
                        <span>{l.service_type ?? 'Service not set'}{l.city ? ` · ${l.city}` : ''}</span>
                        <span>{formatDate(l.created_at)}</span>
                      </Link>
                    ))}
                    {items.length === 0 && (
                      <p className="ops-hint" style={{ padding: '4px 2px' }}>Nothing here.</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>Name</th><th>Service</th><th>Type</th><th>City</th>
                    <th>Stage</th><th>Source</th><th>Received</th><th />
                  </tr>
                </thead>
                <tbody>
                  {leads.map(lead => (
                    <tr key={lead.id}>
                      <td data-label="Name" className="ops-cell-primary">
                        <Link className="ops-row-link" href={`/ops/leads/${lead.id}`}>
                          {[lead.first_name, lead.last_name].filter(Boolean).join(' ')}
                        </Link>
                        <span className="ops-sub2">{lead.phone ?? lead.email ?? '—'}</span>
                      </td>
                      <td data-label="Service">{lead.service_type ?? '—'}</td>
                      <td data-label="Type" style={{ textTransform: 'capitalize' }}>{lead.customer_type ?? '—'}</td>
                      <td data-label="City">{lead.city ?? '—'}</td>
                      <td data-label="Stage"><LeadStageBadge stage={lead.pipeline_stage} /></td>
                      <td data-label="Source" style={{ textTransform: 'capitalize' }}>{lead.source}</td>
                      <td data-label="Received" className="nowrap">{formatDate(lead.created_at)}</td>
                      <td className="ops-actions">
                        {lead.converted_project_id ? (
                          <Link className="ops-btn ops-btn-sm" href={`/ops/projects/${lead.converted_project_id}`}>
                            Project
                          </Link>
                        ) : (
                          <Link className="ops-btn ops-btn-sm" href={`/ops/leads/${lead.id}`}>Open</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page} pageSize={PAGE_SIZE} total={count ?? 0}
              basePath="/ops/leads" params={{ q, stage }}
            />
          </>
        )}
      </div>

      <p className="ops-hint" style={{ marginTop: 14 }}>
        {OPEN_LEAD_STAGES.length} of the {LEAD_STAGES.length} stages count as “open” for dashboard totals —
        everything except Won and Lost.
      </p>
    </>
  )
}

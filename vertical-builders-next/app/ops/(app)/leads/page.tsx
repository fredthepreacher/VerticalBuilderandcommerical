import Link from 'next/link'
import { KanbanSquare, Plus, Table2, Upload } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import {
  LEAD_RECORD_TYPES, LEAD_RECORD_TYPE_LABELS, LEAD_STAGES, LEAD_STAGE_LABELS,
  OPEN_LEAD_STAGES, type LeadRecordType, type LeadStage,
} from '@/lib/ops/types'
import { formatAddressLine } from '@/lib/ops/imports/address'
import { formatDate } from '@/lib/ops/utils/dates'
import { LeadStageBadge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

interface LeadRow {
  id: string
  /** Nullable since 0012: a property prospect is identified by its address. */
  first_name: string | null
  last_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  stop_number: string | null
  import_batch_tag: string | null
  record_type: LeadRecordType
  service_type: string | null
  customer_type: string | null
  pipeline_stage: LeadStage
  source: string
  created_at: string
  next_follow_up_at: string | null
  converted_project_id: string | null
}

/**
 * What to call a lead in a list.
 *
 * A property prospect has no name until somebody knocks on the door, so the
 * address is the name. Rendering a blank cell — or worse, a placeholder like
 * "Unknown" — would make a legitimate record look broken.
 *
 * Once an owner name is added the record starts displaying it, with no change
 * to the record type and no second record: the same row simply has more in it.
 */
function displayName(lead: LeadRow): { primary: string; secondary: string | null } {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.company_name
  const address = formatAddressLine(lead)
  if (name) return { primary: name, secondary: address || lead.phone || lead.email || null }
  return { primary: address || 'Unnamed lead', secondary: lead.phone || lead.email || null }
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: {
    q?: string; stage?: string; view?: string; page?: string
    type?: string; city?: string; zip?: string; batch?: string
  }
}) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()

  const q = searchParams.q?.trim()
  const stage = searchParams.stage
  const recordType = LEAD_RECORD_TYPES.includes(searchParams.type as LeadRecordType)
    ? searchParams.type
    : undefined
  const city = searchParams.city?.trim() || undefined
  const zip = searchParams.zip?.trim() || undefined
  const batch = searchParams.batch?.trim() || undefined
  const view = searchParams.view === 'kanban' ? 'kanban' : 'table'
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('leads')
    .select(
      'id, first_name, last_name, company_name, email, phone,' +
      'property_address, city, state, zip, stop_number, import_batch_tag, record_type,' +
      'service_type, customer_type, pipeline_stage, source, created_at, next_follow_up_at,' +
      'converted_project_id',
      { count: 'exact' },
    )
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (stage) query = query.eq('pipeline_stage', stage)
  if (recordType) query = query.eq('record_type', recordType)
  if (city) query = query.ilike('city', city)
  if (zip) query = query.eq('zip', zip)
  if (batch) query = query.eq('import_batch_tag', batch)
  if (q) {
    const p = `%${q.replace(/[%_,()]/g, ' ')}%`
    query = query.or(
      `first_name.ilike.${p},last_name.ilike.${p},company_name.ilike.${p},email.ilike.${p},` +
      `phone.ilike.${p},property_address.ilike.${p},city.ilike.${p},zip.ilike.${p},` +
      `stop_number.ilike.${p},import_batch_tag.ilike.${p}`,
    )
  }

  const kanbanLimit = view === 'kanban' ? 400 : PAGE_SIZE
  const from = view === 'kanban' ? 0 : (page - 1) * PAGE_SIZE

  // The filter dropdowns are built from what actually exists, so a company that
  // has never imported a batch never sees an empty Batch selector.
  const [{ data, count, error }, { data: facetRows }] = await Promise.all([
    query.range(from, from + kanbanLimit - 1),
    supabase.from('leads')
      .select('city, import_batch_tag')
      .is('archived_at', null)
      .limit(5_000),
  ])

  const leads = (data ?? []) as unknown as LeadRow[]

  const batchTags = [...new Set((facetRows ?? [])
    .map(r => (r.import_batch_tag as string | null)?.trim())
    .filter((t): t is string => Boolean(t)))].sort().slice(0, 100)

  const cities = [...new Set((facetRows ?? [])
    .map(r => (r.city as string | null)?.trim())
    .filter((c): c is string => Boolean(c)))].sort().slice(0, 200)

  const otherView = view === 'kanban' ? 'table' : 'kanban'
  const viewHref = (v: string) => {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (stage) sp.set('stage', stage)
    if (recordType) sp.set('type', recordType)
    if (city) sp.set('city', city)
    if (zip) sp.set('zip', zip)
    if (batch) sp.set('batch', batch)
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
            office adds by hand or imports from a list.
          </p>
        </div>
        <div className="ops-page-actions">
          <Link href={viewHref(otherView)} className="ops-btn">
            {otherView === 'kanban' ? <KanbanSquare aria-hidden="true" /> : <Table2 aria-hidden="true" />}
            {otherView === 'kanban' ? 'Kanban view' : 'Table view'}
          </Link>
          {/* Only shown to accounts that can actually use it, so nobody is
              offered a button that answers with a permission wall. */}
          {user.can('leadsImport') && (
            <Link href="/ops/leads/import" className="ops-btn">
              <Upload aria-hidden="true" /> Import leads
            </Link>
          )}
          <Link href="/ops/leads/new" className="ops-btn ops-btn-primary"><Plus aria-hidden="true" /> New lead</Link>
        </div>
      </div>

      {error && (
        <div className="ops-banner bad" role="alert">
          <div>The lead list could not be loaded. Reload the page, or contact an administrator if it persists.</div>
        </div>
      )}

      <div className="ops-card">
        <FilterBar action="/ops/leads" q={q} placeholder="Name, email, phone, address, ZIP, stop, batch…"
          count={count !== null ? `${count} lead${count === 1 ? '' : 's'}` : undefined}>
          <FilterSelect
            name="stage" value={stage} label="Stage"
            options={LEAD_STAGES.map(s => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
          />
          <FilterSelect
            name="type" value={recordType} label="Record type"
            options={LEAD_RECORD_TYPES.map(t => ({ value: t, label: LEAD_RECORD_TYPE_LABELS[t] }))}
          />
          {batchTags.length > 0 && (
            <FilterSelect
              name="batch" value={batch} label="Batch"
              options={batchTags.map(t => ({ value: t, label: t }))}
            />
          )}
          {cities.length > 0 && (
            <FilterSelect
              name="city" value={city} label="City"
              options={cities.map(c => ({ value: c, label: c }))}
            />
          )}
          <input
            type="search" name="zip" defaultValue={zip ?? ''} placeholder="ZIP"
            aria-label="ZIP code" style={{ maxWidth: 90 }}
          />
          {view === 'kanban' && <input type="hidden" name="view" value="kanban" />}
        </FilterBar>

        {leads.length === 0 ? (
          <EmptyState
            title={q || stage || recordType || city || zip || batch ? 'No leads match those filters' : 'No leads yet'}
            message={
              q || stage || recordType || city || zip || batch
                ? 'Try clearing the filters, or search by phone number or address instead.'
                : 'Website enquiries appear here within seconds of being submitted. You can also add one manually.'
            }
            actionLabel="Add a lead"
            actionHref="/ops/leads/new"
            secondaryLabel={user.can('leadsImport') ? 'Import a list' : undefined}
            secondaryHref={user.can('leadsImport') ? '/ops/leads/import' : undefined}
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
                        <strong>{displayName(l).primary}</strong>
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
                    <th>Name / property</th><th>Service</th><th>Record</th><th>City</th>
                    <th>Stage</th><th>Batch</th><th>Received</th><th />
                  </tr>
                </thead>
                <tbody>
                  {leads.map(lead => {
                    const shown = displayName(lead)
                    return (
                    <tr key={lead.id}>
                      <td data-label="Name" className="ops-cell-primary">
                        <Link className="ops-row-link" href={`/ops/leads/${lead.id}`}>
                          {shown.primary}
                        </Link>
                        <span className="ops-sub2">
                          {lead.stop_number && <>Stop {lead.stop_number} · </>}
                          {shown.secondary ?? '—'}
                        </span>
                      </td>
                      <td data-label="Service">{lead.service_type ?? '—'}</td>
                      <td data-label="Record">
                        {lead.record_type === 'property_prospect'
                          ? <span className="ops-mode-badge">Property prospect</span>
                          : <span style={{ textTransform: 'capitalize' }}>{lead.customer_type ?? 'Contact lead'}</span>}
                      </td>
                      <td data-label="City">{lead.city ?? '—'}</td>
                      <td data-label="Stage"><LeadStageBadge stage={lead.pipeline_stage} /></td>
                      <td data-label="Batch">
                        {lead.import_batch_tag
                          ? <Link href={`/ops/leads?batch=${encodeURIComponent(lead.import_batch_tag)}`}>{lead.import_batch_tag}</Link>
                          : <span style={{ textTransform: 'capitalize' }}>{lead.source}</span>}
                      </td>
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
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page} pageSize={PAGE_SIZE} total={count ?? 0}
              basePath="/ops/leads" params={{ q, stage, type: recordType, city, zip, batch }}
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

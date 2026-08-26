import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import {
  ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS, OPEN_ESTIMATE_STATUSES, type EstimateStatus,
} from '@/lib/ops/types'
import { SERVICE_TYPES } from '@/lib/ops/constants'
import { formatDate } from '@/lib/ops/utils/dates'
import { formatCents } from '@/lib/ops/utils/money'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'
import EstimatesTable from '@/components/ops/EstimatesTable'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; service?: string; assigned?: string; page?: string }
}) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const { q, status, service, assigned } = searchParams
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('estimates')
    .select(
      'id, estimate_number, title, status, service_type, property_address, city, total_cents,' +
      'valid_until, created_at, assigned_to, contact_id, project_id, converted_project_id,' +
      'contacts(first_name, last_name, company_name), profiles:assigned_to(full_name, email)',
      { count: 'exact' },
    )
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (status === 'open') query = query.in('status', OPEN_ESTIMATE_STATUSES)
  else if (status) query = query.eq('status', status)
  if (service) query = query.eq('service_type', service)
  if (assigned) query = query.eq('assigned_to', assigned)
  if (q) {
    const p = `%${q.replace(/[%_,()]/g, ' ')}%`
    query = query.or(`estimate_number.ilike.${p},title.ilike.${p},property_address.ilike.${p},city.ilike.${p}`)
  }

  const from = (page - 1) * PAGE_SIZE
  const [{ data, count }, { data: staff }] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
  ])

  const rows = ((data ?? []) as unknown as RawEstimateRow[]).map(row => {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    const owner = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      id: row.id,
      estimateNumber: row.estimate_number,
      title: row.title,
      status: row.status,
      serviceType: row.service_type,
      property: [row.property_address, row.city].filter(Boolean).join(', '),
      totalCents: row.total_cents,
      totalLabel: formatCents(row.total_cents),
      validUntil: row.valid_until ? formatDate(row.valid_until) : '—',
      createdAt: formatDate(row.created_at),
      customerName: contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name || '—'
        : '—',
      contactId: row.contact_id,
      assignedName: owner?.full_name ?? owner?.email ?? 'Unassigned',
      projectId: row.converted_project_id ?? row.project_id,
    }
  })

  const openValue = rows
    .filter(r => (OPEN_ESTIMATE_STATUSES as string[]).includes(r.status))
    .reduce((sum, r) => sum + r.totalCents, 0)

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Sales</div>
          <h1>Estimates</h1>
          <p className="ops-sub">
            Build an estimate line by line, or start from an AI draft and price it against the
            company pricebook. Select several to export their PDFs in one ZIP.
          </p>
        </div>
        <div className="ops-page-actions">
          {user.can('estimatesCreate') && (
            <Link href="/ops/estimates/new" className="ops-btn ops-btn-primary">
              <Plus aria-hidden="true" /> New estimate
            </Link>
          )}
        </div>
      </div>

      <div className="ops-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <div className="ops-kpi">
          <div className="ops-kpi-label">Estimates shown</div>
          <div className="ops-kpi-value">{count ?? 0}</div>
        </div>
        <div className="ops-kpi">
          <div className="ops-kpi-label">Open value on this page</div>
          <div className="ops-kpi-value" style={{ fontSize: '1.5rem' }}>{formatCents(openValue)}</div>
          <div className="ops-kpi-foot">Everything not won or lost</div>
        </div>
      </div>

      <div className="ops-card">
        <FilterBar action="/ops/estimates" q={q} placeholder="Estimate number, title, address…"
          count={count !== null ? `${count} estimate${count === 1 ? '' : 's'}` : undefined}>
          <FilterSelect name="status" value={status} label="Status"
            options={[
              { value: 'open', label: 'Open (not won or lost)' },
              ...ESTIMATE_STATUSES.map(s => ({ value: s, label: ESTIMATE_STATUS_LABELS[s] })),
            ]} />
          <FilterSelect name="service" value={service} label="Service"
            options={SERVICE_TYPES.map(s => ({ value: s, label: s }))} />
          <FilterSelect name="assigned" value={assigned} label="Assigned"
            options={(staff ?? []).map(s => ({
              value: s.id as string, label: (s.full_name as string) || (s.email as string),
            }))} />
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            title={q || status || service ? 'No estimates match' : 'No estimates yet'}
            message={
              q || status || service
                ? 'Clear the filters to see everything.'
                : 'Create one from a lead, a client, or from scratch. Attach a roof measurement first if this is a roofing job — the quantities come out right that way.'
            }
            actionLabel={user.can('estimatesCreate') ? 'Create an estimate' : undefined}
            actionHref={user.can('estimatesCreate') ? '/ops/estimates/new' : undefined}
          />
        ) : (
          <>
            <EstimatesTable rows={rows} canBatchExport={user.can('estimatesBatchExport')} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0}
              basePath="/ops/estimates" params={{ q, status, service, assigned }} />
          </>
        )}
      </div>
    </>
  )
}

interface RawEstimateRow {
  id: string
  estimate_number: string
  title: string
  status: EstimateStatus
  service_type: string | null
  property_address: string | null
  city: string | null
  total_cents: number
  valid_until: string | null
  created_at: string
  assigned_to: string | null
  contact_id: string | null
  project_id: string | null
  converted_project_id: string | null
  contacts: { first_name: string | null; last_name: string | null; company_name: string | null }
    | { first_name: string | null; last_name: string | null; company_name: string | null }[] | null
  profiles: { full_name: string | null; email: string | null }
    | { full_name: string | null; email: string | null }[] | null
}

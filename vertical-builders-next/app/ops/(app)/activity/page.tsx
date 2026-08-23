import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { ACTION_LABELS } from '@/lib/ops/services/activity'
import { formatDateTime } from '@/lib/ops/utils/dates'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: { entity?: string; action?: string; page?: string }
}) {
  await requireUser()
  const supabase = createSupabaseServerClient()
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('activity_log')
    .select('id, action, entity_type, entity_id, created_at, actor_label, metadata_json, profiles:actor_user_id(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (searchParams.entity) query = query.eq('entity_type', searchParams.entity)
  if (searchParams.action) query = query.eq('action', searchParams.action)

  const from = (page - 1) * PAGE_SIZE
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  const entries = data ?? []

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Workspace</div>
          <h1>Activity log</h1>
          <p className="ops-sub">
            Who changed what, and when. Compliance-critical events are recorded here permanently and
            exported with every audit package. Secrets and file contents are never logged.
          </p>
        </div>
      </div>

      <div className="ops-card">
        <FilterBar action="/ops/activity" count={count !== null ? `${count} entries` : undefined}>
          <FilterSelect name="entity" value={searchParams.entity} label="Record"
            options={[
              { value: 'lead', label: 'Leads' },
              { value: 'contact', label: 'Contacts' },
              { value: 'project', label: 'Projects' },
              { value: 'vendor', label: 'Subcontractors' },
              { value: 'insurance_certificate', label: 'Certificates' },
              { value: 'document', label: 'Documents' },
              { value: 'audit_cycle', label: 'Audit cycles' },
            ]} />
          <FilterSelect name="action" value={searchParams.action} label="Action"
            options={Object.keys(ACTION_LABELS).map(a => ({ value: a, label: ACTION_LABELS[a] }))} />
        </FilterBar>

        {entries.length === 0 ? (
          <EmptyState title="Nothing logged yet" message="Activity appears as soon as records are created or changed." />
        ) : (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead><tr><th>When</th><th>Action</th><th>Record</th><th>Who</th><th>Details</th></tr></thead>
                <tbody>
                  {entries.map(e => {
                    const who = (e as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles
                    const meta = e.metadata_json as Record<string, unknown>
                    return (
                      <tr key={e.id}>
                        <td data-label="When" className="nowrap ops-cell-primary">{formatDateTime(e.created_at)}</td>
                        <td data-label="Action">{ACTION_LABELS[e.action as string] ?? e.action}</td>
                        <td data-label="Record" style={{ textTransform: 'capitalize' }}>
                          {String(e.entity_type).replace(/_/g, ' ')}
                        </td>
                        <td data-label="Who">{who?.full_name ?? who?.email ?? e.actor_label ?? 'System'}</td>
                        <td data-label="Details" style={{ fontSize: '.76rem', color: 'var(--ops-muted)' }}>
                          {Object.keys(meta ?? {}).length === 0
                            ? '—'
                            : Object.entries(meta).slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/ops/activity"
              params={{ entity: searchParams.entity, action: searchParams.action }} />
          </>
        )}
      </div>
    </>
  )
}

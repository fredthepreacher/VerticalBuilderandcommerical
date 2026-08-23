import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { formatDate } from '@/lib/ops/utils/dates'
import { Badge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect } from '@/components/ops/FilterBar'
import TaskForm, { TaskToggle } from '@/components/ops/TaskForm'

export const dynamic = 'force-dynamic'

const PRIORITY_TONE: Record<string, 'bad' | 'warn' | 'neutral' | 'info'> = {
  urgent: 'bad', high: 'warn', normal: 'info', low: 'neutral',
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { status?: string; assignee?: string; q?: string }
}) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()

  let query = supabase
    .from('tasks')
    .select('id, title, description, due_date, priority, status, related_entity_type, related_entity_id, profiles:assigned_to(id, full_name, email)')
    .order('status')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(200)

  if (searchParams.status) query = query.eq('status', searchParams.status)
  else query = query.in('status', ['open', 'in_progress'])
  if (searchParams.assignee === 'me') query = query.eq('assigned_to', user.id)
  if (searchParams.q) query = query.ilike('title', `%${searchParams.q.replace(/[%_,()]/g, ' ')}%`)

  const [{ data: tasks }, { data: staff }] = await Promise.all([
    query,
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
  ])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Workspace</div>
          <h1>Tasks</h1>
          <p className="ops-sub">
            Call the new roof lead, chase a renewed GL certificate, verify a workers comp exemption —
            the follow-ups that otherwise live on sticky notes.
          </p>
        </div>
      </div>

      <div className="ops-columns">
        <div className="ops-card">
          <FilterBar action="/ops/tasks" q={searchParams.q} placeholder="Task title…"
            count={`${(tasks ?? []).length} shown`}>
            <FilterSelect name="status" value={searchParams.status} label="Status"
              options={[
                { value: 'open', label: 'Open' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'done', label: 'Done' },
                { value: 'cancelled', label: 'Cancelled' },
              ]} />
            <FilterSelect name="assignee" value={searchParams.assignee} label="Assignee"
              options={[{ value: 'me', label: 'Assigned to me' }]} />
          </FilterBar>

          {(tasks ?? []).length === 0 ? (
            <EmptyState
              title="No tasks"
              message="Create one on the right, or add tasks from a lead, project or subcontractor record."
            />
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr><th style={{ width: 40 }} /><th>Task</th><th>Assigned</th><th>Due</th><th>Priority</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {(tasks ?? []).map(t => {
                    const who = (t as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles
                    const overdue = t.due_date && String(t.due_date).slice(0, 10) < today && t.status !== 'done'
                    return (
                      <tr key={t.id}>
                        <td data-label="Done">
                          <TaskToggle taskId={t.id as string} done={t.status === 'done'} />
                        </td>
                        <td data-label="Task" className="ops-cell-primary">
                          <strong style={{ fontWeight: 600, color: 'var(--ops-ink)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                            {t.title}
                          </strong>
                          {t.description && <span className="ops-sub2">{t.description}</span>}
                        </td>
                        <td data-label="Assigned">{who?.full_name ?? who?.email ?? 'Unassigned'}</td>
                        <td data-label="Due" className="nowrap">
                          {t.due_date
                            ? <Badge tone={overdue ? 'bad' : 'neutral'}>{formatDate(t.due_date)}</Badge>
                            : '—'}
                        </td>
                        <td data-label="Priority">
                          <Badge tone={PRIORITY_TONE[t.priority as string] ?? 'neutral'}>{cap(t.priority as string)}</Badge>
                        </td>
                        <td data-label="Status">{cap(String(t.status).replace(/_/g, ' '))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <TaskForm staff={(staff ?? []).map(s => ({ id: s.id as string, label: (s.full_name as string) || (s.email as string) }))} />
      </div>
    </>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

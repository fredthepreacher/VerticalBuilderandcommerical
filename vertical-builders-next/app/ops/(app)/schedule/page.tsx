import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import {
  barGeometry, buildTimeline, loadSchedule, SCHEDULE_STATUS_TONE, type TimelineScale,
} from '@/lib/ops/services/schedule'
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from '@/lib/ops/types'
import { SERVICE_CATEGORIES } from '@/lib/ops/constants'
import { formatDate } from '@/lib/ops/utils/dates'
import { EmptyState } from '@/components/ops/EmptyState'
import ScheduleEditor from '@/components/ops/ScheduleEditor'

export const dynamic = 'force-dynamic'

const SCALES: TimelineScale[] = ['day', 'week', 'month']

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: {
    scale?: string; pm?: string; service?: string; status?: string; completed?: string
  }
}) {
  const user = await requireUser()
  if (!user.can('scheduleView')) {
    return <EmptyState title="No access" message="Your role cannot view the schedule." />
  }

  const supabase = createSupabaseServerClient()
  const scale = (SCALES.includes(searchParams.scale as TimelineScale)
    ? searchParams.scale
    : 'week') as TimelineScale

  const [bars, { data: managers }] = await Promise.all([
    loadSchedule(supabase, {
      projectManagerId: searchParams.pm ?? null,
      serviceCategory: searchParams.service ?? null,
      status: (searchParams.status as ProjectStatus) ?? null,
      includeCompleted: searchParams.completed === '1',
    }),
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
  ])

  const timeline = buildTimeline(bars, scale)
  const overdue = bars.filter(b => b.isOverdue).length
  const estimated = bars.filter(b => b.isEstimated).length

  const href = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    const merged = {
      scale, pm: searchParams.pm, service: searchParams.service,
      status: searchParams.status, completed: searchParams.completed, ...patch,
    }
    for (const [k, v] of Object.entries(merged)) if (v && v !== 'week') sp.set(k, v)
    const s = sp.toString()
    return `/ops/schedule${s ? `?${s}` : ''}`
  }

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Operations</div>
          <h1>Schedule</h1>
          <p className="ops-sub">
            Every live job on one timeline. Bars run from the scheduled start to the scheduled end;
            a striped bar means one of those dates has not been set and is being estimated.
          </p>
        </div>
        <div className="ops-page-actions">
          {SCALES.map(s => (
            <Link key={s} href={href({ scale: s })}
              className={`ops-btn ops-btn-sm${scale === s ? ' ops-btn-dark' : ''}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      {overdue > 0 && (
        <div className="ops-banner warn" role="status">
          <div>
            <strong>{overdue} job{overdue === 1 ? ' is' : 's are'} past their end date</strong>
            Outlined in red below. Either the work slipped or the date needs updating — both are
            worth a phone call.
          </div>
        </div>
      )}

      <div className="ops-card" style={{ marginBottom: 16 }}>
        <form className="ops-toolbar" method="get" action="/ops/schedule">
          <input type="hidden" name="scale" value={scale} />
          <select name="pm" defaultValue={searchParams.pm ?? ''} aria-label="Project manager">
            <option value="">Project manager: all</option>
            {(managers ?? []).map(m => (
              <option key={m.id as string} value={m.id as string}>
                {(m.full_name as string) || (m.email as string)}
              </option>
            ))}
          </select>
          <select name="service" defaultValue={searchParams.service ?? ''} aria-label="Service category">
            <option value="">Service: all</option>
            {SERVICE_CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="status" defaultValue={searchParams.status ?? ''} aria-label="Status">
            <option value="">Status: all active</option>
            {PROJECT_STATUSES.map(s => (
              <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <label className="ops-check" style={{ fontSize: '.8rem' }}>
            <input type="checkbox" name="completed" value="1" defaultChecked={searchParams.completed === '1'} />
            <span>Include finished</span>
          </label>
          <button type="submit" className="ops-btn ops-btn-sm">Apply</button>
          <a href="/ops/schedule" className="ops-btn ops-btn-ghost ops-btn-sm">Clear</a>
          <span className="ops-toolbar-count">
            {bars.length} job{bars.length === 1 ? '' : 's'}
            {estimated > 0 && ` · ${estimated} with estimated dates`}
          </span>
        </form>
      </div>

      {bars.length === 0 ? (
        <div className="ops-card">
          <EmptyState
            title="Nothing on the schedule"
            message="Jobs appear here as soon as they exist. Set a scheduled start and end on a job to place it precisely; until then it is drawn from the project dates."
            actionLabel="View jobs"
            actionHref="/ops/projects"
          />
        </div>
      ) : (
        <div className="ops-gantt">
          <div className="ops-gantt-scroll">
            <div className="ops-gantt-inner">
              <div className="ops-gantt-head">
                <div className="label-col">Job</div>
                <div className="ops-gantt-axis">
                  {timeline.ticks.map(tick => (
                    <span
                      key={tick.date}
                      className={`ops-gantt-tick${tick.isMajor ? ' is-major' : ''}`}
                      style={{ left: `${tick.offsetPercent}%` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>

              {bars.map(bar => {
                const geometry = barGeometry(bar, timeline)
                const color = SCHEDULE_STATUS_TONE[bar.status] ?? '#5c6773'
                return (
                  <div className="ops-gantt-row" key={bar.projectId}>
                    <div className="ops-gantt-label">
                      <Link href={`/ops/projects/${bar.projectId}`}>
                        {bar.projectNumber} · {bar.projectName}
                      </Link>
                      <span>
                        {bar.customerName ?? 'No client'}
                        {bar.projectManagerName ? ` · ${bar.projectManagerName}` : ''}
                      </span>
                    </div>
                    <div className="ops-gantt-track">
                      <div className="ops-gantt-grid" aria-hidden="true">
                        {timeline.ticks.map(tick => (
                          <i key={tick.date} style={{ left: `${tick.offsetPercent}%` }} />
                        ))}
                      </div>
                      {timeline.todayOffsetPercent !== null && (
                        <div className="ops-gantt-today" style={{ left: `${timeline.todayOffsetPercent}%` }} aria-hidden="true" />
                      )}
                      <Link
                        href={`/ops/projects/${bar.projectId}`}
                        className={`ops-gantt-bar${bar.isEstimated ? ' is-estimated' : ''}${bar.isOverdue ? ' is-overdue' : ''}`}
                        style={{
                          left: `${geometry.leftPercent}%`,
                          width: `${geometry.widthPercent}%`,
                          background: color,
                        }}
                        title={
                          `${bar.projectNumber} ${bar.projectName}\n` +
                          `${PROJECT_STATUS_LABELS[bar.status]}\n` +
                          `${formatDate(bar.start)} → ${formatDate(bar.end)} (${bar.durationDays} days)` +
                          (bar.isEstimated ? '\nDates are estimated — set them on the job to fix the bar.' : '') +
                          (bar.isOverdue ? '\nPast its end date and not marked complete.' : '')
                        }
                      >
                        {geometry.widthPercent > 8 && (
                          <span>{PROJECT_STATUS_LABELS[bar.status]}</span>
                        )}
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="ops-gantt-legend">
            {(['preconstruction', 'permitting', 'scheduled', 'in_progress', 'on_hold'] as ProjectStatus[]).map(s => (
              <span key={s}>
                <i style={{ background: SCHEDULE_STATUS_TONE[s] }} />
                {PROJECT_STATUS_LABELS[s]}
              </span>
            ))}
            <span><i style={{ background: '#6a7683', backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 3px, transparent 3px 6px)' }} /> Estimated dates</span>
            <span><i style={{ background: '#fff', boxShadow: '0 0 0 2px var(--ops-bad)' }} /> Overdue</span>
          </div>
        </div>
      )}

      {user.can('scheduleEdit') && bars.length > 0 && (
        <div style={{ marginTop: 16, maxWidth: 640 }}>
          <ScheduleEditor
            jobs={bars.map(b => ({
              id: b.projectId,
              label: `${b.projectNumber} · ${b.projectName}`,
              start: b.start,
              end: b.end,
              locked: b.scheduleLocked,
              isEstimated: b.isEstimated,
            }))}
          />
        </div>
      )}
    </>
  )
}

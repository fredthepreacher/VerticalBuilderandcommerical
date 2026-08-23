'use client'

import { useState } from 'react'
import { CalendarRange, Lock, LockOpen } from 'lucide-react'
import { useTransition } from 'react'
import { ActionForm, SubmitButton } from './Form'
import { toggleScheduleLock, updateScheduleAction } from '@/app/ops/actions/operations'

export interface ScheduleJob {
  id: string
  label: string
  start: string
  end: string
  locked: boolean
  isEstimated: boolean
}

/**
 * Schedule editing by form rather than by dragging.
 *
 * Dragging a bar is pleasant on a desktop and unusable on the phone the field
 * team actually carries, and an accidental drag silently moves a crew. Explicit
 * dates, validated server-side and written to the activity log, are what this
 * team needs. The Gantt stays read-only and fast.
 */
export default function ScheduleEditor({ jobs }: { jobs: ScheduleJob[] }) {
  const [selectedId, setSelectedId] = useState(jobs[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const selected = jobs.find(j => j.id === selectedId)

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <CalendarRange aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-muted)' }} />
        <h2>Set job dates</h2>
      </div>
      <div className="ops-card-body">
        <div className="ops-field">
          <label htmlFor="sched-job">Job</label>
          <select id="sched-job" className="ops-select" value={selectedId}
            onChange={e => setSelectedId(e.target.value)}>
            {jobs.map(job => (
              <option key={job.id} value={job.id}>
                {job.label}{job.locked ? ' (locked)' : ''}{job.isEstimated ? ' — dates estimated' : ''}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <>
            {selected.locked && (
              <div className="ops-banner neutral" style={{ fontSize: '.82rem' }}>
                <div>
                  This job&rsquo;s schedule is locked. Unlock it to change the dates.
                </div>
                <div className="ops-banner-actions">
                  <button
                    type="button" className="ops-btn ops-btn-sm" disabled={pending}
                    onClick={() => startTransition(async () => { await toggleScheduleLock(selected.id, false) })}
                  >
                    <LockOpen aria-hidden="true" /> Unlock
                  </button>
                </div>
              </div>
            )}

            <ActionForm action={updateScheduleAction}>
              {state => (
                <>
                  <input type="hidden" name="project_id" value={selected.id} />
                  <div className="ops-grid-2">
                    <div className="ops-field">
                      <label htmlFor="sched-start">Scheduled start</label>
                      <input id="sched-start" name="scheduled_start_date" type="date" className="ops-input"
                        defaultValue={selected.isEstimated ? '' : selected.start}
                        disabled={selected.locked} />
                    </div>
                    <div className="ops-field">
                      <label htmlFor="sched-end">Scheduled end</label>
                      <input id="sched-end" name="scheduled_end_date" type="date" className="ops-input"
                        defaultValue={selected.isEstimated ? '' : selected.end}
                        disabled={selected.locked} />
                      {state.fieldErrors?.scheduled_end_date && (
                        <p className="ops-error">{state.fieldErrors.scheduled_end_date[0]}</p>
                      )}
                    </div>
                  </div>
                  <div className="ops-field">
                    <label htmlFor="sched-notes">Schedule note</label>
                    <input id="sched-notes" name="schedule_notes" className="ops-input"
                      placeholder="Waiting on the permit; crew available from the 14th"
                      disabled={selected.locked} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <SubmitButton className="ops-btn ops-btn-primary">Save dates</SubmitButton>
                    {!selected.locked && (
                      <button
                        type="button" className="ops-btn" disabled={pending}
                        title="Stops the dates being changed by accident once the crew is committed"
                        onClick={() => startTransition(async () => { await toggleScheduleLock(selected.id, true) })}
                      >
                        <Lock aria-hidden="true" /> Lock schedule
                      </button>
                    )}
                  </div>
                </>
              )}
            </ActionForm>
          </>
        )}
      </div>
    </section>
  )
}

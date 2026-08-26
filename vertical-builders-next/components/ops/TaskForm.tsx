'use client'

import { useTransition } from 'react'
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveTask, toggleTask } from '@/app/ops/actions/crm'

export default function TaskForm({ staff }: { staff: { id: string; label: string }[] }) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>New task</h2></div>
      <div className="ops-card-body">
        <ActionForm action={saveTask}>
          {state => (
            <>
              <Field label="Title" name="title" required errors={state.fieldErrors}
                placeholder="Request renewed GL certificate from ABC Roofing" />
              <TextareaField label="Details" name="description" rows={2} />
              <div className="ops-grid-2">
                <SelectField label="Assign to" name="assigned_to" placeholder="Unassigned"
                  options={staff.map(s => ({ value: s.id, label: s.label }))} />
                <Field label="Due" name="due_date" type="date" errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-2">
                <SelectField label="Priority" name="priority" defaultValue="normal"
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'high', label: 'High' },
                    { value: 'urgent', label: 'Urgent' },
                  ]} />
                <SelectField label="Status" name="status" defaultValue="open"
                  options={[
                    { value: 'open', label: 'Open' },
                    { value: 'in_progress', label: 'In progress' },
                    { value: 'done', label: 'Done' },
                  ]} />
              </div>
              <SubmitButton>Add task</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}

export function TaskToggle({ taskId, done }: { taskId: string; done: boolean }) {
  const [pending, startTransition] = useTransition()
  return (
    <input
      type="checkbox"
      checked={done}
      disabled={pending}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      style={{ width: 17, height: 17, accentColor: 'var(--ops-accent)', cursor: 'pointer' }}
      onChange={e => {
        const next = e.currentTarget.checked
        startTransition(async () => { await toggleTask(taskId, next) })
      }}
    />
  )
}

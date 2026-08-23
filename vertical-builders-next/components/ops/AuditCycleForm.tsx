'use client'

import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveAuditCycle } from '@/app/ops/actions/audits'
import { AUDIT_STATUSES } from '@/lib/ops/types'
import type { ActionState } from '@/lib/ops/actions-shared'

export interface AuditCycleValues {
  id?: string
  name?: string
  audit_period_start?: string
  audit_period_end?: string
  due_date?: string | null
  status?: string
  notes?: string | null
}

export default function AuditCycleForm({
  cycle,
  defaultStart,
  defaultEnd,
}: {
  cycle?: AuditCycleValues
  defaultStart?: string
  defaultEnd?: string
}) {
  const action = saveAuditCycle.bind(null, cycle?.id ?? null)
  const year = new Date().getFullYear()
  const half = new Date().getMonth() < 6 ? 'H1' : 'H2'

  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>{cycle ? 'Audit cycle' : 'New audit cycle'}</h2></div>
      <div className="ops-card-body">
        <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
          {state => (
            <>
              <Field
                label="Name" name="name" required
                defaultValue={cycle?.name ?? `${year} ${half} Insurance Audit`}
                errors={state.fieldErrors}
              />
              <div className="ops-grid-2">
                <Field label="Period start" name="audit_period_start" type="date" required
                  defaultValue={cycle?.audit_period_start ?? defaultStart} errors={state.fieldErrors} />
                <Field label="Period end" name="audit_period_end" type="date" required
                  defaultValue={cycle?.audit_period_end ?? defaultEnd} errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-2">
                <Field label="Due date" name="due_date" type="date"
                  defaultValue={cycle?.due_date ?? undefined} errors={state.fieldErrors} />
                <SelectField label="Status" name="status" defaultValue={cycle?.status ?? 'draft'}
                  options={AUDIT_STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />
              </div>
              <TextareaField label="Notes" name="notes" defaultValue={cycle?.notes} rows={2}
                hint="Who is auditing, what they asked for, anything the next person should know." />
              <SubmitButton>{cycle ? 'Save cycle' : 'Create audit cycle'}</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}

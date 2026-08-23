'use client'

import { useTransition } from 'react'
import { ActionForm, SubmitButton } from './Form'
import { assignVendor, unassignVendor } from '@/app/ops/actions/compliance'

export function AssignVendorForm({
  projectId,
  vendors,
}: {
  projectId: string
  vendors: { id: string; label: string; status: string }[]
}) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>Assign a subcontractor</h2></div>
      <div className="ops-card-body">
        <ActionForm action={assignVendor}>
          {state => (
            <>
              <input type="hidden" name="project_id" value={projectId} />
              <div className="ops-field">
                <label htmlFor="assign-vendor">Subcontractor</label>
                <select id="assign-vendor" name="vendor_id" className="ops-select" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.label}{v.status !== 'compliant' ? ` — ${v.status.replace(/_/g, ' ')}` : ''}
                    </option>
                  ))}
                </select>
                <p className="ops-hint">
                  You can assign anyone. The Compliance tab will flag it if their paperwork is not clear.
                </p>
              </div>
              <div className="ops-field">
                <label htmlFor="scope_of_work">Scope of work</label>
                <input id="scope_of_work" name="scope_of_work" className="ops-input" placeholder="Tear-off, dry-in, shingle install" />
              </div>
              <div className="ops-grid-2">
                <div className="ops-field">
                  <label htmlFor="assign-start">On site from</label>
                  <input id="assign-start" name="start_date" type="date" className="ops-input" />
                </div>
                <div className="ops-field">
                  <label htmlFor="assign-end">Until</label>
                  <input id="assign-end" name="end_date" type="date" className="ops-input" />
                  <p className="ops-hint">Used by audits to decide who was on the job during a period.</p>
                </div>
              </div>
              {state.fieldErrors?.vendor_id && <p className="ops-error">{state.fieldErrors.vendor_id[0]}</p>}
              <SubmitButton pendingLabel="Assigning…">Assign</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}

export function UnassignButton({ projectId, vendorId }: { projectId: string; vendorId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button" className="ops-btn ops-btn-sm" disabled={pending}
      title="Ends the assignment. The record is kept for audits."
      onClick={() => startTransition(async () => { await unassignVendor(projectId, vendorId) })}
    >
      {pending ? 'Removing…' : 'End assignment'}
    </button>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { Hammer } from 'lucide-react'
import { createJobFromContact } from '@/app/ops/actions/crm'
import { SERVICE_CATEGORIES } from '@/lib/ops/constants'

/**
 * "Create job" from a customer record.
 *
 * One click plus a confirm. The confirm exists because this writes a real job
 * to the board; the two fields on it are optional, and leaving them alone still
 * produces a usable job in the Estimate stage.
 */
export default function CreateJobButton({
  contactId,
  contactName,
}: {
  contactId: string
  contactName: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')

  function run() {
    setError(null)
    startTransition(async () => {
      const result = await createJobFromContact(contactId, {
        projectName: name,
        serviceCategory: category || null,
      })
      if (result?.ok === false) setError(result.error ?? 'The job could not be created.')
    })
  }

  return (
    <>
      <button type="button" className="ops-btn ops-btn-primary" onClick={() => setOpen(true)}>
        <Hammer aria-hidden="true" /> Create job
      </button>

      {open && (
        <div
          className="ops-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-job-title"
          onClick={e => { if (e.target === e.currentTarget && !pending) setOpen(false) }}
        >
          <div className="ops-dialog" style={{ width: 'min(480px, 100%)' }}>
            <div className="ops-dialog-head">
              <h2 id="create-job-title">New job for {contactName}</h2>
            </div>
            <div className="ops-dialog-body">
              <div className="ops-field">
                <label htmlFor="cj-category">Service</label>
                <select id="cj-category" className="ops-select" value={category}
                  onChange={e => setCategory(e.target.value)}>
                  <option value="">Not decided yet</option>
                  {SERVICE_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="ops-field">
                <label htmlFor="cj-name">Job name</label>
                <input id="cj-name" className="ops-input" value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={`${contactName} — ${category || 'Project'}`} />
                <p className="ops-hint">Leave blank to use the placeholder.</p>
              </div>
              <p className="ops-hint">
                The job starts in Estimate, reuses this customer record, and copies their address
                as the jobsite — all editable afterwards.
              </p>
              {error && <p className="ops-error" role="alert">{error}</p>}
            </div>
            <div className="ops-dialog-foot">
              <button type="button" className="ops-btn" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="ops-btn ops-btn-primary" onClick={run} disabled={pending}>
                {pending ? 'Creating…' : 'Create job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { UserPlus } from 'lucide-react'
import { convertLeadAction } from '@/app/ops/actions/crm'

/**
 * "Convert to Customer + Project" — one click, but confirmed first, because it
 * creates two records and moves the lead to Won.
 */
export default function ConvertLeadButton({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run() {
    setError(null)
    startTransition(async () => {
      const result = await convertLeadAction(leadId)
      if (result?.ok === false) setError(result.error ?? 'The lead could not be converted.')
    })
  }

  return (
    <>
      <button type="button" className="ops-btn ops-btn-primary" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" /> Convert to Customer + Project
      </button>

      {open && (
        <div
          className="ops-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="convert-title"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="ops-dialog" style={{ width: 'min(460px, 100%)' }}>
            <div className="ops-dialog-head"><h2 id="convert-title">Convert this lead?</h2></div>
            <div className="ops-dialog-body" style={{ fontSize: '.88rem' }}>
              <p>This will:</p>
              <ul style={{ margin: '10px 0 0', display: 'grid', gap: 6 }}>
                <li>• Create a customer record — or reuse an existing one if the email or phone already matches</li>
                <li>• Create a project in the Estimate stage, prefilled from this lead</li>
                <li>• Mark the lead Won and link it to both records</li>
              </ul>
              <p style={{ marginTop: 12, color: 'var(--ops-muted)' }}>
                The lead itself is kept, not replaced. Nothing is deleted.
              </p>
              {error && <p className="ops-error" role="alert">{error}</p>}
            </div>
            <div className="ops-dialog-foot">
              <button type="button" className="ops-btn" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className="ops-btn ops-btn-primary" onClick={run} disabled={pending}>
                {pending ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

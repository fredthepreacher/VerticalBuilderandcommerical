'use client'

import { useState, useTransition } from 'react'
import type { ActionState } from '@/lib/ops/actions-shared'

/**
 * Any destructive or irreversible action goes through here: a plain click is
 * never enough. The dialog states exactly what will happen before it runs.
 */
export default function ConfirmButton({
  label,
  confirmTitle,
  confirmBody,
  confirmLabel = 'Confirm',
  action,
  className = 'ops-btn ops-btn-sm',
  icon,
}: {
  label: string
  confirmTitle: string
  confirmBody: string
  confirmLabel?: string
  action: () => Promise<ActionState>
  className?: string
  icon?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run() {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result?.ok === false) setError(result.error ?? 'That did not work.')
      else setOpen(false)
    })
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {icon}{label}
      </button>

      {open && (
        <div
          className="ops-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="ops-dialog" style={{ width: 'min(440px, 100%)' }}>
            <div className="ops-dialog-head"><h2 id="confirm-title">{confirmTitle}</h2></div>
            <div className="ops-dialog-body">
              <p style={{ fontSize: '.88rem' }}>{confirmBody}</p>
              {error && <p className="ops-error" role="alert">{error}</p>}
            </div>
            <div className="ops-dialog-foot">
              <button type="button" className="ops-btn" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="ops-btn ops-btn-danger" onClick={run} disabled={pending}>
                {pending ? 'Working…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

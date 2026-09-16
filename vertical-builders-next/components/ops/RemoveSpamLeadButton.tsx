'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, ShieldOff } from 'lucide-react'
import { removeLeadAsSpam, restoreLead } from '@/app/ops/actions/crm'

/**
 * Remove as spam / Restore.
 *
 * Named and explained rather than reduced to a red bin icon. The office should
 * know before they click that this is an archive and not a delete — the record
 * survives, its history survives, and anything built from it survives.
 *
 * A converted lead is refused by the server; the button is hidden here too, so
 * nobody clicks their way to a refusal they could have been spared.
 */
export default function RemoveSpamLeadButton({
  leadId,
  archived,
  converted,
}: {
  leadId: string
  archived: boolean
  converted: boolean
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (converted) return null

  if (archived) {
    return (
      <>
        <button
          type="button" className="ops-btn" disabled={pending}
          onClick={() => start(async () => {
            const result = await restoreLead(leadId)
            if (result.ok === false) { setError(result.error ?? 'Could not restore.'); return }
            router.refresh()
          })}
        >
          <RotateCcw aria-hidden="true" /> Restore lead
        </button>
        {error && <p className="ops-error">{error}</p>}
      </>
    )
  }

  if (!confirming) {
    return (
      <button type="button" className="ops-btn" onClick={() => setConfirming(true)}>
        <ShieldOff aria-hidden="true" /> Remove as spam
      </button>
    )
  }

  return (
    <div className="ops-confirm" role="alertdialog" aria-label="Remove this lead as spam">
      <strong>Remove this lead as spam?</strong>
      <p>
        The lead will disappear from the active pipeline. Its audit history will be retained, and
        anything already attached to it — notes, documents, estimates — is kept. You can restore it
        from the Archived filter on the leads list.
      </p>
      {error && <p className="ops-error">{error}</p>}
      <div className="ops-confirm-actions">
        <button type="button" className="ops-btn" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </button>
        <button
          type="button" className="ops-btn ops-btn-danger" disabled={pending}
          onClick={() => start(async () => {
            const result = await removeLeadAsSpam(leadId)
            if (result.ok === false) { setError(result.error ?? 'Could not remove this lead.'); return }
            router.push('/ops/leads')
            router.refresh()
          })}
        >
          {pending ? 'Removing…' : 'Remove as spam'}
        </button>
      </div>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { ArrowRight, Check, Send, X } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { convertEstimateAction, setEstimateStatusAction } from '@/app/ops/actions/estimates'
import type { EstimateStatus } from '@/lib/ops/types'

/**
 * Status controls.
 *
 * The button that is NOT here matters most: there is no way to jump an AI draft
 * straight to Sent. "Mark ready for review" is the only path forward from a
 * draft, and it refuses while any line is still flagged.
 */
export default function EstimateStatusActions({
  estimateId,
  status,
  unreviewedLines,
  canSend,
  canConvert,
  convertedProjectId,
  projectManagers,
}: {
  estimateId: string
  status: EstimateStatus
  unreviewedLines: number
  canSend: boolean
  canConvert: boolean
  convertedProjectId: string | null
  projectManagers: { id: string; label: string }[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showConvert, setShowConvert] = useState(false)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  function move(to: EstimateStatus, reason?: string) {
    setError(null)
    startTransition(async () => {
      const result = await setEstimateStatusAction(estimateId, to, reason)
      if (result?.ok === false) setError(result.error ?? 'That did not work.')
      else { setShowDecline(false); setDeclineReason('') }
    })
  }

  if (convertedProjectId) return null

  const blocked = unreviewedLines > 0

  return (
    <>
      {(status === 'draft' || status === 'ai_draft' || status === 'measuring') && (
        <button
          type="button" className="ops-btn" disabled={pending || blocked}
          title={blocked
            ? `${unreviewedLines} line${unreviewedLines === 1 ? '' : 's'} still flagged for review`
            : 'Mark this estimate ready to send'}
          onClick={() => move('ready_for_review')}
        >
          <Check aria-hidden="true" /> Mark ready for review
        </button>
      )}

      {status === 'ready_for_review' && canSend && (
        <button type="button" className="ops-btn ops-btn-primary" disabled={pending}
          onClick={() => move('sent')}>
          <Send aria-hidden="true" /> Mark as sent
        </button>
      )}

      {(status === 'sent' || status === 'viewed' || status === 'ready_for_review') && (
        <>
          <button type="button" className="ops-btn ops-btn-dark" disabled={pending}
            onClick={() => move('approved')}>
            <Check aria-hidden="true" /> Approved
          </button>
          <button type="button" className="ops-btn ops-btn-danger" disabled={pending}
            onClick={() => setShowDecline(s => !s)}>
            <X aria-hidden="true" /> Declined
          </button>
        </>
      )}

      {status === 'approved' && canConvert && (
        <button type="button" className="ops-btn ops-btn-primary" onClick={() => setShowConvert(true)}>
          <ArrowRight aria-hidden="true" /> Convert to job
        </button>
      )}

      {error && <span className="ops-error" role="alert" style={{ width: '100%' }}>{error}</span>}

      {blocked && (status === 'draft' || status === 'ai_draft') && (
        <span className="ops-hint" style={{ width: '100%' }}>
          {unreviewedLines} line{unreviewedLines === 1 ? '' : 's'} need reviewing before this can move on.
        </span>
      )}

      {showDecline && (
        <div style={{ width: '100%', display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            className="ops-input" style={{ flex: 1, minWidth: 220 }}
            placeholder="Why did they decline? (went with another contractor, price, timing…)"
            value={declineReason} onChange={e => setDeclineReason(e.target.value)}
            aria-label="Decline reason"
          />
          <button type="button" className="ops-btn ops-btn-danger" disabled={pending}
            onClick={() => move('declined', declineReason || undefined)}>
            Confirm declined
          </button>
        </div>
      )}

      {showConvert && (
        <div className="ops-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="convert-est"
          onClick={e => { if (e.target === e.currentTarget) setShowConvert(false) }}>
          <div className="ops-dialog">
            <div className="ops-dialog-head"><h2 id="convert-est">Convert this estimate to a job?</h2></div>
            <div className="ops-dialog-body">
              <p style={{ fontSize: '.88rem', marginBottom: 14 }}>
                A job is created in Pre-Construction, linked to the same client. The estimate stays
                exactly as it is — it becomes the record of what was quoted.
              </p>

              <ActionForm action={convertEstimateAction}>
                {state => (
                  <>
                    <input type="hidden" name="estimate_id" value={estimateId} />

                    <div className="ops-field">
                      <label htmlFor="convert-pm">Project manager</label>
                      <select id="convert-pm" name="project_manager_id" className="ops-select" defaultValue="">
                        <option value="">Assign later</option>
                        {projectManagers.map(pm => (
                          <option key={pm.id} value={pm.id}>{pm.label}</option>
                        ))}
                      </select>
                    </div>

                    <label className="ops-check" style={{ marginBottom: 14 }}>
                      <input type="checkbox" name="copy_total" defaultChecked />
                      <span>
                        Use the estimate total as the contract amount
                        <span className="ops-hint" style={{ display: 'block' }}>
                          This is the figure job profitability is measured against. Leave it off if
                          the signed contract will differ.
                        </span>
                      </span>
                    </label>

                    {state.error && <p className="ops-error">{state.error}</p>}
                    <SubmitButton pendingLabel="Creating the job…">Create job</SubmitButton>
                  </>
                )}
              </ActionForm>
            </div>
            <div className="ops-dialog-foot">
              <button type="button" className="ops-btn" onClick={() => setShowConvert(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

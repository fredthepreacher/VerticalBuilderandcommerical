'use client'

import { useState, useTransition } from 'react'
import { Copy, Mail, RefreshCw, ShieldAlert } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import {
  addWaiver, recalculateCompliance, requestRenewalAction, reviewCertificateAction, revokeWaiver,
} from '@/app/ops/actions/compliance'
import { COVERAGE_TYPES, COVERAGE_LABELS } from '@/lib/ops/types'

/** "Request Updated COI" — always surfaces a copyable link, email or not. */
export function RequestRenewalButton({ vendorId, vendorEmail }: { vendorId: string; vendorEmail: string | null }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="ops-btn ops-btn-primary" onClick={() => setOpen(true)}>
        <Mail aria-hidden="true" /> Request updated COI
      </button>

      {open && (
        <div className="ops-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="renew-title"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="ops-dialog">
            <div className="ops-dialog-head"><h2 id="renew-title">Request an updated certificate</h2></div>
            <div className="ops-dialog-body">
              <ActionForm action={requestRenewalAction}>
                {state => (
                  <>
                    <input type="hidden" name="vendor_id" value={vendorId} />
                    <p className="ops-hint" style={{ marginBottom: 14 }}>
                      {vendorEmail
                        ? <>A secure upload link will be emailed to <strong>{vendorEmail}</strong>. No login is needed — they can forward it to their agent.</>
                        : <>This vendor has no email on file, so nothing will be sent. Generate the link and send it yourself.</>}
                    </p>

                    <div className="ops-field">
                      <label htmlFor="requested_document_type">What are you asking for?</label>
                      <select id="requested_document_type" name="requested_document_type" className="ops-select" defaultValue="coi">
                        <option value="coi">Certificate of insurance</option>
                        <option value="insurance_endorsement">Endorsement page</option>
                        <option value="workers_comp_exemption">Workers comp exemption</option>
                        <option value="w9">W-9</option>
                        <option value="contractor_license">Contractor license</option>
                      </select>
                    </div>

                    <div className="ops-field">
                      <label htmlFor="renew-message">Message (optional)</label>
                      <textarea id="renew-message" name="message" rows={3} className="ops-textarea"
                        placeholder="Your GL expires next month — please have your agent send the renewal." />
                    </div>

                    {state.data?.uploadUrl ? (
                      <UploadLink url={String(state.data.uploadUrl)} />
                    ) : (
                      <SubmitButton pendingLabel="Creating link…">Create link &amp; send</SubmitButton>
                    )}
                  </>
                )}
              </ActionForm>
            </div>
            <div className="ops-dialog-foot">
              <button type="button" className="ops-btn" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function UploadLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="ops-banner info" style={{ marginBottom: 0 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>Secure upload link</strong>
        <code style={{ fontSize: '.74rem', wordBreak: 'break-all', display: 'block', marginTop: 4 }}>{url}</code>
      </div>
      <div className="ops-banner-actions">
        <button
          type="button" className="ops-btn ops-btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch {
              setCopied(false)
            }
          }}
        >
          <Copy aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function ReviewCertificateButtons({ certificateId }: { certificateId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [showReject, setShowReject] = useState(false)

  function decide(decision: 'approved' | 'rejected') {
    setError(null)
    startTransition(async () => {
      const result = await reviewCertificateAction(certificateId, decision, notes || null)
      if (result?.ok === false) setError(result.error ?? 'That did not work.')
      else setShowReject(false)
    })
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="ops-btn ops-btn-sm ops-btn-dark" disabled={pending} onClick={() => decide('approved')}>
          {pending ? 'Working…' : 'Approve'}
        </button>
        <button type="button" className="ops-btn ops-btn-sm ops-btn-danger" disabled={pending}
          onClick={() => setShowReject(s => !s)}>
          Reject
        </button>
      </div>
      {showReject && (
        <div style={{ display: 'grid', gap: 6 }}>
          <textarea className="ops-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Why is this certificate being rejected?" aria-label="Rejection reason" />
          <button type="button" className="ops-btn ops-btn-sm ops-btn-danger" disabled={pending || notes.trim().length < 3}
            onClick={() => decide('rejected')}>
            Confirm rejection
          </button>
        </div>
      )}
      {error && <p className="ops-error" role="alert">{error}</p>}
    </div>
  )
}

export function AddWaiverButton({
  vendorId,
  projects,
}: {
  vendorId: string
  projects: { id: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="ops-btn" onClick={() => setOpen(true)}>
        <ShieldAlert aria-hidden="true" /> Add exception
      </button>

      {open && (
        <div className="ops-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="waiver-title"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="ops-dialog">
            <div className="ops-dialog-head"><h2 id="waiver-title">Document an exception</h2></div>
            <div className="ops-dialog-body">
              <div className="ops-banner warn" style={{ fontSize: '.82rem' }}>
                <div>
                  An exception masks a failing requirement on the dashboard — it does not erase it.
                  The underlying gap stays visible in the requirement matrix and in every audit export.
                </div>
              </div>
              <ActionForm action={addWaiver}>
                {state => (
                  <>
                    <input type="hidden" name="vendor_id" value={vendorId} />
                    <div className="ops-field">
                      <label htmlFor="waiver-coverage">Coverage</label>
                      <select id="waiver-coverage" name="coverage_type" className="ops-select" defaultValue="">
                        <option value="">All coverages</option>
                        {COVERAGE_TYPES.map(c => <option key={c} value={c}>{COVERAGE_LABELS[c]}</option>)}
                      </select>
                    </div>
                    <div className="ops-field">
                      <label htmlFor="waiver-project">Limit to a project (optional)</label>
                      <select id="waiver-project" name="project_id" className="ops-select" defaultValue="">
                        <option value="">Applies everywhere</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                    <div className="ops-field">
                      <label htmlFor="waiver-reason">Reason *</label>
                      <textarea id="waiver-reason" name="reason" rows={3} className="ops-textarea"
                        placeholder="Sole proprietor with a valid Florida workers comp exemption on file — exemption certificate uploaded 3/4." />
                      {state.fieldErrors?.reason && <p className="ops-error">{state.fieldErrors.reason[0]}</p>}
                    </div>
                    <div className="ops-field">
                      <label htmlFor="waiver-expires">Expires (optional)</label>
                      <input id="waiver-expires" name="expires_at" type="date" className="ops-input" />
                      <p className="ops-hint">Leave blank for an open-ended exception.</p>
                    </div>
                    <SubmitButton pendingLabel="Recording…">Record exception</SubmitButton>
                  </>
                )}
              </ActionForm>
            </div>
            <div className="ops-dialog-foot">
              <button type="button" className="ops-btn" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function RevokeWaiverButton({ waiverId, vendorId }: { waiverId: string; vendorId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button" className="ops-btn ops-btn-sm ops-btn-danger" disabled={pending}
      onClick={() => startTransition(async () => { await revokeWaiver(waiverId, vendorId) })}
    >
      {pending ? 'Revoking…' : 'Revoke'}
    </button>
  )
}

export function RecalculateButton({ vendorId }: { vendorId?: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <>
      <button
        type="button" className="ops-btn" disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await recalculateCompliance(vendorId)
          setMessage(result.message ?? result.error ?? null)
        })}
      >
        <RefreshCw aria-hidden="true" /> {pending ? 'Recalculating…' : 'Recalculate'}
      </button>
      {message && <span className="ops-hint" role="status">{message}</span>}
    </>
  )
}

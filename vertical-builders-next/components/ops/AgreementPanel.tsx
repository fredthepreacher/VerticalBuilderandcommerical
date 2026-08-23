'use client'

import { useState } from 'react'
import { FileSignature, Download, AlertTriangle } from 'lucide-react'
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveAgreement } from '@/app/ops/actions/operations'
import { daysBetween, formatDate, toUtcDate } from '@/lib/ops/utils/dates'
import { Badge } from './StatusBadge'

export type AgreementStatus = 'missing' | 'sent' | 'signed' | 'expired' | 'superseded'

export interface AgreementRow {
  id: string
  status: AgreementStatus
  effectiveDate: string | null
  expirationDate: string | null
  signedDate: string | null
  documentId: string | null
  filename: string | null
  version: number
  notes: string | null
  createdAt: string
}

const STATUS_LABELS: Record<AgreementStatus, string> = {
  missing: 'Not on file',
  sent: 'Sent for signature',
  signed: 'Signed',
  expired: 'Expired',
  superseded: 'Superseded',
}

const STATUS_TONE: Record<AgreementStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  missing: 'bad',
  sent: 'info',
  signed: 'ok',
  expired: 'bad',
  superseded: 'neutral',
}

/**
 * Signed subcontractor agreements.
 *
 * Kept deliberately separate from insurance compliance: a signed contract and a
 * current COI are two different obligations, and a vendor can easily have one
 * without the other. Recording a new agreement supersedes the previous one
 * rather than overwriting it, so the history of what was signed and when
 * survives — that history is what matters in a dispute.
 */
export default function AgreementPanel({
  vendorId,
  vendorName,
  agreements,
  canManage,
}: {
  vendorId: string
  vendorName: string
  agreements: AgreementRow[]
  canManage: boolean
}) {
  const current = agreements.find(a => a.status !== 'superseded') ?? agreements[0] ?? null
  const history = agreements.filter(a => a.id !== current?.id)
  const [showForm, setShowForm] = useState(!current)

  const expiryDate = current?.expirationDate ? toUtcDate(current.expirationDate) : null
  const expiresIn = expiryDate ? daysBetween(new Date(), expiryDate) : null
  const expiringSoon = expiresIn !== null && expiresIn >= 0 && expiresIn <= 60
  const expired = expiresIn !== null && expiresIn < 0

  return (
    <div className="ops-stack">
      <section className="ops-card">
        <div className="ops-card-head">
          <FileSignature aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-muted)' }} />
          <h2>Subcontractor agreement</h2>
          <div className="ops-card-actions">
            {canManage && (
              <button type="button" className="ops-btn ops-btn-sm ops-btn-primary"
                onClick={() => setShowForm(s => !s)}>
                {current ? 'Record new version' : 'Record agreement'}
              </button>
            )}
          </div>
        </div>

        <div className="ops-card-body">
          {!current ? (
            <div className="ops-banner bad">
              <AlertTriangle aria-hidden="true" />
              <div>
                No signed agreement is on file for {vendorName}. Insurance compliance does not
                cover this — a current COI and a signed contract are separate requirements.
              </div>
            </div>
          ) : (
            <>
              <dl className="ops-deflist">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <Badge tone={STATUS_TONE[current.status]}>{STATUS_LABELS[current.status]}</Badge>
                    {current.version > 1 && (
                      <span className="ops-hint" style={{ marginLeft: 8 }}>version {current.version}</span>
                    )}
                  </dd>
                </div>
                <div><dt>Signed</dt><dd>{current.signedDate ? formatDate(current.signedDate) : '—'}</dd></div>
                <div><dt>Effective</dt><dd>{current.effectiveDate ? formatDate(current.effectiveDate) : '—'}</dd></div>
                <div>
                  <dt>Expires</dt>
                  <dd>
                    {current.expirationDate ? formatDate(current.expirationDate) : 'No expiration recorded'}
                    {expired && <span className="ops-error" style={{ marginLeft: 8 }}>expired</span>}
                    {expiringSoon && !expired && (
                      <span style={{ marginLeft: 8, color: 'var(--ops-warn)' }}>
                        in {expiresIn} day{expiresIn === 1 ? '' : 's'}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Document</dt>
                  <dd>
                    {current.documentId ? (
                      <a className="ops-btn ops-btn-sm" href={`/api/documents/${current.documentId}/download`}>
                        <Download aria-hidden="true" /> {current.filename ?? 'Download'}
                      </a>
                    ) : (
                      <span className="ops-hint">Nothing attached — the status is a note, not proof.</span>
                    )}
                  </dd>
                </div>
              </dl>
              {current.notes && <p className="ops-hint" style={{ marginTop: 12 }}>{current.notes}</p>}
            </>
          )}

          {showForm && canManage && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--ops-line)' }}>
              <ActionForm action={saveAgreement} encType="multipart/form-data">
                {state => (
                  <>
                    <input type="hidden" name="vendor_id" value={vendorId} />

                    <div className="ops-grid-2">
                      <SelectField
                        label="Status" name="status" required defaultValue="signed"
                        errors={state.fieldErrors}
                        options={(['sent', 'signed', 'expired', 'missing'] as AgreementStatus[])
                          .map(s => ({ value: s, label: STATUS_LABELS[s] }))}
                        hint="Marking it signed requires the signed document."
                      />
                      <Field label="Date signed" name="signed_date" type="date" errors={state.fieldErrors} />
                      <Field label="Effective" name="effective_date" type="date" errors={state.fieldErrors} />
                      <Field
                        label="Expires" name="expiration_date" type="date" errors={state.fieldErrors}
                        hint="Leave blank for an evergreen master agreement."
                      />
                    </div>

                    <div className="ops-field">
                      <label htmlFor="agreement_file">Signed agreement (PDF)</label>
                      <input id="agreement_file" name="agreement_file" type="file"
                        className="ops-input" accept="application/pdf,image/jpeg,image/png" />
                      <p className="ops-hint">
                        Stored in the same private document library as COIs and W-9s.
                      </p>
                    </div>

                    <TextareaField label="Notes" name="notes" rows={3} errors={state.fieldErrors}
                      placeholder="Rider terms, negotiated changes, who countersigned…" />

                    {state.error && <p className="ops-error">{state.error}</p>}
                    <SubmitButton className="ops-btn ops-btn-primary" pendingLabel="Saving…">
                      Save agreement
                    </SubmitButton>
                  </>
                )}
              </ActionForm>
            </div>
          )}
        </div>
      </section>

      {history.length > 0 && (
        <section className="ops-card">
          <div className="ops-card-head"><h2>Agreement history</h2></div>
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>Version</th><th>Status</th><th>Signed</th><th>Effective</th>
                  <th>Expired</th><th>Document</th>
                </tr>
              </thead>
              <tbody>
                {history.map(a => (
                  <tr key={a.id}>
                    <td data-label="Version">{a.version}</td>
                    <td data-label="Status"><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABELS[a.status]}</Badge></td>
                    <td data-label="Signed" className="nowrap">{a.signedDate ? formatDate(a.signedDate) : '—'}</td>
                    <td data-label="Effective" className="nowrap">{a.effectiveDate ? formatDate(a.effectiveDate) : '—'}</td>
                    <td data-label="Expired" className="nowrap">{a.expirationDate ? formatDate(a.expirationDate) : '—'}</td>
                    <td data-label="Document">
                      {a.documentId ? (
                        <a className="ops-btn ops-btn-sm" href={`/api/documents/${a.documentId}/download`}>
                          <Download aria-hidden="true" /> Open
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ops-card-body">
            <p className="ops-hint">
              Superseded agreements are never deleted. If a dispute turns on which terms were in
              force on a given date, this is the record that answers it.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}

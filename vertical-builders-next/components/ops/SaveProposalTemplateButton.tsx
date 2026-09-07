'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { saveEstimateAsTemplateAction } from '@/app/ops/actions/proposal-templates'

/**
 * "Save this estimate as a proposal template."
 *
 * The estimate the client is happiest with is usually the best template he will
 * ever write, so the fastest route to a good template library is to lift one he
 * has already built.
 *
 * Only the proposal content travels: service type, scope, customer notes and
 * the line items. Everything identifying the customer stays behind, and the
 * copy below says so plainly rather than leaving anyone to wonder what just got
 * saved into a shared library.
 */
export default function SaveProposalTemplateButton({
  estimateId,
  suggestedName,
}: {
  estimateId: string
  suggestedName?: string
}) {
  const [open, setOpen] = useState(false)
  const action = saveEstimateAsTemplateAction.bind(null, estimateId)

  if (!open) {
    return (
      <button type="button" className="ops-btn ops-btn-sm" onClick={() => setOpen(true)}>
        <FileText aria-hidden="true" /> Save as proposal template
      </button>
    )
  }

  return (
    <div className="ops-card" style={{ marginTop: 12 }}>
      <div className="ops-card-head"><h3>Save as a proposal template</h3></div>
      <div className="ops-card-body">
        <ActionForm action={action}>
          {state => (
            <>
              <div className="ops-field">
                <label htmlFor="template-name">Template name</label>
                <input
                  id="template-name" name="name" className="ops-input" required
                  defaultValue={suggestedName} placeholder="Tile Roof Proposal" maxLength={120}
                />
                <p className="ops-hint">How you will find it later. Not shown to the customer.</p>
              </div>

              <p className="ops-hint" style={{ marginBottom: 12 }}>
                Copies the scope, the customer notes and the line items. The customer, the lead, the
                property address and the estimate number are <strong>not</strong> copied — a
                template is shared wording, reused across jobs.
              </p>

              {state.ok && state.data?.templateId ? (
                <div className="ops-banner ok">
                  <div>
                    Saved.{' '}
                    <Link href={`/ops/estimates/templates/${String(state.data.templateId)}`}>
                      Open the template
                    </Link>{' '}
                    to clear any quantities or rates you do not want reused.
                  </div>
                </div>
              ) : (
                <>
                  {state.error && <p className="ops-error">{state.error}</p>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <SubmitButton className="ops-btn ops-btn-sm ops-btn-primary" pendingLabel="Saving…">
                      Save template
                    </SubmitButton>
                    <button type="button" className="ops-btn ops-btn-sm" onClick={() => setOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </ActionForm>
      </div>
    </div>
  )
}

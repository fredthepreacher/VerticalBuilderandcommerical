'use client'

import { useState, useTransition } from 'react'
import { Sparkles, AlertTriangle, Copy, Check } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import {
  structureLeadAction, enrichLeadAction, draftLeadMessageAction,
} from '@/app/ops/actions/ai'
import type { LeadStructure, LeadEnrichment } from '@/lib/ops/ai/schemas'
import type { MessageKind } from '@/lib/ops/ai/leads'

/**
 * "Structure with AI" — the paste-your-notes box on the new-lead screen.
 *
 * The draft is handed to the parent form via `onDraft`. It is never saved here;
 * the operator still presses the normal Create button, which runs the normal
 * validation and the normal server action.
 */
export function LeadStructurePanel({
  configured,
  onDraft,
}: {
  configured: boolean
  onDraft: (draft: LeadStructure) => void
}) {
  const [applied, setApplied] = useState<LeadStructure | null>(null)

  if (!configured) {
    return (
      <div className="ops-ai-panel">
        <div className="ops-ai-panel-head">
          <Sparkles aria-hidden="true" />
          <h3>Structure with AI</h3>
        </div>
        <p className="ops-hint">
          Not configured. Add an OpenAI key to paste call notes and have the fields filled in —
          the form below works exactly as usual without it.
        </p>
      </div>
    )
  }

  return (
    <div className="ops-ai-panel">
      <div className="ops-ai-panel-head">
        <Sparkles aria-hidden="true" />
        <h3>Structure with AI</h3>
      </div>

      <ActionForm
        action={structureLeadAction}
        onSuccess={state => {
          const raw = state.data?.draft
          if (typeof raw !== 'string' || applied) return
          try {
            const parsed = JSON.parse(raw) as LeadStructure
            setApplied(parsed)
            onDraft(parsed)
          } catch { /* the action already reported a readable failure */ }
        }}
      >
        {state => (
          <>
            <div className="ops-field">
              <label htmlFor="ai-notes">Paste notes, a transcript, or an email</label>
              <textarea
                id="ai-notes" name="notes" rows={5} className="ops-textarea"
                placeholder="John Smith called this morning. 123 Main St in Venice. Roof has a leak near the garage. Wants someone Friday. 941-555-1212. john@example.com."
                maxLength={4000}
              />
              <p className="ops-hint">
                Nothing is saved. The fields below get filled in for you to check and correct.
              </p>
            </div>
            {state.error && <p className="ops-error">{state.error}</p>}
            <SubmitButton className="ops-btn ops-btn-sm ops-btn-primary" pendingLabel="Reading the notes…">
              <Sparkles aria-hidden="true" /> Structure with AI
            </SubmitButton>
          </>
        )}
      </ActionForm>

      {applied && (
        <>
          <span className="ops-ai-label"><Sparkles aria-hidden="true" /> AI-generated — check every field</span>
          {applied.summary && <p className="ops-hint">{applied.summary}</p>}
          {applied.warnings.length > 0 && (
            <div className="ops-ai-flag">
              <strong>Worth checking:</strong>
              <ul>{applied.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const MESSAGE_KINDS: { kind: MessageKind; label: string }[] = [
  { kind: 'first_response', label: 'First response' },
  { kind: 'follow_up', label: 'Follow-up' },
  { kind: 'inspection_confirmation', label: 'Inspection confirmation' },
  { kind: 'tried_to_reach', label: 'Tried to reach you' },
]

const URGENCY_TONE: Record<string, string> = {
  high: 'var(--ops-bad)', normal: 'var(--ops-body)', low: 'var(--ops-muted)',
}

/** AI Assist on an existing lead: summary, priority, next action, draft message. */
export default function LeadAiAssist({
  leadId,
  configured,
}: {
  leadId: string
  configured: boolean
}) {
  const [enrichment, setEnrichment] = useState<LeadEnrichment | null>(null)
  const [message, setMessage] = useState<{ subject: string; body: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()

  if (!configured) {
    return (
      <div className="ops-ai-panel">
        <div className="ops-ai-panel-head"><Sparkles aria-hidden="true" /><h3>AI Assist</h3></div>
        <p className="ops-hint">Not configured. Add an OpenAI key to summarise this lead and draft a reply.</p>
      </div>
    )
  }

  function summarise() {
    setError(null)
    start(async () => {
      const result = await enrichLeadAction(leadId)
      if (result.ok === false) { setError(result.error ?? 'Could not summarise this lead.'); return }
      const raw = result.data?.enrichment
      if (typeof raw === 'string') {
        try { setEnrichment(JSON.parse(raw) as LeadEnrichment) } catch { setError('The summary could not be read.') }
      }
    })
  }

  function draft(kind: MessageKind) {
    setError(null)
    setCopied(false)
    start(async () => {
      const result = await draftLeadMessageAction(leadId, kind)
      if (result.ok === false) { setError(result.error ?? 'Could not draft a message.'); return }
      const raw = result.data?.message
      if (typeof raw === 'string') {
        try { setMessage(JSON.parse(raw) as { subject: string; body: string }) } catch { setError('The draft could not be read.') }
      }
    })
  }

  const fullText = message ? (message.subject ? `${message.subject}\n\n${message.body}` : message.body) : ''

  return (
    <div className="ops-ai-panel">
      <div className="ops-ai-panel-head">
        <Sparkles aria-hidden="true" />
        <h3>AI Assist</h3>
        <div className="ops-ai-panel-actions">
          <button type="button" className="ops-btn ops-btn-sm" onClick={summarise} disabled={pending}>
            {enrichment ? 'Re-summarise' : 'Summarise lead'}
          </button>
        </div>
      </div>

      {pending && <p className="ops-hint">Working…</p>}

      {error && (
        <div className="ops-banner bad"><AlertTriangle aria-hidden="true" /><div>{error}</div></div>
      )}

      {enrichment && !pending && (
        <>
          <span className="ops-ai-label"><Sparkles aria-hidden="true" /> AI-generated</span>
          <p style={{ fontSize: '.85rem', lineHeight: 1.55, margin: 0 }}>{enrichment.summary}</p>
          <dl className="ops-deflist">
            <dt>Likely service</dt><dd>{enrichment.serviceCategory || '—'}</dd>
            <dt>Urgency</dt>
            <dd style={{ color: URGENCY_TONE[enrichment.urgency], fontWeight: 600 }}>{enrichment.urgency}</dd>
            <dt>Suggested next step</dt><dd>{enrichment.nextAction || '—'}</dd>
          </dl>
          <p className="ops-hint">
            A suggestion, not a decision. The pipeline stage only changes when you change it.
          </p>
        </>
      )}

      <div>
        <p className="ops-label" style={{ marginBottom: 6 }}>Draft a message</p>
        <div className="ops-chips">
          {MESSAGE_KINDS.map(m => (
            <button key={m.kind} type="button" className="ops-chip ops-chip-link"
              onClick={() => draft(m.kind)} disabled={pending}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {message && !pending && (
        <div className="ops-ai-proposal">
          <div className="ops-ai-proposal-head">Draft — nothing has been sent</div>
          {message.subject && <p className="ops-ai-proposal-subject">{message.subject}</p>}
          <p className="ops-ai-proposal-body">{message.body}</p>
          <button
            type="button" className="ops-btn ops-btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(fullText).then(() => {
                setCopied(true); setTimeout(() => setCopied(false), 2000)
              }).catch(() => undefined)
            }}
          >
            {copied ? <><Check aria-hidden="true" /> Copied</> : <><Copy aria-hidden="true" /> Copy message</>}
          </button>
        </div>
      )}
    </div>
  )
}
